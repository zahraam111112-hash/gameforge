import { TILE, aabb, clamp, rng as mulberry } from './util.js';
import { LEVELS, parseLevel } from './level.js';

export const GRAVITY = 0.5;
export const MAX_FALL = 11;
export const RUN = 2.55;
export const ACCEL = 0.55;
export const FRICTION = 0.68;
export const AIR_ACCEL = 0.4;
export const JUMP = -8.6;
export const COYOTE = 6;
export const JUMP_BUFFER = 7;
export const DASH_SPEED = 6.2;
export const DASH_FRAMES = 10;
export const DASH_COOLDOWN = 26;

export const ENEMY_TYPES = {
  enemy1: { hp: 2, w: 12, h: 12, speed: 0.7, dmg: 8,  color: '#ff6b6b', score: 10, jump: 0 },
  enemy2: { hp: 4, w: 14, h: 14, speed: 1.15, dmg: 12, color: '#ff9f43', score: 25, jump: 0.22 },
  enemy3: { hp: 7, w: 16, h: 18, speed: 1.45, dmg: 18, color: '#d94bff', score: 50, jump: 0.3 },
  // The boss is an escalation, not a grind: 24 hp against a 3 hp strike is
  // eight contact exchanges. Its cycle/dash pattern is untouched — the fight is
  // short because the numbers are honest, not because the boss stopped moving.
  boss:   { hp: 24, w: 34, h: 34, speed: 1.05, dmg: 24, color: '#ff3b5c', score: 400, jump: 0.1 },
};

/** Frames between strikes. One constant for everything so the boss fight is
 *  scored in the same cadence the rest of the game uses (a full 5 hp enemy3
 *  still needs three swings of the same blade). */
export const ATTACK_CD = 12;

/** How much one strike is worth before the target multiplier is applied. */
export const STRIKE_DAMAGE = 1;

/** Multiplier damageEnemy applies when the target is a boss: 3 damage per
 *  swing against the boss' 24 hp is eight contact exchanges — a short, sharp
 *  gate rather than a grind. Everything else keeps taking base strike damage,
 *  so story enemies and their sims are unchanged. The multiplier is applied in
 *  damageEnemy alone; bounty stays single-source. */
export const BOSS_DAMAGE_MULT = 3;

/** Bosses are HP sponges by design, so chip damage must not stack up: the
 *  i-frames on a non-boss also protect the boss, which paces the fight to the
 *  attack cadence instead of to how fast the player can mash. */
export const BOSS_HURT_FRAMES = 8;

/** Stomps stay at 2 so a boss is not beaten by bouncing on it. */
export const STOMP_DAMAGE = 2;

/** What a fall out of the stage costs. A pit used to be an instant 999 death,
 *  which threw away every health pickup the player had collected in one step
 *  and made the three pit gaps in the story stages the only thing the difficulty
 *  curve was about. Falling now costs a quarter of a full bar and puts the
 *  player back on their last pole: it is a mistake with a price, not a restart. */
export const PIT_DAMAGE = 25;

/** Frames of mercy after a fall-respawn. One second of i-frames at 60Hz, so a
 *  player who lands next to the enemy that shoved them into the pit is not
 *  immediately charged for a second hit they never got to react to. It is also
 *  what lets a fall taken mid-invulnerability (see _fallOut's ignoreInvuln)
 *  still leave the player breathing. */
export const RESPAWN_INVULN = 60;

/** Fallback bounty for anything that dies without a known ENEMY_TYPES entry. */
export const DEFAULT_ENEMY_SCORE = 10;

/* ── Arena waves ────────────────────────────────────────────────────────────
 * The arena has no hand-placed enemies: the constructor seeds deterministic,
 * seeded-RNG-driven surges through the same spawnDirectionalSurge() path the
 * story stages use, and the exit only opens once every wave is cleared. */

/** Sizes of each wave. The first wave is scaled by the seed (see _seedArena). */
export const ARENA_WAVE_SIZES = [4, 6];

