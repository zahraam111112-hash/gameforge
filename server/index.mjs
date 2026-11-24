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

/** A round in flight: the newest round event is a start, not an outcome.
 *  Deliberately not "did anything get written recently" — an agent thinking
 *  through a model call writes nothing for minutes and is still working.
 *  Read from the whole file, not from a poll's chunk, so a delta request that
 *  contains no round event still reports the studio as busy. */
function isHarnessActive(buf) {
  const lines = buf.toString('utf8').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.includes('"kind":"round"')) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.kind !== 'round') continue;
    return e.phase === 'start' && Date.now() - Date.parse(e.at) < 6 * 3600_000;
  }
  return false;
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
  // Every archived build on disk, not just the ones the devlog mentions: a build
  // that shipped before the devlog existed is still playable and must stay in the
  // version picker. Read from the filesystem so this cannot drift from reality.
  if (p === '/api/builds') {
    const dir = path.join(PUBLIC, 'game');
    return fs.readdir(dir, { withFileTypes: true }, (err, ents) => {
      if (err) return send(res, 200, JSON.stringify({ builds: [] }));
      const builds = ents
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map((d) => {
          const statue = fs.statSync(path.join(dir, d.name));
          return { version: d.name, at: statue.mtime.toISOString(), playable: fs.existsSync(path.join(dir, d.name, 'index.html')) };
        })
        .filter((b) => b.playable)
        .sort((a, b) => (a.version === 'latest' ? 1 : b.version === 'latest' ? -1 : b.version.localeCompare(a.version, undefined, { numeric: true })));
      send(res, 200, JSON.stringify({ builds }));
    });
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
      // Parse each line rather than joining raw text: one torn line at the end of
      // an append-only file used to make the whole endpoint invalid JSON, which
      // blanked the public devlog with no error anywhere.
      const entries = [];
      for (const line of data.trim().split('\n').slice(-500)) {
        try { entries.push(JSON.parse(line)); } catch { /* torn tail */ }
      }
      send(res, 200, JSON.stringify(entries));
    });
    return;
  }
  if (p === '/api/version') {
    const f = path.join(ROOT, 'version.json');
    return fs.readFile(f, 'utf8', (err, data) => send(res, 200, err ? '{"version":"dev"}' : data));
  }

  // The studio's live work stream. `from` is a byte offset the client got back
  // from its previous call: an append-only file can be tailed exactly, so an
  // audience watching a round sees each step once instead of re-reading 4000
  // lines every two seconds. No offset means "the last N events" for a fresh
  // page load.
  if (p === '/api/activity') {
    const f = path.join(ROOT, 'devlog', 'activity.jsonl');
    const from = url.searchParams.get('from');
    const limit = Math.min(400, Math.max(1, Number(url.searchParams.get('limit') ?? 120)));
    fs.readFile(f, (err, buf) => {
      if (err) return send(res, 200, JSON.stringify({ cursor: 0, events: [], active: false }));
      const size = buf.length;
      let start = 0;
      if (from != null && Number.isFinite(Number(from))) {
        start = Math.min(size, Math.max(0, Number(from)));
        // A truncated file (or a stale cursor after rotation) must not strand the
        // reader mid-line: an offset past the end falls back to the tail.
        if (start > 0 && buf[start - 1] !== 0x0a) start = size;
      }
      const chunk = buf.subarray(start, size).toString('utf8');
      const lines = chunk.split('\n').filter(Boolean);
      const picked = from == null ? lines.slice(-limit) : lines.slice(0, limit);
      const events = [];
      for (const line of picked) {
        try { events.push(JSON.parse(line)); } catch { /* a half-written tail line */ }
      }
      // The cursor is where this response stopped reading, so the next call gets
      // exactly what came after it. When the limit cut the chunk short, resume
      // after the last line actually returned rather than skipping the remainder.
      const cut = from != null && picked.length < lines.length;
      const cursor = cut ? start + Buffer.byteLength(picked.join('\n') + '\n', 'utf8') : size;
      send(res, 200, JSON.stringify({ cursor, read: start, events, active: isHarnessActive(buf) }));
    });
    return;
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
      ws.room = rooms.join(kind, level, id, msg.name);
      if (!ws.room) {
        ws.send(JSON.stringify({ t: 'error', error: 'room_full' }));
        ws.room = null; return;
      }
      // Acknowledge with state immediately: with a few hundred clients joining at
      // once, waiting up to a tick for the broadcast is long enough that a slow
      // client can be dropped before it ever sees itself in a room it joined.
      ws.send(JSON.stringify({ t: 'welcome', id, name: id, room: kind }));
      // Full snapshot on join, deltas after: the client needs everyone once.
      ws.view = null;
      ws.winnerSeen = null;
      sendState(ws, ws.room);
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

// A client sees everyone on join and only changes afterwards.
function sendState(ws, room) {
  const d = room.delta(ws.view);
  ws.view = d.keys;
  ws.winnerSeen = d.winner;
  ws.send(JSON.stringify({ t: 'state', room: room.kind, frame: d.frame, winner: d.winner, players: d.players, gone: d.gone }));
}

// Broadcast deltas at the sim rate. Each client keeps its own view, so a room
// of N players costs O(N) rather than O(N×N), and a client that has seen
// nothing new receives nothing.
setInterval(() => {
  for (const room of rooms.rooms.values()) {
    if (!room.players.size) continue;
    // Build each client's delta once and reuse it. Calling delta() per client
    // rebuilt the room's full id map per client, so a room's real cost was
    // O(N²) map work even before serialization — that is what starved the
    // broadcast under a few hundred players.
    const views = room.prepare();
    for (const ws of wss.clients) {
      if (ws.room !== room || ws.readyState !== 1) continue;
      const msg = room.render(views, ws.view);
      const changed = msg.players.length || msg.gone.length || msg.winner !== ws.winnerSeen;
      ws.view = msg.keys;
      ws.winnerSeen = msg.winner;
      if (!changed) continue;
      ws.send(JSON.stringify(msg));
    }
  }
}, 1000 / 30).unref();

server.listen(PORT, HOST, () => {
  console.log(`gameforge server on http://${HOST}:${PORT}`);
});

process.on('SIGTERM', () => { server.close(); process.exit(0); });
