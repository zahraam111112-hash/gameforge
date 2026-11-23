import { World, makePlayer } from './game/src/world.js';
import { rng } from './game/src/util.js';

const level = process.argv[2] ?? 'arena';
const steps = Number(process.argv[3] ?? 400);
const world = new World(level, 1);
const p = makePlayer(world.spawnPoint.x, world.spawnPoint.y);
const rand = rng(1);
const bot = { dir: 1, hold: 0, chase: 0, chased: null };
const MAX_JUMP_TILES = 3;

function pitSpan(world, p, dir) {
  const ty = Math.floor((p.y + p.h + 2) / 16);
  const startX = Math.floor((p.x + p.w / 2) / 16);
  let span = 0;
  for (let i = 1; i <= 8; i++) {
    const tx = startX + i * dir;
    if (world.solidAt(tx, ty) || world.onewayAt(tx, ty)) break;
    span++;
  }
  return span;
}

function botInput(p, world, rand, skill, bot) {
  if (bot.hold > 0) bot.hold--;
  const lookAhead = 26;
  const aheadX = p.x + bot.dir * lookAhead;
  const tx = Math.floor(aheadX / 16);
  const ty = Math.floor((p.y + p.h) / 16) + 1;
  const gap = !world.solidAt(tx, ty) && !world.onewayAt(tx, ty);
  const wall = world.solidAt(Math.floor((p.x + p.w / 2 + bot.dir * 10) / 16), Math.floor((p.y + p.h / 2) / 16));
  const enemy = world.entities.find((e) => e.kind === 'enemy' && !e.dead && Math.abs(e.x - p.x) < 40);
  const coin = world.entities.find((e) => e.type === 'coin' && !e.dead && Math.abs(e.x - p.x) < 44);
  if (gap && p.onGround) {
    const span = pitSpan(world, p, bot.dir);
    if (span > MAX_JUMP_TILES) { bot.dir = -bot.dir; bot.hold = 40; }
  }
  if (coin && !gap && !wall && bot.chase <= 0) { bot.dir = coin.x > p.x ? 1 : -1; bot.chase = 45; bot.chased = coin; }
  if (bot.chase > 0) { bot.chase--; if (bot.chased?.dead) { bot.chase = 0; bot.chased = null; } }
  return {
    right: bot.dir > 0, left: bot.dir < 0,
    jump: gap || (wall && rand() < skill),
    attack: Boolean(enemy) && rand() < skill,
    dash: wall && rand() < 0.4, down: false,
  };
}

const skill = 0.82;
for (let i = 0; i < steps; i++) {
  const input = botInput(p, world, rand, skill, bot);
  world.tick(p, input);
  if (i % 10 === 0 || i < 5) {
    console.log(i, `x=${p.x.toFixed(1)} y=${p.y.toFixed(1)} vx=${p.vx.toFixed(2)} vy=${p.vy.toFixed(2)} g=${p.onGround} dir=${bot.dir} coin=${input.chase} hold=${bot.hold} in=${JSON.stringify(input)}`);
  }
  if (world.status !== 'playing') { console.log('STATUS', world.status); break; }
}
console.log('entities', world.entities.map((e) => e.type).join(','));