/** Frames after which the next wave is forced in even if the last one is
 *  still on its feet — a stalled fight must not deadlock the arena. */
export const ARENA_WAVE_TIMEOUT = 1500;

/** Hard cap on live enemies. Rooms of hundreds of players share this world, so
 *  an uncapped surge would be O(players × enemies) physics again. */
export const ARENA_MAX_ENEMIES = 10;

/** Frames of silence between two 'exitLocked' events, so a player standing on
 *  a locked gate hears one deny sting instead of sixty per second. */
export const EXIT_LOCKED_COOLDOWN = 30;

/** Enemy mix used by surges — the same creatures the story stages place. */
export const SURGE_TYPES = ['enemy1', 'enemy1', 'enemy2', 'enemy3'];

export const isEnemyAlive = (e) => Boolean(e) && e.kind === 'enemy' && !e.dead;

/** How many one-shot events the engine will hold before dropping the oldest.
 *  Consumers (main.js) drain every fixed step, so this is only reached by
 *  headless runs — server rooms and the bot sim never listen to audio. The cap
 *  is what keeps a 3600-step simulation at constant memory. */
export const MAX_EVENTS = 64;

/** A shared, immutable empty result so draining an idle world allocates nothing.
 *  Exported so callers (main.js) can drain a world-less frame without allocating
 *  a fresh array, and so the "no events" case is a single identity. */
export const NO_EVENTS = Object.freeze([]);

/** Kill bounty for an enemy type — the single source of truth for scoring.
 *  Used by the engine when HP hits 0, so browser and headless play agree. */
export function enemyScore(type, fallback = DEFAULT_ENEMY_SCORE) {
  return ENEMY_TYPES[type]?.score ?? fallback ?? DEFAULT_ENEMY_SCORE;
}

export class World {
  constructor(levelId, seed = 1) {
    this.levelId = levelId;
    this.seed = seed;
    const spec = LEVELS[levelId] ?? LEVELS.s1;
    const parsed = parseLevel(spec);
    this.spec = spec;
    this.width = parsed.width * TILE;
    this.height = parsed.height * TILE;
    this.solids = parsed.solids;
    this.oneway = parsed.oneway;
    this.spawnPoint = parsed.player;
    this.entities = [];
    this.frame = 0;
    // One-shot gameplay events, pushed by the engine action that actually
    // happened (a jump that left the ground, a dash that started, a strike that
    // swung) instead of being guessed from input by the presentation layer.
    // main.js drains this after every fixed step and turns each entry into
    // exactly one sound; headless runs simply never drain it (see MAX_EVENTS).
    this.events = [];
    this.status = 'playing'; // playing | won | lost
    this.keys = 0;
    // Arena bookkeeping. Story stages finish on their 'L' exit or their boss;
    // the arena finishes when every seeded wave has been cleared.
    // `wave` counts waves *spawned* so far, `wavesDone` counts waves actually
    // cleared. They live as plain numbers: the old instance field was called
    // wavesCleared and shadowed a prototype method of the same name, so the
    // first arena exit touch called a number and threw. One name, one meaning.
    this.wave = 0;
    this.wavesTotal = 0;
    this.wavesDone = 0;
    this.waveTimer = 0;
    this.exitLockedT = 0;
    this.waveSpawns = [];


    // Seeded before any spawn so every construction with the same seed builds
    // the same world: the surge sizes, the enemy mix, the entry side and the
    // story enemies' first heading all come off this one stream.
    this.rng = mulberry(seed);
    for (const s of parsed.spawns) this._spawn(s);
    if (levelId === 'arena') this._seedArenaWaves();
  }

