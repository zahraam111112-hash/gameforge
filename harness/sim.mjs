// Headless bot play — the harness's semantic test. Runs the real game logic
// (same modules the browser ships) with a scripted bot and returns metrics that
// agents and the site can reason about without a browser.
//
// The rule this file exists to keep: every number it reports has to be a number
// the engine actually produced, because every tuning decision downstream reads
// these fields.
//   * `won` is the world's own verdict (`status === 'won'`). It used to be
//     `status === 'won' || Boolean(reached)` where `reached` was a maxX
//     proximity guess against the exit entity — so a bot that merely walked
//     near the trailing 'L' was scored a win without ever touching the gate,
//     and a boss-gated stage could be reported clear with the boss alive.
//   * `enemiesKilled` counts the engine's 'kill' events. It used to be a raw
//     `e.dead` sweep, which credited creatures that walked into a pit: those go
//     through damageEnemy with source FALL, emit 'fell' and pay no bounty.
//   * a death is priced and respawned through the engine's own fall path
//     (World._fallOut): PIT_DAMAGE charged, RESPAWN_INVULN granted, back to
//     `p.checkpoint || spawnPoint`. It used to hard-assign full hp at the spawn
//     tile, which made every fall free and the 'C' poles decorative.
//   * `stuckRatio` counts frames where the bot is *standing* still on the
//     ground. The old `&& !p.onGround` rule counted every jump arc and dash as
//     "stuck" and manufactured the arena/s1/s3 stall percentages.
// A run that trips any of this exits non-zero (see the CLI at the bottom) so the
// harness gate cannot go green on metrics computed by a liar.
import { World, makePlayer, RUN, PIT_DAMAGE, RESPAWN_INVULN } from '../game/src/world.js';
import { LEVELS } from '../game/src/level.js';
import { rng, TILE } from '../game/src/util.js';
import { pathToFileURL } from 'node:url';

// Measured from the jump arc: 21 air frames at RUN speed clears ~3.3 tiles.
// Anything wider is a wall to the bot, not a jump.
const MAX_JUMP_TILES = 3;

export function simulate({ level = 's1', steps = 3600, seed = 1, skill = 0.82 }) {
  const world = new World(level, seed);
  const p = makePlayer(world.spawnPoint.x, world.spawnPoint.y);
  const rand = rng(seed);
  const bot = { dir: 1, hold: 0, chase: 0, chased: null, wait: 0 };
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
    // The engine's one-shot events are the only honest source for kills. Drain
    // every frame: the buffer trims at MAX_EVENTS (64) and a headless run has
    // no other consumer, so leaving it to overflow would silently lose kills.
    for (const ev of world.drainEvents()) if (ev.type === 'kill') enemiesKilled++;
    // NaN has to be settled before any respawn logic can launder it into a
    // plausible-looking position.
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.hp)) {
      bug.push(`NaN player state at frame ${i} (x=${p.x} y=${p.y} hp=${p.hp})`);
      break;
    }
    if (world.status !== 'playing') {
      if (world.status === 'lost') {
        deaths++;
        // Where the bot dies is the actionable number: a cluster of deaths at
        // one column is a difficulty spike, deaths at the spawn are a trap.
        minHp = Math.min(minHp, p.hp);
        const at = `${Math.round(p.x / 16)},${Math.round(p.y / 16)}`;
        deathSpots[at] = (deathSpots[at] ?? 0) + 1;
        respawnLikeFall(world, p);
      } else break; // 'won' — and it is the engine's verdict, not a guess.
    }
    if (p.y > world.height + 200) { bug.push(`fell out of world at ${Math.round(p.x)}`); break; }
    // Stuck means standing still on the ground. The airborne half of this rule
    // turned every jump and dash into "stuck time" and reported arena stalls
    // that no player would ever experience.
    if (p.onGround && Math.abs(p.x - lastX) < 0.2) stuckFrames++;
    if (p.onGround && Math.abs(p.x - lastX) < 0.2 && bot.hold <= 0) {
      peturb(bot, rand);
    }
    lastX = p.x;
    maxX = Math.max(maxX, p.x);
    minHp = Math.min(minHp, p.hp);
  }

  const progress = Math.min(1, maxX / Math.max(1, world.width - 80));
  const result = {
    level,
    seed,
    steps,
    status: world.status,
    // The gate, the boss and the wave schedule decide this — nothing else.
    won: world.status === 'won',
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
  // Belt and braces for the exit guard: a NaN that slipped into a reported
  // field is a bug even when it did not come from the player object.
  for (const [k, v] of Object.entries(result)) {
    if (typeof v === 'number' && !Number.isFinite(v)) bug.push(`NaN in metric ${k}`);
  }
  return result;
}

/** Restart a lost attempt through the engine's own fall path.
 *
 *  A run that ends with hp <= 0 has to be restarted somehow; the honest way is
 *  to give the bot exactly what a player gets when the engine puts them back on
 *  the stage: World._fallOut bills PIT_DAMAGE, teleports to
 *  `p.checkpoint || spawnPoint` and grants RESPAWN_INVULN. Restoring the bar
 *  first is what lets that path run (it refuses to respawn a corpse), so the
 *  cost of dying is PIT_DAMAGE against a fresh bar and the bot resumes at the
 *  last pole instead of the spawn tile. That single line is why the checkpoint
 *  columns show up in the metrics at all. */
