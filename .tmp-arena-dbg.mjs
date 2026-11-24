import { World, makePlayer } from './game/src/world.js';
import { rng } from './game/src/util.js';

const seed = Number(process.argv[2] ?? 7);
const steps = Number(process.argv[3] ?? 20000);
const world = new World('arena', seed);
const p = makePlayer(world.spawnPoint.x, world.spawnPoint.y);
const rand = rng(seed);
const bot = { dir: 1, hold: 0, chase: 0, chased: null };
const MAX_JUMP_TILES = 3;
const seen = new Set();

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

let maxX = 0;
for (let i = 0; i < steps; i++) {
  const input = botInput(p, world, rand, 0.82, bot);
  world.tick(p, input);
  for (const ev of world.drainEvents()) {
    if (ev.type === 'exitLocked' || ev.type === 'win') seen.add(`${ev.type}@${i}`);
  }
  maxX = Math.max(maxX, p.x);
  if (world.status === 'lost') { world.status = 'playing'; p.hp = p.maxHp; p.x = world.spawnPoint.x; p.y = world.spawnPoint.y; }
  if (world.status === 'won') { console.log('WON at frame', i); break; }
  if (i % 2000 === 0) {
    const alive = world.entities.filter((e) => e.kind === 'enemy' && !e.dead);
    console.log(i, `wave=${world.wave} done=${world.wavesDone}/${world.wavesTotal} unlocked=${world.exitUnlocked()} alive=${alive.map((e) => `${e.type}@${Math.round(e.x)},${Math.round(e.y)}`).join(' ')}`);
  }
}
const alive = world.entities.filter((e) => e.kind === 'enemy' && !e.dead);
console.log('final status', world.status, 'wave', world.wave, 'done', world.wavesDone, 'total', world.wavesTotal, 'maxX', Math.round(maxX));
console.log('alive', alive.map((e) => `${e.type} id=${e.id} @${Math.round(e.x)},${Math.round(e.y)} vx=${e.vx.toFixed(2)} onGround=${e.onGround}`).join('\n'));
console.log('events', [...seen].slice(0, 10));
console.log('exit', world.entities.filter((e) => e.type === 'exit'));
