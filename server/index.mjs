import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { RoomManager } from './rooms.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';
const PUBLIC = path.join(ROOT, 'site', 'public');

const rooms = new RoomManager();

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.map': 'application/json', '.woff2': 'font/woff2',
};

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-cache' });
  res.end(body);
}

function readJsonBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function safeJoin(base, urlPath) {
  const p = path.normalize(path.join(base, urlPath));
  if (!p.startsWith(base + path.sep) && p !== base) return null;
  return p;
}

function fileRes(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'not found', 'text/plain; charset=utf-8');
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
      'x-content-type-options': 'nosniff',
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const p = decodeURIComponent(url.pathname);

  if (p === '/healthz' || p === '/api/health') {
    return send(res, 200, JSON.stringify({ ok: true, uptime: process.uptime(), ...rooms.stats() }));
  }
  if (p === '/api/lobby') {
    return send(res, 200, JSON.stringify(rooms.stats()));
  }
  if (p === '/api/rooms') {
    return send(res, 200, JSON.stringify(rooms.stats()));
  }

  // Devlog is written by the harness; the site reads it live.
  if (p === '/api/devlog') {
    const f = path.join(ROOT, 'devlog', 'log.jsonl');
    fs.readFile(f, 'utf8', (err, data) => {
      if (err) return send(res, 200, '[]');
      const lines = data.trim().split('\n').slice(-500);
      send(res, 200, `[${lines.join(',')}]`);
    });
    return;
  }
  if (p === '/api/version') {
    const f = path.join(ROOT, 'version.json');
    return fs.readFile(f, 'utf8', (err, data) => send(res, 200, err ? '{"version":"dev"}' : data));
  }

  if (p === '/' || p === '') return fileRes(res, path.join(PUBLIC, 'index.html'));
  if (p.startsWith('/game')) {
    const rel = p === '/game' ? '/game/latest/' : p;
    let file = safeJoin(PUBLIC, rel);
    if (file && fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (file) return fileRes(res, file);
    return send(res, 404, 'not found', 'text/plain');
  }
  const file = safeJoin(PUBLIC, p);
  if (file) return fileRes(res, file);
  return send(res, 404, 'not found', 'text/plain');
});

const wss = new WebSocketServer({ noServer: true });
let nextId = 1;

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  if (url.pathname !== '/ws') { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws) => {
  const id = `p${nextId++}`;
  ws.clientId = id;
  ws.room = null;
  ws.send(JSON.stringify({ t: 'welcome', id }));
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.t === 'join') {
      const kind = msg.mode === 'royale' ? 'royale' : 'coop';
      const level = msg.level ?? 'arena';
      ws.room = rooms.get(kind, level);
      if (!ws.room.add(id, msg.name)) {
        ws.send(JSON.stringify({ t: 'error', error: 'room_full' }));
        ws.room = null; return;
      }
      // Acknowledge with state immediately: with a few hundred clients joining at
      // once, waiting up to a tick for the broadcast is long enough that a slow
      // client can be dropped before it ever sees itself in a room it joined.
      ws.send(JSON.stringify({ t: 'welcome', id, name: id, room: kind }));
      ws.send(JSON.stringify(ws.room.snapshot()));
    } else if (msg.t === 'name' && ws.room) {
      const pl = ws.room.players.get(id);
      if (pl) pl.name = String(msg.name).slice(0, 16);
    } else if (msg.t === 'in' && ws.room) {
      ws.room.setInput(id, {
        left: !!msg.left, right: !!msg.right, jump: !!msg.jump,
        attack: !!msg.attack, dash: !!msg.dash, down: !!msg.down,
      });
    }
  });
  ws.on('close', () => { ws.room?.remove(id); });
});

// Broadcast snapshots at the sim rate.
setInterval(() => {
  for (const room of rooms.rooms.values()) {
    if (!room.players.size) continue;
    const snap = JSON.stringify(room.snapshot());
    for (const ws of wss.clients) {
      if (ws.room === room && ws.readyState === 1) ws.send(snap);
    }
  }
}, 1000 / 30).unref();

server.listen(PORT, HOST, () => {
  console.log(`gameforge server on http://${HOST}:${PORT}`);
});

process.on('SIGTERM', () => { server.close(); process.exit(0); });