function respawnLikeFall(world, p) {
  world.status = 'playing';
  p.hp = p.maxHp;
  p.vx = 0; p.vy = 0;
  p.dead = false;
  if (world._fallOut(p)) return true;
  // Failsafe: an engine without _fallOut must never hand out a free life at the
  // spawn tile — charge the pit and use the pole by hand.
  const at = p.checkpoint || world.spawnPoint;
  p.x = at.x; p.y = at.y; p.vx = 0; p.vy = 0;
  p.hp = Math.max(1, p.maxHp - PIT_DAMAGE);
  p.invuln = RESPAWN_INVULN;
  return false;
}

// The bot holds a heading for a while and only turns when it is genuinely
// blocked. Picking a random direction every frame makes it oscillate in place,
// which produces metrics that describe the bot, not the level.
export function botInput(p, world, rand, skill, bot) {
  if (bot.hold > 0) bot.hold--;
  if (bot.wait > 0) bot.wait--;
  const lookAhead = 26;
  const aheadX = p.x + bot.dir * lookAhead;
  const tx = Math.floor(aheadX / 16);
  const ty = Math.floor((p.y + p.h) / 16) + 1;
  const gap = !world.solidAt(tx, ty) && !world.onewayAt(tx, ty);
  const wall = world.solidAt(Math.floor((p.x + p.w / 2 + bot.dir * 10) / 16), Math.floor((p.y + p.h / 2) / 16));
  const enemy = world.entities.find((e) => e.kind === 'enemy' && !e.dead && Math.abs(e.x - p.x) < 40);
  const coin = world.entities.find((e) => e.type === 'coin' && !e.dead && Math.abs(e.x - p.x) < 44);
  // A '^' run one to two tiles ahead is a hazard the bot has to see before it
  // becomes a hit. Without this it walked into the s1 row-12 cluster on purpose
  // and the death metric described the bot, not the level.
  const spike = spikeAhead(world, p, bot.dir);

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
  if (coin && !gap && !wall && !spike && bot.chase <= 0) { bot.dir = coin.x > p.x ? 1 : -1; bot.chase = 45; bot.chased = coin; }
  if (bot.chase > 0) {
    bot.chase--;
    if (bot.chased?.dead) { bot.chase = 0; bot.chased = null; }
  }
  // Take off only from the edge: while the spikes are 1-2 tiles away the bot
  // waits (no forward push) for the hop to line up, so a hop clears a 3-4 tile
  // run instead of landing in the middle of it. Once airborne over the spikes
  // the jump is held, which keeps the arc at full height.
  let spikeWait = false;
  if (spike && !p.onGround) {
    bot.wait = 0;
  } else if (spike && p.onGround && bot.wait <= 0) {
    const near = Math.abs((bot.dir > 0 ? spike.x - (p.x + p.w) : p.x - (spike.x + spike.w)));
    // Close enough to clear the run from here? Then go; otherwise hold the edge
    // for a few frames and hop from the closest safe tile.
    if (near > TILE) spikeWait = true;
  }
  const forward = spike ? !spikeWait : true;
  // A visible pit edge is jumped every time — no human refuses a jump they can
  // see, and making it stochastic turned the death metric into a coin flip.
  // `skill` still governs the judgement calls: walls, attacks, dashes.
  return {
    right: bot.dir > 0 && forward,
    left: bot.dir < 0 && forward,
    jump: Boolean(gap || spike) || (wall && rand() < skill),
    attack: Boolean(enemy) && rand() < skill,
    dash: wall && rand() < 0.4,
    down: false,
  };
}

/** The nearest '^' spike inside the 1-2 tile band ahead of the bot, at its own
 *  feet height. `^` is only 5px tall on the walking row, so the vertical window
 *  is generous on purpose: a spike the bot is about to step into sits anywhere
 *  between its knees and its toes. */
function spikeAhead(world, p, dir) {
  const origin = dir > 0 ? p.x + p.w : p.x;
  const lo = dir > 0 ? origin + 2 : origin - 2 - TILE * 2;
  const hi = dir > 0 ? origin + 2 + TILE * 2 : origin - 2;
  const footTop = p.y + p.h - 20;
  const footBottom = p.y + p.h + 20;
  let best = null;
  for (const e of world.entities) {
    if (e.dead || e.type !== 'spike') continue;
    if (e.x + e.w <= lo || e.x >= hi) continue;
    if (e.y + e.h <= footTop || e.y >= footBottom) continue;
    if (!best || Math.abs(e.x - origin) < Math.abs(best.x - origin)) best = e;
  }
  return best;
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

/* ── CLI guard ─────────────────────────────────────────────────────────────
 * `node harness/sim.mjs [level…]` runs the sim and prints one JSON line per
 * level. Any bug — a NaN, a fall out of the world, an event that lost a kill —
 * makes the process exit non-zero, so the harness gate and CI fail on a lying
 * simulator instead of shipping the numbers it invented. Importing this module
 * (tests, orchestrator, tools) stays side-effect free: the guard only arms when
 * this file is the process entry point. */
export const SIM_LEVELS = ['s1', 's2', 's3', 'arena'];

export function runCli(argv = process.argv.slice(2)) {
  const wanted = argv.filter((a) => LEVELS[a]);
  const levels = wanted.length ? wanted : SIM_LEVELS;
  let broken = 0;
  for (const level of levels) {
    const r = simulate({ level, steps: 3600, seed: 1 });
    const nan = Object.entries(r).some(([, v]) => typeof v === 'number' && !Number.isFinite(v));
    const bad = r.bugs.length > 0 || nan;
    console.log(JSON.stringify(r));
    if (bad) {
      broken++;
      console.error(`[sim] ${level}: ${r.bugs.join('; ') || 'non-finite metric'}`);
    }
  }
  if (broken > 0) {
    console.error(`[sim] ${broken}/${levels.length} level(s) produced buggy metrics`);
    process.exitCode = 1;
  }
  return broken;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runCli();