  /** Seed the arena's deterministic surge schedule: the first wave is sized
   *  from the RNG stream (so seeds differ), the second arrives either when the
   *  first is cleared or after ARENA_WAVE_TIMEOUT frames. Nothing spawns here —
   *  the constructor stays cheap; _updateWaves() pulls them in on frame 0 of
   *  the first tick, through spawnDirectionalSurge() like every story stage. */
  _seedArenaWaves() {
    const [base, second] = ARENA_WAVE_SIZES;
    const jitter = Math.floor(this.rng() * 3) - 1; // -1 | 0 | +1, stable per seed
    const size = clamp(base + jitter, 2, base + 1);
    this.wavesTotal = 2;
    this.wavesDone = 0;
    this.wave = 0;
    this.waveTimer = 0;
    this.waveSpawns = [size, second];
  }

  /** Record one one-shot gameplay event. The engine emits from the code path
   *  that actually did the thing (a swing, a death, a latch) so the audio layer
   *  never has to guess from input or from register diffs — one event, one
   *  sound. The buffer is trimmed from the front at MAX_EVENTS so a headless
   *  run that never drains it cannot grow memory per step. */
  emit(type, data = null) {
    const ev = data ? { type, ...data } : { type };
    this.events.push(ev);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    return ev;
  }

  /** Take every pending event and start a fresh buffer. An idle world returns
   *  the shared frozen NO_EVENTS so draining costs no allocation. */
  drainEvents() {
    if (this.events.length === 0) return NO_EVENTS;
    const out = this.events;
    this.events = [];
    return out;
  }

  /** The one place status changes, so 'win'/'lose' fire exactly once even when
   *  several code paths (exit, boss, pit, hp) could reach the same verdict on
   *  the same frame. */
  _setStatus(next) {
    if (this.status === next) return false;
    this.status = next;
    if (next === 'won') this.emit('win', { frame: this.frame });
    else if (next === 'lost') this.emit('lose', { frame: this.frame });
    return true;
  }

  /** Live enemies that belong to the arena/boss gate (not coins, spikes, exit). */
  countAlive(type = null) {
    let n = 0;
    for (const e of this.entities) if (isEnemyAlive(e) && (type === null || e.type === type)) n++;
    return n;
  }

  /** True when the battle scope the exit is gated on is satisfied: no boss is
   *  alive and, in the arena, every seeded wave has been cleared and spawned. */
  wavesCleared() {
    return this.wavesTotal > 0
      && this.wavesCleared >= this.wavesTotal
      && this.wave === this.wavesTotal;
  }

  exitUnlocked() {
    if (this.countAlive('boss') > 0) return false;
    if (this.levelId === 'arena') return this.wavesCleared();
    return true;
  }

  /** Advance the arena schedule. Runs once per fixed step, before the players,
   *  so the world state a client receives is the same for every player. */
  _updateWaves() {
    if (this.levelId !== 'arena' || this.wavesTotal === 0) return;
    // Once every seeded wave has been pulled in there is nothing left to spawn,
    // ever: the gate below means a surge can never bring a third wave in.
    if (this.wave >= this.wavesTotal) return;
    this.waveTimer++;
    const alive = this.countAlive('enemy') + this.countAlive('boss');
    const spawnNow = this.wave === 0
      ? true                         // frame 0: the arena is never empty
      : alive === 0 || this.waveTimer >= ARENA_WAVE_TIMEOUT;
    if (!spawnNow) return;
    if (this.wave > 0) this.wavesCleared = this.wave; // the previous wave is down
    const wanted = this.waveSpawns[this.wave] ?? 0;
    // The cap is per-world, not per-wave: rooms of hundreds of players share it.
    const n = clamp(wanted, 0, Math.max(0, ARENA_MAX_ENEMIES - alive));
    this.spawnDirectionalSurge(n);
    this.wave++;
    this.waveTimer = 0;
    if (this.wave >= this.wavesTotal && alive === 0) this.wavesCleared = this.wavesTotal;
  }

