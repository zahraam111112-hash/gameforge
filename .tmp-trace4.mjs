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
let lastX = p.x, maxX = p.x;
const buckets = {};
for (let i = 0; i < steps; i++) {
  const input = botInput(p, world, rand, 0.82, bot);
  world.tick(p, input);
  world.drainEvents();
  if (world.status !== 'playing') { console.log(i, 'status', world.status); break; }
  const c = Math.floor(p.x/16);
  buckets[c] = (buckets[c] ?? 0) + 1;
  if (p.onGround && Math.abs(p.x - lastX) < 0.2 && bot.hold <= 0) { bot.dir = rand() < 0.5 ? 1 : -1; bot.hold = 20 + Math.floor(rand()*30); }
  lastX = p.x; maxX = Math.max(maxX, p.x);
}
console.log('col histogram', JSON.stringify(buckets));
console.log('maxCol', (maxX/16).toFixed(2));
const enemies = world.entities.filter(e=>e.kind==='enemy');
console.log('enemies', enemies.map(e=>`${e.type}@${(e.x/16).toFixed(1)},${(e.y/16).toFixed(1)} hp${e.hp}${e.dead?' dead':''}`).join(' '));
