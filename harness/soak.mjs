// Hold a fleet of real WebSocket players in rooms and watch the server from the
// outside: does the tick keep pace, and does everyone keep receiving state?
// The load test answers "did they sync once"; this answers "does it hold".
import WebSocket from 'ws';
import http from 'node:http';

const URL = process.env.GAMEFORGE_WS ?? 'ws://127.0.0.1:8787/ws';
const HTTP = URL.replace(/^ws/, 'http').replace(/\/ws$/, '');
const PLAYERS = Number(process.env.GAMEFORGE_BOTS ?? 100);
const SECONDS = Number(process.env.GAMEFORGE_SECONDS ?? 30);

const get = () => new Promise((r) => http.get(`${HTTP}/healthz`, (x) => {
  let d = ''; x.on('data', (c) => { d += c; }); x.on('end', () => { try { r(JSON.parse(d)); } catch { r(null); } });
}).on('error', () => r(null)));

const clients = [];
for (let i = 0; i < PLAYERS; i++) {
  const ws = new WebSocket(URL);
  const c = { ws, frames: 0, self: false, id: null, moves: 0 };
  clients.push(c);
  ws.on('open', () => {
    ws.send(JSON.stringify({ t: 'join', mode: 'coop', level: 'arena', name: `bot${i}` }));
    setInterval(() => {
      if (ws.readyState !== 1) return;
      const k = ++c.moves, dir = Math.sin(i + k / 8) > 0;
      ws.send(JSON.stringify({ t: 'in', left: !dir, right: dir, jump: k % 22 < 3, attack: k % 45 < 2, dash: k % 60 < 2, down: false }));
    }, 50).unref();
  });
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.t === 'welcome' && m.id) c.id = m.id;
    if (m.t === 'state') {
      c.frames++;
      if (c.id && (m.players ?? []).some((p) => p.id === c.id)) c.self = true;
    }
  });
  ws.on('error', () => {});
}

const a = await get();
await new Promise((r) => setTimeout(r, SECONDS * 1000));
const b = await get();

const frames = clients.map((c) => c.frames).sort((x, y) => x - y);
const synced = clients.filter((c) => c.self).length;
const out = {
  players: PLAYERS,
  synced,
  neverSawSelf: PLAYERS - synced,
  framesPerClient: { min: frames[0], p50: frames[PLAYERS >> 1], max: frames[PLAYERS - 1] },
  serverHz: a?.rooms?.[0] ? Math.round((((b.rooms[0].frame - a.rooms[0].frame) / SECONDS) * 10)) / 10 : null,
  rooms: b?.rooms?.length ?? 0,
  playersOnServer: b?.totalPlayers ?? 0,
  seconds: SECONDS,
};
console.log(JSON.stringify(out, null, 2));
for (const c of clients) { try { c.ws.close(); } catch {} }
process.exit(synced === PLAYERS ? 0 : 1);