  /** Spawn `n` enemies from both sides of the stage, sweeping inward. The paths
   *  and types come off this.seeded stream, so a replay of the same seed places
   *  the same creatures at the same coordinates — sims stay comparable across
   *  rounds. Story stages call this too: one spawn path, not two. */
  spawnDirectionalSurge(n = 1, opts = {}) {
    const spawned = [];
    const total = Math.max(0, Math.floor(n));
    for (let i = 0; i < total; i++) {
      const type = opts.type ?? SURGE_TYPES[Math.floor(this.rng() * SURGE_TYPES.length)] ?? 'enemy1';
      const t = ENEMY_TYPES[type] ?? ENEMY_TYPES.enemy1;
      const left = i % 2 === 0;
      const inset = 12 + Math.floor(this.rng() * 48);
      const x = clamp(left ? inset : this.width - inset - t.w, 2, this.width - t.w - 2);
      // High enough to be seen walking in, low enough that gravity does the
      // rest; the player's own spawn floor is one tile below.
      const spread = Math.floor(this.rng() * 40);
      const y = clamp(this.spawnPoint.y - t.h - 8 - spread, 2, this.height - t.h - TILE);
      const e = this._makeEnemy(type, x, y);
      e.vx = t.speed * (left ? 1 : -1) * (0.8 + this.rng() * 0.4);
      e.dir = left ? 1 : -1;
      this.entities.push(e);
      spawned.push(e);
    }
    return spawned;
  }

  /** The one place an enemy object is built, so stats, bounty and flags can
   *  never drift between story spawns, surges and the boss. */
  _makeEnemy(type, x, y) {
    const t = ENEMY_TYPES[type] ?? ENEMY_TYPES.enemy1;
    // Sequential per world, so a seed replays the exact same ids and an event
    // stream can be compared element for element between two runs.
    this._enemyIds = (this._enemyIds ?? 0) + 1;
    return {
      id: this._enemyIds, type, kind: 'enemy', x, y, w: t.w, h: t.h,
      vx: t.speed * (this.rng() < 0.5 ? -1 : 1), vy: 0, hp: t.hp, maxHp: t.hp,
      dmg: t.dmg, score: t.score, onGround: false, hurtT: 0, dead: false,
      fell: false, jumpChance: t.jump, boss: type === 'boss', attackT: 0, phase: 0,
    };
  }

  _spawn(s) {
    if (s.type === 'coin') {
      this.entities.push({ type: 'coin', x: s.x, y: s.y, w: 6, h: 6, dead: false, bob: 0 });
    } else if (s.type === 'health') {
      this.entities.push({ type: 'health', x: s.x, y: s.y, w: 8, h: 8, dead: false, bob: 0 });
    } else if (s.type === 'key') {
      this.entities.push({ type: 'key', x: s.x, y: s.y, w: 8, h: 6, dead: false, bob: 0 });
    } else if (s.type === 'exit') {
      this.entities.push({ type: 'exit', x: s.x, y: s.y, w: 16, h: 32, dead: false });
    } else if (s.type === 'checkpoint') {
      this.entities.push({ type: 'checkpoint', x: s.x, y: s.y, w: 12, h: 24, dead: false, active: false });
    } else if (s.type === 'spike') {
      this.entities.push({ type: 'spike', x: s.x, y: s.y, w: 16, h: 5, dead: false, dmg: 14 });
    } else if (s.type in ENEMY_TYPES) {
      this.entities.push(this._makeEnemy(s.type, s.x, s.y));
    }
  }

  solidAt(tx, ty) {
    if (ty < 0) return false;
    if (tx < 0 || tx >= this.solids[0].length) return true;
    if (ty >= this.solids.length) return false;
    return this.solids[ty][tx];
  }

  onewayAt(tx, ty) {
    if (ty < 0 || ty >= this.oneway.length || tx < 0 || tx >= this.oneway[0].length) return false;
    return this.oneway[ty][tx];
  }

