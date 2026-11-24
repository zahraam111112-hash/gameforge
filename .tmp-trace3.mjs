import { World, makePlayer } from './game/src/world.js';
import { rng } from './game/src/util.js';
import { botInput } from './harness/sim.mjs';

const level = process.argv[2] ?? 's1';
const seed = Number(process.argv[3] ?? 1);
const steps = Number(process.argv[4] ?? 5400);
const detailFrom = Number(process.argv[5] ?? 150);
const detailTo = Number(process.argv[6] ?? 320);
const world = new World(level, seed);
const p = makePlayer(world.spawnPoint.x, world.spawnPoint.y);
const rand = rng(seed);
const bot = { dir: 1, hold: 0, chase: 0, chased: null, wait: 0 };
let lastX = p.x;
for (let i = 0; i < steps; i++) {
  const input = botInput(p, world, rand, 0.82, bot);
  world.tick(p, input);
  world.drainEvents();
  if (world.status !== 'playing') { console.log(i, 'status', world.status); break; }
  if (i >= detailFrom && i <= detailTo) {
    console.log(i, `x=${(p.x/16).toFixed(2)} y=${(p.y/16).toFixed(2)} vx=${p.vx.toFixed(2)} onG=${p.onGround} in=${JSON.stringify(input)} bot=${JSON.stringify({d:bot.dir,h:bot.hold,w:bot.wait,c:bot.chase})}`);
  }
  if (p.onGround && Math.abs(p.x - lastX) < 0.2 && bot.hold <= 0) { bot.dir = rand() < 0.5 ? 1 : -1; bot.hold = 20 + Math.floor(rand()*30); }
  lastX = p.x;
}
