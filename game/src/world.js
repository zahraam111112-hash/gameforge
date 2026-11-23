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
  boss:   { hp: 60, w: 34, h: 34, speed: 1.05, dmg: 24, color: '#ff3b5c', score: 400, jump: 0.1 },
};

/** Fallback bounty for anything that dies without a known ENEMY_TYPES entry. */
export const DEFAULT_ENEMY_SCORE = 10;

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
    this.status = 'playing'; // playing | won | lost
    this.keys = 0;
    for (const s of parsed.spawns) this._spawn(s);
    this.rng = mulberry(seed);
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
      const t = ENEMY_TYPES[s.type];
      this.entities.push({
        type: s.type, kind: 'enemy', x: s.x, y: s.y, w: t.w, h: t.h,
        vx: t.speed * (this.rng && this.rng() < 0.5 ? -1 : 1), vy: 0, hp: t.hp, maxHp: t.hp,
        dmg: t.dmg, score: t.score, onGround: false, hurtT: 0, dead: false,
        jumpChance: t.jump, boss: s.type === 'boss', attackT: 0, phase: 0,
      });
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

  /** Axis-separated tile collision. `ignoreOneway` lets entities drop through platforms. */
  moveEntity(e, ignoreOneway = false) {
    let hitX = false;
    let hitY = false;
    e.x += e.vx;
    let t = this._tiles(e);
    for (const { tx, ty } of t) {
      if (this.solidAt(tx, ty)) {
        if (e.vx > 0) e.x = tx * TILE - e.w;
        else if (e.vx < 0) e.x = (tx + 1) * TILE;
        e.vx = 0; hitX = true; break;
      }
    }
    e.y += e.vy;
    e.onGround = false;
    t = this._tiles(e);
    for (const { tx, ty } of t) {
      const solid = this.solidAt(tx, ty);
      const platform = !ignoreOneway && this.onewayAt(tx, ty) && e.vy > 0 && (e.y + e.h - e.vy) <= ty * TILE + 1;
      if (solid || platform) {
        if (e.vy > 0) { e.y = ty * TILE - e.h; e.onGround = true; }
        else if (e.vy < 0 && solid) { e.y = (ty + 1) * TILE; }
        e.vy = 0; hitY = true; break;
      }
    }
    return { hitX, hitY };
  }

  _tiles(e) {
    const x0 = Math.floor(e.x / TILE), x1 = Math.floor((e.x + e.w - 0.01) / TILE);
    const y0 = Math.floor(e.y / TILE), y1 = Math.floor((e.y + e.h - 0.01) / TILE);
    const out = [];
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) out.push({ tx, ty });
    return out;
  }

  groundAhead(tx, ty) {
    return this.solidAt(tx, ty + 1) || this.onewayAt(tx, ty + 1);
  }

  updateEnemies() {
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
      if (e.vx === 0) e.vx = (e.wallDir ?? 1) * (e.boss ? 1.05 : 0.7);
      e.wallDir = e.vx > 0 ? 1 : -1;
      if (e.y > this.height + 64) e.dead = true;
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

    // Strike.
    if (input.attack && p.attackCd <= 0) {
      p.attackCd = 16; p.attackT = 8;
      const hit = { x: p.x + (dirForDash > 0 ? p.w - 2 : -14), y: p.y + 2, w: 18, h: p.h - 4 };
      for (const e of this.entities) {
        if (e.kind !== 'enemy' || e.dead) continue;
        if (aabb(hit, e)) this.damageEnemy(e, 1, dirForDash);
      }
    }
    if (p.attackT > 0) p.attackT--;

    // Pickups / hazards / exit.
    for (const e of this.entities) {
      if (e.dead) continue;
      if (e.type === 'coin' && aabb(p, e)) { e.dead = true; p.score += 5; p.coins++; }
      else if (e.type === 'health' && aabb(p, e)) { e.dead = true; p.hp = Math.min(p.maxHp, p.hp + 25); }
      else if (e.type === 'key' && aabb(p, e)) { e.dead = true; this.keys++; }
      else if (e.type === 'checkpoint' && aabb(p, e)) { e.active = true; p.checkpoint = { x: e.x, y: e.y }; }
      else if (e.type === 'spike' && aabb(p, e)) this.hurtPlayer(p, e.dmg);
      else if (e.type === 'exit' && aabb(p, e)) this.status = 'won';
    }

    for (const e of this.entities) {
      if (e.kind !== 'enemy' || e.dead) continue;
      if (aabb(p, e)) {
        const stomping = p.vy > 1 && p.y + p.h - p.vy <= e.y + 4;
        if (stomping) { this.damageEnemy(e, 2, 0); p.vy = -7; p.energy = Math.min(100, p.energy + 12); }
        else this.hurtPlayer(p, e.dmg, e.x + e.w / 2);
      }
    }
    if (p.hp <= 0) this.status = 'lost';
    if (p.y > this.height + 48) { this.hurtPlayer(p, 999); this.status = 'lost'; }
  }

  damageEnemy(e, amount, knockDir = 0) {
    if (e.hurtT > 0 && !e.boss) return false;
    e.hp -= amount;
    e.hurtT = 8;
    if (knockDir) e.vx = knockDir * 2.2;
    if (e.hp <= 0) { e.dead = true; this.player?.score && 0; return true; }
    return false;
  }

  hurtPlayer(p, amount, fromX) {
    if (p.invuln > 0) return;
    p.hp -= amount;
    p.invuln = 48;
    if (fromX != null) {
      p.vx = (p.x + p.w / 2 < fromX ? -1 : 1) * 3.2;
      p.vy = -4.2;
    }
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
