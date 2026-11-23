// Headless bot play — the harness's semantic test. Runs the real game logic
// (same modules the browser ships) with a scripted bot and returns metrics that
// agents and the site can reason about without a browser.
import { World, makePlayer, RUN } from '../game/src/world.js';
import { LEVELS } from '../game/src/level.js';
import { rng } from '../game/src/util.js';

// Measured from the jump arc: 21 air frames at RUN speed clears ~3.3 tiles.
// Anything wider is a wall to the bot, not a jump.
const MAX_JUMP_TILES = 3;

export function simulate({ level = 's1', steps = 3600, seed = 1, skill = 0.82 }) {
  const spec = LEVELS[level] ?? LEVELS.s1;
  const world = new World(level, seed);
  const p = makePlayer(world.spawnPoint.x, world.spawnPoint.y);
  const rand = rng(seed);
  const bot = { dir: 1, hold: 0, chase: 0, chased: null };
  let maxX = p.x;
  let deaths = 0;
  let stuckFrames = 0;
  let lastX = p.x;
  let minHp = p.hp;
  let enemiesKilled = 0;
  const deathSpots = {};
  const bug = [];

  for (let i = 0; i < steps; i++) {
    const input = botInput(p, world, rand, skill, bot);
    world.tick(p, input);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) { bug.push(`NaN position at frame ${i}`); break; }
    if (p.y > world.height + 200) { bug.push(`fell out of world at ${Math.round(p.x)}`); break; }
    if (world.status !== 'playing') {
      if (world.status === 'lost') {
        deaths++;
        // Where the bot dies is the actionable number: a cluster of deaths at
        // one column is a difficulty spike, deaths at the spawn are a trap.
        const at = `${Math.round(p.x / 16)},${Math.round(p.y / 16)}`;
        deathSpots[at] = (deathSpots[at] ?? 0) + 1;
        world.status = 'playing'; p.hp = p.maxHp; p.x = world.spawnPoint.x; p.y = world.spawnPoint.y;
      } else break;
    }
    if (Math.abs(p.x - lastX) < 0.2 && !p.onGround) stuckFrames++;
    if (Math.abs(p.x - lastX) < 0.2 && p.onGround && bot.hold <= 0) {
      peturb(bot, rand);
    }
    lastX = p.x;
    maxX = Math.max(maxX, p.x);
    minHp = Math.min(minHp, p.hp);
    enemiesKilled = world.entities.filter((e) => e.kind === 'enemy' && e.dead).length;
  }

  const progress = Math.min(1, maxX / Math.max(1, world.width - 80));
  const reached = world.entities.find((e) => e.type === 'exit' && maxX >= e.x - 8);
  return {
    level,
    seed,
    steps,
    status: world.status,
    won: world.status === 'won' || Boolean(reached),
    progress: Math.round(progress * 1000) / 10,
    deaths,
    deathSpots,
    stuckRatio: Math.round((stuckFrames / steps) * 1000) / 10,
    minHp,
    enemiesKilled,
    enemiesTotal: world.entities.filter((e) => e.kind === 'enemy').length,
    coins: p.coins,
    score: p.score,
    bugs: bug,
  };
}

// The bot holds a heading for a while and only turns when it is genuinely
// blocked. Picking a random direction every frame makes it oscillate in place,
// which produces metrics that describe the bot, not the level.
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

  // A pit that the jump cannot clear would trap a bot that only ever pushes
  // forward — it must be able to give up on a direction and try the other.
  if (gap && p.onGround) {
    const span = pitSpan(world, p, bot.dir);
    if (span > MAX_JUMP_TILES) {
      bot.dir = -bot.dir;
      bot.hold = 40;
    }
  }
  // Steer toward a nearby coin when the ground ahead is safe — but only for a
  // while. A coin on a platform the bot cannot climb would otherwise hold it
  // under that coin forever, and the resulting metrics describe the bot.
  if (coin && !gap && !wall && bot.chase <= 0) { bot.dir = coin.x > p.x ? 1 : -1; bot.chase = 45; bot.chased = coin; }
  if (bot.chase > 0) {
    bot.chase--;
    if (bot.chased?.dead) { bot.chase = 0; bot.chased = null; }
  }
  // A visible pit edge is jumped every time — no human refuses a jump they can
  // see, and making it stochastic turned the death metric into a coin flip.
  // `skill` still governs the judgement calls: walls, attacks, dashes.
  return {
    right: bot.dir > 0,
    left: bot.dir < 0,
    jump: gap || (wall && rand() < skill),
    attack: Boolean(enemy) && rand() < skill,
    dash: wall && rand() < 0.4,
    down: false,
  };
}

function peturb(bot, rand) {
  bot.dir = rand() < 0.5 ? 1 : -1;
  bot.hold = 20 + Math.floor(rand() * 30);
}

// Width of the unsupported stretch ahead, in tiles, at the player's feet row.
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
