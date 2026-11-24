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
let maxX = p.x, maxAt = 0;
let lastPrint = -100;
for (let i = 0; i < steps; i++) {
  const input = botInput(p, world, rand, 0.82, bot);
  world.tick(p, input);
  world.drainEvents();
  if (world.status !== 'playing') { console.log(i, 'status', world.status, 'at', p.x.toFixed(1), p.y.toFixed(1)); break; }
  if (p.x > maxX) { maxX = p.x; maxAt = i; }
  if (i - lastPrint >= 300) { lastPrint = i; console.log(i, `x=${p.x.toFixed(1)}(${(p.x/16).toFixed(1)}) y=${p.y.toFixed(1)} max=${maxX.toFixed(1)} dir=${bot.dir} hold=${bot.hold} wait=${bot.wait} onG=${p.onGround} hp=${p.hp}`); }
}
console.log('final maxX', maxX.toFixed(1), 'col', (maxX/16).toFixed(2), 'at frame', maxAt, 'progress', (Math.min(1,maxX/(world.width-80))*100).toFixed(1));