  /** Axis-separated tile collision. `ignoreOneway` lets entities drop through platforms.
   *  The tile range is walked in place: this runs for every player and enemy on
   *  every tick, and building an array of {tx,ty} objects per axis was the whole
   *  cost of a 100-player room (2ms per player per tick, against a 33ms budget). */
  moveEntity(e, ignoreOneway = false) {
    let hitX = false;
    let hitY = false;
    const w = e.w, h = e.h;
    e.x += e.vx;
    let x0 = Math.floor(e.x / TILE), x1 = Math.floor((e.x + w - 0.01) / TILE);
    let y0 = Math.floor(e.y / TILE), y1 = Math.floor((e.y + h - 0.01) / TILE);
    for (let ty = y0; ty <= y1 && !hitX; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (!this.solidAt(tx, ty)) continue;
        if (e.vx > 0) e.x = tx * TILE - w;
        else if (e.vx < 0) e.x = (tx + 1) * TILE;
        e.vx = 0; hitX = true; break;
      }
    }
    e.y += e.vy;
    e.onGround = false;
    x0 = Math.floor(e.x / TILE); x1 = Math.floor((e.x + w - 0.01) / TILE);
    y0 = Math.floor(e.y / TILE); y1 = Math.floor((e.y + h - 0.01) / TILE);
    for (let ty = y0; ty <= y1 && !hitY; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const solid = this.solidAt(tx, ty);
        const platform = !ignoreOneway && this.onewayAt(tx, ty) && e.vy > 0 && (e.y + h - e.vy) <= ty * TILE + 1;
        if (!solid && !platform) continue;
        if (e.vy > 0) { e.y = ty * TILE - h; e.onGround = true; }
        else if (e.vy < 0 && solid) { e.y = (ty + 1) * TILE; }
        e.vy = 0; hitY = true; break;
      }
    }
    return { hitX, hitY };
  }

  groundAhead(tx, ty) {
    return this.solidAt(tx, ty + 1) || this.onewayAt(tx, ty + 1);
  }

  updateEnemies() {
    // Once per fixed step (tick() and tickPlayerOnly() both call this), so the
    // 'locked gate' sting is rate-limited by frames, not by how many players
    // happen to be standing on the exit.
    if (this.exitLockedT > 0) this.exitLockedT--;
    for (const e of this.entities) {
      if (e.kind !== 'enemy' || e.dead) continue;
      if (e.hurtT > 0) e.hurtT--;
      e.vy = Math.min(e.vy + GRAVITY, MAX_FALL);

      if (e.boss) {
        this._updateBoss(e);
      } else {
        // Walk; turn at ledges and walls.
        const dir = e.vx >= 0 ? 1 : -1;
        const frontX = dir > 0 ? e.x + e.w + 1 : e.x - 1;
        const footTy = Math.floor((e.y + e.h + 2) / TILE);
        const frontTx = Math.floor(frontX / TILE);
        const ledge = e.onGround && !this.groundAhead(frontTx, Math.floor((e.y + e.h) / TILE));
        if (ledge) e.vx = -e.vx;
        if (e.onGround && this.rng() < e.jumpChance) e.vy = -6.2;
      }
      const before = e.x;
      this.moveEntity(e);
      if (e.vx === 0 && Math.abs(e.x - before) < 0.001) {
        // Bounced into a wall.
        e.vx = (e.wallDir ?? 1) * Math.abs(e.vx || (e.boss ? 1.05 : 0.7)) * -1;
      }
      if (e.vx === 0) e.vx = (this.rng() < 0.5 ? -1 : 1) * (e.boss ? 1.05 : 0.7);
      e.wallDir = e.vx > 0 ? 1 : -1;
      // A pit is not a kill. This used to be `e.dead = true`, which handed out
      // bounty for an enemy that walked off a ledge on its own — the player got
      // paid for nothing, and the arena's "wave cleared" check could not tell a
      // real kill from a fall. Falling now pays nothing (attacker is null),
      // marks e.fell for the renderer, and still routes through damageEnemy so
      // there is exactly one place that decides what death means.
      if (e.y > this.height + 64) this.damageEnemy(e, e.hp, 0, null, { fell: true });
    }
  }

  _updateBoss(b) {
    b.attackT++;
    const cycle = b.attackT % 240;
    if (cycle === 0) { b.vy = -8; b.vx = (this.rng() < 0.5 ? -1 : 1) * 3; b.phase = 1; }
    if (cycle === 120) { b.vx *= 1.6; b.phase = 2; }
    if (b.onGround && Math.abs(b.vx) < 0.2) b.vx = (this.rng() < 0.5 ? -1 : 1) * 1.6;
  }

  /** Player physics step. Input: {left,right,jump,dash,attack} booleans. */
  stepPlayer(p, input) {
    p.coyote = p.onGround ? COYOTE : Math.max(0, (p.coyote ?? COYOTE) - 1);
    if (input.jump) p.jumpBuffer = JUMP_BUFFER; else p.jumpBuffer = Math.max(0, (p.jumpBuffer ?? 0) - 1);

    const accel = p.onGround ? ACCEL : AIR_ACCEL;
    if (p.dashT > 0) {
      p.dashT--;
      p.vx = p.dashDir * DASH_SPEED;
      p.vy = 0;
    } else {
      if (input.left) p.vx = Math.max(-RUN, p.vx - accel);
      else if (input.right) p.vx = Math.min(RUN, p.vx + accel);
      else if (p.onGround) p.vx *= FRICTION;
      else p.vx *= 0.96;

      if (input.jump && p.jumpBuffer > 0 && p.coyote > 0) {
        p.vy = JUMP; p.coyote = 0; p.jumpBuffer = 0; p.jumped = true;
      }
      if (!input.jump && p.vy < -3) p.vy = -3; // variable jump height
      p.vy = Math.min(p.vy + GRAVITY, MAX_FALL);
    }

    if (input.dash && p.dashCd <= 0 && p.energy >= 30) {
      p.dashT = DASH_FRAMES; p.dashCd = DASH_COOLDOWN; p.energy -= 30;
      p.dashDir = input.left ? -1 : input.right ? 1 : (p.facing ?? 1);
      p.invuln = Math.max(p.invuln ?? 0, 6);
    }
    if (p.dashCd > 0) p.dashCd--;
    if (p.attackCd > 0) p.attackCd--;
    if (p.invuln > 0) p.invuln--;

    if (input.right) p.facing = 1;
    if (input.left) p.facing = -1;

    const dirForDash = p.dashT > 0 ? p.dashDir : p.facing ?? 1;
    p.vx = clamp(p.vx, -Math.max(RUN, DASH_SPEED), Math.max(RUN, DASH_SPEED));

    this.moveEntity(p, p.dashT > 0);
    if (p.onGround) { p.energy = Math.min(100, p.energy + 1.1); p.dashT = 0; }
    p.x = clamp(p.x, 0, this.width - p.w);

    // Strike. One constant for the cadence and one for the damage: the boss
    // multiplier lives in damageEnemy, so "how hard do I hit" has a single home.
    if (input.attack && p.attackCd <= 0) {
      p.attackCd = ATTACK_CD; p.attackT = 8;
      // Emitted before the hits resolve so a listener hears the swing and then
      // the kill it caused, in that order. Holding the button yields one strike
      // event per ATTACK_CD frames, never one per frame.
      this.emit('strike', { x: Math.round(p.x), y: Math.round(p.y), dir: dirForDash });
      const hit = { x: p.x + (dirForDash > 0 ? p.w - 2 : -14), y: p.y + 2, w: 18, h: p.h - 4 };
      for (const e of this.entities) {
        if (e.kind !== 'enemy' || e.dead) continue;
        if (aabb(hit, e)) this.damageEnemy(e, STRIKE_DAMAGE, dirForDash, p);
      }
    }
    if (p.attackT > 0) p.attackT--;

    // Pickups / hazards / exit. Each latch emits once because the entity is
    // consumed or flagged: a checkpoint already active is not re-emitted, so
    // standing on it cannot machine-gun the sting.
    for (const e of this.entities) {
      if (e.dead) continue;
      if (e.type === 'coin' && aabb(p, e)) {
        e.dead = true; p.score += 5; p.coins++;
        this.emit('coin', { coins: p.coins, score: p.score });
      } else if (e.type === 'health' && aabb(p, e)) {
        e.dead = true; p.hp = Math.min(p.maxHp, p.hp + 25);
        this.emit('heal', { hp: p.hp });
      } else if (e.type === 'key' && aabb(p, e)) {
        e.dead = true; this.keys++;
        this.emit('key', { keys: this.keys });
      } else if (e.type === 'checkpoint' && aabb(p, e)) {
        // The latch is the event: only an inactive checkpoint fires it, and it
        // stays latched, so one crossing is one sound.
        if (!e.active) {
          e.active = true;
          p.checkpoint = { x: e.x, y: e.y };
          this.emit('checkpoint', { id: e.id ?? null, x: Math.round(e.x), y: Math.round(e.y) });
        }
      } else if (e.type === 'spike' && aabb(p, e)) {
        this.hurtPlayer(p, e.dmg, null, 'spike');
      } else if (e.type === 'exit' && aabb(p, e)) {
        this._reachExit();
      }
    }

    for (const e of this.entities) {
      if (e.kind !== 'enemy' || e.dead) continue;
      if (aabb(p, e)) {
        const stomping = p.vy > 1 && p.y + p.h - p.vy <= e.y + 4;
        if (stomping) {
          this.damageEnemy(e, STOMP_DAMAGE, 0, p, { strike: false });
          p.vy = -7; p.energy = Math.min(100, p.energy + 12);
        } else {
          this.hurtPlayer(p, e.dmg, e.x + e.w / 2, 'enemy');
        }
      }
    }
    if (p.hp <= 0) this._setStatus('lost');
    // A pit is a mistake with a price, not a restart: _fallOut charges
    // PIT_DAMAGE and puts the player back on their last pole. It only ends the
    // run when that damage empties the bar, which hurtPlayer decides.
    if (p.y > this.height + 48) this._fallOut(p);
  }

  /** Fallen out of the stage. Kill the momentum (so the next stepPlayer does
   *  not continue a dashing fall), bill the player PIT_DAMAGE — through
   *  hurtPlayer with ignoreInvuln, so dropping into a pit while dashing (dashes
   *  grant i-frames) or right after a hit still costs the same HP as any other
   *  fall — and, if they survive it, put them back on the authored checkpoint
   *  pole with RESPAWN_INVULN frames of mercy.
   *
   *  The 'respawn' event is emitted only when the player actually comes back:
   *  a fatal fall ends the run through hurtPlayer's hp<=0 path ('lose'), never
   *  from here, so 'lost' can only ever be decided in one place. */
  _fallOut(p) {
    p.vx = 0; p.vy = 0;
    const hit = this.hurtPlayer(p, PIT_DAMAGE, null, 'pit', { ignoreInvuln: true, fell: true });
    // Dead, or the world already ended this frame (a boss win, say): no respawn.
    if (p.hp <= 0 || this.status !== 'playing') return false;
    // The authored pole wins over the spawn tile: that is the whole point of
    // the 'C' tiles in level.js, and p.checkpoint is set by crossing one.
    const at = p.checkpoint || this.spawnPoint;
    p.x = at.x; p.y = at.y;
    p.vx = 0; p.vy = 0;
    p.onGround = false;
    p.coyote = 0; p.jumpBuffer = 0;
    // Clear the attack/dash state so a fall cannot carry a swing or a dash
    // through the teleport, and so the player always starts the retry neutral.
    p.attackT = 0; p.attackCd = 0; p.dashT = 0;
    p.invuln = RESPAWN_INVULN;
    this.emit('respawn', {
      id: p.id ?? 'player', x: Math.round(p.x), y: Math.round(p.y),
      hp: p.hp, cause: 'pit', checkpoint: Boolean(p.checkpoint), applied: hit,
    });
    return true;
  }

  /** Touch the exit flag. An unlocked gate wins; a locked one denies with a
   *  rate-limited event (EXIT_LOCKED_COOLDOWN frames) so standing on it hears
   *  one thud rather than sixty per second. */
  _reachExit() {
    if (this.exitUnlocked()) { this._setStatus('won'); return; }
    if (this.exitLockedT > 0) return;
    this.exitLockedT = EXIT_LOCKED_COOLDOWN;
    this.emit('exitLocked', { boss: this.countAlive('boss'), wave: this.wave, wavesTotal: this.wavesTotal });
  }

  damageEnemy(e, amount, knockDir = 0, attacker = null, opts = {}) {
    if (e.hurtT > 0 && !e.boss) return false;
    const fell = Boolean(opts.fell);
    e.hp -= amount;
    e.hurtT = 8;
    if (knockDir) e.vx = knockDir * 2.2;
    // Bounty is awarded here, in the engine, so a headless run and a browser
    // run score identically — the renderer only adds the visual feedback.
    if (e.hp <= 0) {
      e.dead = true;
      if (attacker) attacker.score += enemyScore(e.type, e.score);
      if (fell) {
        // A pit is a fall, not a kill: it pays no bounty and gets its own cue,
        // so the player never hears a "kill" for an enemy that fell on its own.
        e.fell = true;
        this.emit('fell', { who: 'enemy', id: e.id ?? null, type: e.type, x: Math.round(e.x), y: Math.round(e.y) });
      } else {
        this.emit('kill', {
          id: e.id ?? null,
          type: e.type,
          boss: Boolean(e.boss),
          score: enemyScore(e.type, e.score),
          // attacker is the player object the caller acted for, null for a
          // world-side death (an enemy that walked into a hazard).
          attacker: attacker?.id ?? 'player',
          // True when the strike took the last hp on this frame, not a stomp.
          byStrike: Boolean(attacker) && opts.strike !== false,
          x: Math.round(e.x),
          y: Math.round(e.y),
        });
      }
      return true;
    }
    return false;
  }

  hurtPlayer(p, amount, fromX, cause = 'contact') {
    if (p.invuln > 0) return;
    p.hp -= amount;
    p.invuln = 48;
    if (fromX != null) {
      p.vx = (p.x + p.w / 2 < fromX ? -1 : 1) * 3.2;
      p.vy = -4.2;
    }
    // The player's own life is clamped at 0 so an overkill of 999 from a pit
    // does not leave a nonsense hp value in the HUD or the snapshots.
    if (p.hp < 0) p.hp = 0;
    this.emit('hurt', { id: p.id ?? 'player', hp: p.hp, amount, cause });
  }

  /** Multiplayer variant: full physics + combat for one player, no world status
   *  changes (rooms handle respawn). Shared with the browser via the same code. */
  tickPlayerOnly(p, input) {
    this.frame++;
    const wasDead = p.dead;
    this.stepPlayer(p, input);
    if (p.hp <= 0 && !wasDead) { p.dead = true; p.respawnT = 90; }
    this.updateEnemies();
  }

  tick(p, input) {
    if (this.status !== 'playing') return;
    this.frame++;
    this.stepPlayer(p, input);
    this.updateEnemies();
  }

  serialize() {
    return {
      levelId: this.levelId,
      frame: this.frame,
      status: this.status,
      entities: this.entities.filter((e) => !e.dead).map((e) => ({
        type: e.type, x: Math.round(e.x), y: Math.round(e.y), hp: e.hp ?? 0,
        vx: Math.round((e.vx ?? 0) * 10) / 10, active: e.active ?? false,
      })),
    };
  }
}

export function makePlayer(x, y) {
  return {
    x, y, w: 10, h: 14, vx: 0, vy: 0, onGround: false,
    hp: 100, maxHp: 100, energy: 100, score: 0, coins: 0,
    facing: 1, coyote: 0, jumpBuffer: 0, dashT: 0, dashCd: 0, dashDir: 1,
    attackCd: 0, attackT: 0, invuln: 0, checkpoint: null, jumped: false,
  };
}
