// How fast is the room loop actually running? A 30Hz tick that delivers at 8Hz
// is the difference between a playable room and a frozen one, and no client-side
// measurement separates that from network lag.
const h = (await import('node:http')).default;
const get = () => new Promise((r) => h.get(`${process.env.URL ?? 'http://127.0.0.1:8787'}/healthz`, (x) => {
  let d = ''; x.on('data', (c) => { d += c; }); x.on('end', () => r(JSON.parse(d)));
}).on('error', () => r(null)));
const wait = Number(process.env.MS ?? 5000);
const a = await get();
await new Promise((r) => setTimeout(r, wait));
const b = await get();
if (!a || !b) { console.log('unreachable'); process.exit(1); }
console.log(JSON.stringify({
  hz: a.rooms[0] ? Math.round(((b.rooms[0].frame - a.rooms[0].frame) / (wait / 1000)) * 10) / 10 : null,
  rooms: b.rooms.length,
  players: b.totalPlayers,
}));
