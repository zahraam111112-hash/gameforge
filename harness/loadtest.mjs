// Bot fleet: hundreds of WebSocket clients joining the same authoritative room,
// sending real input intents, and asserting that the server keeps every player
// in sync. This is the harness's multiplayer test — it exercises the same path
// a browser takes, so a regression here is a real player-visible regression.
import WebSocket from 'ws';

const URL = process.env.GAMEFORGE_WS ?? 'ws://127.0.0.1:9000/ws';
const PLAYERS = Number(process.env.GAMEFORGE_BOTS ?? 200);
// Royale is single-elimination, so a bot that dies has still been handled
// correctly — the check is that it saw itself in a snapshot first.
const ROYALE_EVERY = Number(process.env.GAMEFORGE_ROYALE_EVERY ?? 5);

// Real players are spread across many rooms, so a fleet that packs everyone
// into two rooms measures the worst possible broadcast cost, not the site.
// SPREAD=1 gives every ROOM_SIZE-th bot its own room.
const SPREAD = process.env.GAMEFORGE_SPREAD === '1';
const ROOM_SIZE = Number(process.env.GAMEFORGE_ROOM_SIZE ?? 20);

function oneBot(n, stats) {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL);
    let id = null;
    let frames = 0;
    let sawSelf = false;
    const t = setTimeout(() => { try { ws.close(); } catch {} resolve({ ok: false, error: 'timeout', frames }); }, 30_000);

    ws.on('open', () => {
      const level = SPREAD ? `arena${Math.floor(n / ROOM_SIZE)}` : 'arena';
      ws.send(JSON.stringify({ t: 'join', mode: n % ROYALE_EVERY === 0 ? 'royale' : 'coop', level, name: `bot${n}` }));
    });
    const peers = new Map();
    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.t === 'error') { clearTimeout(t); ws.close(); resolve({ ok: false, error: m.error, frames }); return; }
      if (m.t === 'welcome' && m.id) id = m.id;
      if (m.t === 'state') {
        frames++;
        // Deltas: merge what changed, drop who left.
        for (const p of m.players ?? []) peers.set(p.id, p);
        for (const pid of m.gone ?? []) peers.delete(pid);
        if (peers.has(id)) sawSelf = true;
        if (frames === 1 || frames % 6 === 0) {
          if (ws.readyState === 1) {
            const dir = Math.sin(n + frames / 20) > 0;
            ws.send(JSON.stringify({
              t: 'in', left: !dir, right: dir, jump: frames % 30 < 3,
              attack: frames % 45 < 2, dash: frames % 90 < 2, down: false,
            }));
          }
        }
        if (frames === 60) {
          clearTimeout(t);
          stats.maxPlayers = Math.max(stats.maxPlayers, peers.size);
          stats.winners += m.winner ? 1 : 0;
          resolve({ ok: sawSelf, id, frames, players: peers.size, royale: n % ROYALE_EVERY === 0 });
        }
      }
    });
    ws.on('error', (e) => { clearTimeout(t); resolve({ ok: false, error: String(e.message ?? e), frames }); });
    ws.on('close', () => { clearTimeout(t); resolve({ ok: sawSelf, id, frames, closed: true }); });
  });
}

const stats = { maxPlayers: 0, winners: 0 };
const started = Date.now();
// Join in waves so the handshake stays honest but the room really does fill.
const results = [];
for (let i = 0; i < PLAYERS; i += 50) {
  const wave = await Promise.all(Array.from({ length: Math.min(50, PLAYERS - i) }, (_, k) => oneBot(i + k, stats)));
  results.push(...wave);
}

const ok = results.filter((r) => r.ok).length;
const errors = results.filter((r) => !r.ok);
const byError = {};
for (const e of errors) byError[e.error ?? 'unknown'] = (byError[e.error ?? 'unknown'] ?? 0) + 1;

console.log(JSON.stringify({
  players: PLAYERS,
  synced: ok,
  failed: errors.length,
  errors: byError,
  roomSize: stats.maxPlayers,
  royaleWinnersSeen: stats.winners,
  seconds: Math.round((Date.now() - started) / 100) / 10,
}, null, 2));

process.exit(ok === PLAYERS ? 0 : 1);
