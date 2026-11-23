// Headless bot play — the harness's semantic test. Runs the real game logic
// (same modules the browser ships) with a scripted bot and returns metrics that
// agents and the site can reason about without a browser.
import { World, makePlayer, RUN } from '../game/src/world.js';
import { LEVELS } from '../game/src/level.js';
import { rng } from '../game/src/util.js';

export function simulate({ level = 's1', steps = 3600, seed = 1, skill = 0.82 }) {
  const spec = LEVELS[level] ?? LEVELS.s1;
  const world = new World(level, seed);
  const p = makePlayer(world.spawnPoint.x, world.spawnPoint.y);
  const rand = rng(seed);
  let maxX = p.x;
  let deaths = 0;
  let stuckFrames = 0;
  let lastX = p.x;
  let minHp = p.hp;
  let enemiesKilled = 0;
  const bug = [];

  for (let i = 0; i < steps; i++) {
    const input = botInput(p, world, rand, skill);
    rand();
    world.tick(p, input);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) { bug.push(`NaN position at frame ${i}`); break; }
    if (p.y > world.height + 200) { bug.push(`fell out of world at ${Math.round(p.x)}`); break; }
    if (world.status !== 'playing') {
      if (world.status === 'lost') { deaths++; world.status = 'playing'; p.hp = p.maxHp; p.x = world.spawnPoint.x; p.y = world.spawnPoint.y; }
      else break;
    }
    if (Math.abs(p.x - lastX) < 0.2 && !p.onGround) stuckFrames++;
    if (Math.abs(p.x - lastX) < 0.2 && p.onGround && rand() < 0.05) p.vx += (rand() - 0.5) * RUN;
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
    stuckRatio: Math.round((stuckFrames / steps) * 1000) / 10,
    minHp,
    enemiesKilled,
    enemiesTotal: world.entities.filter((e) => e.kind === 'enemy').length,
    coins: p.coins,
    score: p.score,
    bugs: bug,
  };
}

function botInput(p, world, rand, skill) {
  const lookAhead = 26;
  const dir = rand() < 0.5 ? 1 : -1;
  const aheadX = p.x + dir * lookAhead;
  const tx = Math.floor(aheadX / 16);
  const ty = Math.floor((p.y + p.h) / 16) + 1;
  const gap = !world.solidAt(tx, ty) && !world.onewayAt(tx, ty);
  const wall = world.solidAt(Math.floor((p.x + p.w / 2 + dir * 10) / 16), Math.floor((p.y + p.h / 2) / 16));
  const enemy = world.entities.find((e) => e.kind === 'enemy' && !e.dead && Math.abs(e.x - p.x) < 40);
  return {
    right: dir > 0,
    left: dir < 0,
    jump: (gap || wall) && rand() < skill,
    attack: Boolean(enemy) && rand() < skill,
    dash: wall && rand() < 0.4,
    down: false,
  };
}
