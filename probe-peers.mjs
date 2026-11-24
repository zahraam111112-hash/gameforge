// Diagnostic: how many distinct players does one client actually see?
import WebSocket from 'ws';
const N = Number(process.env.N ?? 200);
const URL = process.env.U ?? 'ws://127.0.0.1:8787/ws';
const res = await Promise.all(Array.from({ length: N }, (_, i) => new Promise((r) => {
  const ws = new WebSocket(URL);
  let id = null, f = 0, self = false, st = false, moves = 0;
  const uniq = new Set();
  const fin = (w) => {
    if (st) return; st = true;
    clearTimeout(T); clearInterval(P);
    try { ws.close(); } catch {}
    r({ f, self, w, uniq: uniq.size });
  };
  const T = setTimeout(() => fin('timeout'), 40000);
  const P = setInterval(() => {
    if (ws.readyState !== 1) return;
    const k = ++moves, d = Math.sin(i + k / 8) > 0;
    ws.send(JSON.stringify({ t: 'in', left: !d, right: d, jump: k % 22 < 3, attack: k % 45 < 2, dash: k % 60 < 2, down: false }));
  }, 50);
  ws.on('open', () => ws.send(JSON.stringify({ t: 'join', mode: 'coop', level: 'arena', name: `b${i}` })));
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.t === 'welcome' && m.id) id = m.id;
    if (m.t === 'state') {
      f++;
      for (const p of m.players ?? []) uniq.add(p.id);
      if (id && (m.players ?? []).some((p) => p.id === id)) self = true;
      if (f >= 20 && self) fin('ok');
    }
  });
  ws.on('close', () => fin('closed'));
  ws.on('error', () => fin('err'));
})));
const wh = {};
for (const x of res) wh[x.w] = (wh[x.w] ?? 0) + 1;
const F = res.map((x) => x.f).sort((a, b) => a - b);
const U = res.map((x) => x.uniq).sort((a, b) => a - b);
console.log('why', JSON.stringify(wh), 'selfSeen', res.filter((x) => x.self).length);
console.log('frames p50/p90', F[N >> 1], F[Math.floor(N * 0.9)], 'uniqIds p50/p90', U[N >> 1], U[Math.floor(N * 0.9)]);
