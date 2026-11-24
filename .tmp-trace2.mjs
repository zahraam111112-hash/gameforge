import { World, makePlayer } from './game/src/world.js';
import { rng } from './game/src/util.js';
import { botInput } from './harness/sim.mjs';

const level = process.argv[2] ?? 's1';
const seed = Number(process.argv[3] ?? 1);
const steps = Number(process.argv[4] ?? 5400);
const world = new World(level, seed);
const p = makePlayer(world.spawnPoint.x, world.spawnPoint.y);
const rand = rng(seed);
const bot = { dir: 1, hold: 0, chase: 0, chased: null, wait: 0 };
let maxX = p.x, maxAt = 0, lastX = p.x, stuck = 0;
for (let i = 0; i < steps; i++) {
  const input = botInput(p, world, rand, 0.82, bot);
  world.tick(p, input);
  const evs = world.drainEvents();
  for (const ev of evs) if (ev.type === 'hurt') console.log('   ', i, 'hurt', ev.cause, 'hp', ev.hp, 'at', p.x.toFixed(1), p.y.toFixed(1), 'col', (p.x/16).toFixed(2), 'row', (p.y/16).toFixed(2));
  if (world.status !== 'playing') { console.log(i, 'status', world.status, 'at col', (p.x/16).toFixed(2), 'row', (p.y/16).toFixed(2)); break; }
  if (p.onGround && Math.abs(p.x - lastX) < 0.2) stuck++; else stuck = 0;
  if (p.onGround && Math.abs(p.x - lastX) < 0.2 && bot.hold <= 0) { bot.dir = rand() < 0.5 ? 1 : -1; bot.hold = 20 + Math.floor(rand()*30); }
  lastX = p.x;
  if (p.x > maxX) { maxX = p.x; maxAt = i; }
}
console.log('final maxX col', (maxX/16).toFixed(2), 'at frame', maxAt, 'progress', (Math.min(1,maxX/(world.width-80))*100).toFixed(1));
