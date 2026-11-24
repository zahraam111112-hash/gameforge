import { TILE, VIEW_W, VIEW_H, lerp } from './util.js';

const PARALLAX = [
  { factor: 0.15, band: 0.55, color: 'far', amp: 26 },
  { factor: 0.35, band: 0.72, color: 'near', amp: 14 },
];

/* ── Fixed-pool FX layer ────────────────────────────────────────────────────
 * One bounded place for the short, loud feedback a run needs: a respawn flash, a
 * grey puff where a body left the stage, the pulse a locked door finally gives,
 * a ring on the pole that just saved you, a kill burst and small sparkles for
 * coins / hurt / heal / key.
 *
 * The contract (shared with main.js, which owns the event drain):
 *   renderer.fx(kind, x, y, opts)  — queue one effect, world coordinates.
 *   renderer.stepFx(dt)            — age the pool by dt *seconds* and retire.
 * Both are safe in any order, before or after a draw, and unknown kinds are a
 * silent no-op rather than a throw: presentation must never be able to break a
 * run. Nothing here allocates past the 16 slots built in the constructor, and
 * nothing here calls Math.random, so a seeded run replays the same effects.
 *
 * Draw budget: every active slot paints exactly ONE canvas primitive (one fill
 * or one stroke — multi-part shapes live inside a single path), so a saturated
 * pool is at most FX_POOL_SIZE draw calls per frame. That is the number the FX
 * pass adds to the frame, and it cannot grow with enemy count or room size.
 *
 * Draw order: world-space effects go in the existing translated pass, after the
 * tiles/entities/player/particles and before the vignette; the respawn flash is
 * full-frame, so it is painted after the translate is restored and still before
 * the vignette (i.e. it blooms the whole screen without washing out the frame).
 */
export const FX_POOL_SIZE = 16;

/** Shared immutable stand-in so a call without opts allocates nothing. */
const NO_OPTS = Object.freeze({});
const TAU = Math.PI * 2;

/** Lifetime of each kind, in seconds. A respawn flash is a quarter second: long
 *  enough to read as a hit, short enough to never hide the first frame back. */
const FX_LIFE = Object.freeze({
  respawn: 0.25,
  fell: 0.55,
  checkpoint: 0.45,
  door: 0.5,
  kill: 0.3,
  coin: 0.26,
  hurt: 0.32,
  heal: 0.3,
  key: 0.3,
});

/** A boss leaves a bigger, redder, longer burst than a mook. Same slot, same
 *  one draw call — the difference is numbers, not a second code path. */
const FX_KILL_BOSS_LIFE = 0.55;

/** Extra names an event switch might reasonably reach for. Mapped to the four
 *  canonical kinds so a naming mismatch between the drain (main.js) and this
 *  file degrades to "the right effect" instead of "silence". */
const FX_ALIAS = Object.freeze({
  exitLocked: 'door',
  exitlocked: 'door',
  exit_locked: 'door',
  doorPulse: 'door',
  doorpulse: 'door',
  checkpointPulse: 'checkpoint',
  checkpointpulse: 'checkpoint',
  respawnFlash: 'respawn',
  respawnflash: 'respawn',
  fellPuff: 'fell',
  fellpuff: 'fell',
  killBurst: 'kill',
  killburst: 'kill',
  sparkle: 'coin',
});

/** Fixed per-slot jitter, [dx, dy, scale, rot]. Generated once at module load
 *  from a hard-coded LCG seed (not Math.random), so slot 5 of run A lands in the
 *  same place as slot 5 of run B: effects stay deterministic and testable, and
 *  the hot loop reads four plain numbers instead of rolling dice. */
export const FX_OFFSETS = (() => {
  let s = 0x4e4152; // 'NAR'
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const rows = [];
  for (let i = 0; i < FX_POOL_SIZE; i++) {
    rows.push(Object.freeze([
      next() * 2 - 1,          // dx
      next() * 2 - 1,          // dy
      0.7 + next() * 0.6,      // scale
      next(),                  // rotation phase, 0..1
    ]));
  }
  return Object.freeze(rows);
})();

/** Canonicalise a kind string; returns '' for anything we do not draw. */
export function fxKind(kind) {
  if (typeof kind !== 'string' || kind.length === 0) return '';
  if (FX_LIFE[kind] !== undefined) return kind;
  const alias = FX_ALIAS[kind];
  return alias !== undefined ? alias : '';
}

/** How long one effect of `kind` lives, given its opts. Exported so a test (or
 *  a future HUD) can reason about the pool without building a canvas. */
export function fxLife(kind, opts) {
  const k = fxKind(kind);
  if (k === '') return 0;
  if (k === 'kill' && opts && opts.boss) return FX_KILL_BOSS_LIFE;
  return FX_LIFE[k];
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.cam = { x: 0, y: 0 };
    this.particles = [];
    this.floaters = [];
    this.shake = 0;
    this.t = 0;
    // Fixed FX pool — built once, never grown. Slots are plain pre-shaped
    // objects so queueing an effect at 60Hz allocates nothing at all.
    this.fxSlots = [];
    for (let i = 0; i < FX_POOL_SIZE; i++) {
      this.fxSlots.push({ kind: 'none', x: 0, y: 0, t: 0, life: 0, opts: NO_OPTS, active: false });
    }
    this.fxHead = 0;        // ring cursor: the oldest slot when the pool is full
    this.fxActive = 0;      // live slots, for tests + a future debug HUD
    this.fxExternalSteps = 0; // >0 once a host drives stepFx() itself
  }

  burst(x, y, color, n = 8, speed = 2.2) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random());
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.6, life: 26 + Math.random() * 14, color, g: 0.12 });
    }
  }

  float(x, y, text, color = '#fff') {
    this.floaters.push({ x, y, text, color, life: 48 });
  }

  kick(n = 4) { this.shake = Math.max(this.shake, n); }

  /** Queue one effect. Safe to call before the first draw, between draws, or
   *  from inside a draw's caller; an unknown/absent kind is a no-op and this
   *  function never throws. When all 16 slots are live the oldest one is
   *  recycled, so a burst of events can only ever cost 16 slots — never an
   *  unbounded array, never a garbage spike in the middle of a fight.
   *
   *  `opts` is stored by reference (the drain owns it) but no copy is made and
   *  no default object is created; the only read is `opts.boss` for the kill
   *  burst. */
  fx(kind, x, y, opts = NO_OPTS) {
    const k = fxKind(kind);
    if (k === '') return null;
    const life = fxLife(k, opts);
    let slot = null;
    // Prefer a retired slot; otherwise take the oldest (ring cursor).
    for (let i = 0; i < FX_POOL_SIZE; i++) {
      const cand = this.fxSlots[(this.fxHead + i) % FX_POOL_SIZE];
      if (!cand.active) { slot = cand; break; }
    }
    if (!slot) {
      slot = this.fxSlots[this.fxHead];
      this.fxHead = (this.fxHead + 1) % FX_POOL_SIZE;
    } else {
      this.fxActive++;
    }
    slot.kind = k;
    slot.x = Number.isFinite(x) ? x : 0;
    slot.y = Number.isFinite(y) ? y : 0;
    slot.t = 0;
    slot.life = life;
    slot.opts = opts === undefined || opts === null ? NO_OPTS : opts;
    slot.active = true;
    return slot;
  }

  /** Advance the pool by dt *seconds*. Retired slots are marked inactive (never
   *  spliced out — the array is fixed). Clamped so a long frame stall or a NaN
   *  dt cannot retire the whole pool with a nonsense time.
   *
   *  Calling it is optional: if no host ever steps the pool, draw() ages it by
   *  one 60Hz frame itself so plain `renderer.fx(...)` still animates. Once a
   *  host takes ownership (main.js does, per fixed step) the internal clock
   *  switches off, so effects are never aged twice on the same frame. */
  stepFx(dt) {
    this.fxExternalSteps = 1;
    return this._ageFx(dt);
  }

  /** The aging itself, shared by stepFx() and the fallback clock in draw(). */
  _ageFx(dt) {
    let d = typeof dt === 'number' && Number.isFinite(dt) ? dt : 0;
    if (d < 0) d = 0;
    if (d > 0.25) d = 0.25; // a tab-switch stall is not 8 seconds of effect
    if (this.fxActive <= 0) return 0;
    for (let i = 0; i < FX_POOL_SIZE; i++) {
      const s = this.fxSlots[i];
      if (!s.active) continue;
      s.t += d;
      if (s.t >= s.life) {
        s.active = false;
        s.kind = 'none';
        s.opts = NO_OPTS;
        this.fxActive--;
      }
    }
    return this.fxActive;
  }

  follow(p, world) {
    const targetX = p.x + p.w / 2 - VIEW_W / 2;
    const targetY = p.y + p.h / 2 - VIEW_H / 2 - 10;
    this.cam.x = lerp(this.cam.x, clampCam(targetX, world.width - VIEW_W), 0.12);
    this.cam.y = lerp(this.cam.y, clampCam(targetY, world.height - VIEW_H), 0.12);
  }

  draw(world, player, peers = new Map(), netId = null) {
    const ctx = this.ctx;
    const pal = world.spec.palette;
    this.t++;
    // If nobody drives stepFx() (a bare Renderer in a test or a future client),
    // age the pool one 60Hz frame per draw so queued effects still animate. A
    // host that calls stepFx() takes over and this fallback disarms itself.
    if (this.fxExternalSteps === 0 && this.fxActive > 0) this._ageFx(1 / 60);
    if (this.shake > 0) this.shake *= 0.86;

    const sx = (Math.random() - 0.5) * this.shake;
    const sy = (Math.random() - 0.5) * this.shake;
    ctx.save();
    ctx.translate(-Math.round(this.cam.x) + sx, -Math.round(this.cam.y) + sy);

    this._sky(ctx, pal);
    this._ground(ctx, world);

    for (const e of world.entities) {
      if (e.dead) continue;
      this._entity(ctx, e);
    }

    for (const [id, p] of peers) {
      if (id === netId) continue;
      this._peer(ctx, p);
    }
    this._player(ctx, player);

    this._particles(ctx);
    this._floaters(ctx);
    // World-space FX sit on top of everything in the level but under the frame
    // overlays, so a respawn flash or a kill burst never bisects an enemy.
    this._fxWorld(ctx);
    ctx.restore();
    // Full-frame effects (the respawn flash) are painted in screen space, after
    // the camera translate and still before the vignette.
    this._fxScreen(ctx);
    this._vignette(ctx);
  }

  _sky(ctx, pal) {
    const g = ctx.createLinearGradient(0, this.cam.y, 0, this.cam.y + VIEW_H);
    g.addColorStop(0, pal.sky1);
    g.addColorStop(1, pal.sky2);
    ctx.fillStyle = g;
    ctx.fillRect(this.cam.x, this.cam.y, VIEW_W, VIEW_H);

    // Distant silhouettes parallax.
    let band = 0;
    for (const layer of PARALLAX) {
      const baseY = this.cam.y + VIEW_H * layer.band;
      const off = (this.cam.x * layer.factor) % 96;
      ctx.fillStyle = pal[layer.color];
      for (let i = -1; i < VIEW_W / 96 + 2; i++) {
        const x = this.cam.x - off + i * 96;
        const h = layer.amp + ((i * 37 + band * 13) % 22);
        ctx.beginPath();
        ctx.moveTo(x, baseY);
        ctx.lineTo(x + 48, baseY - h);
        ctx.lineTo(x + 96, baseY);
        ctx.closePath();
        ctx.fill();
      }
      band++;
    }
    // Drifting clouds / motes.
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = pal.accent;
    for (let i = 0; i < 12; i++) {
      const x = this.cam.x + ((i * 137 + this.t * 0.2) % VIEW_W);
      const y = this.cam.y + 20 + ((i * 53) % 120);
      ctx.fillRect(x, y, 3, 3);
    }
    ctx.globalAlpha = 1;
  }

  _ground(ctx, world) {
    const pal = world.spec.palette;
    const c0 = Math.floor(this.cam.x / TILE) - 1;
    const c1 = c0 + VIEW_W / TILE + 2;
    const r0 = Math.floor(this.cam.y / TILE) - 1;
    const r1 = r0 + VIEW_H / TILE + 2;
    for (let ty = r0; ty <= r1; ty++) {
      for (let tx = c0; tx <= c1; tx++) {
        const solid = world.solidAt(tx, ty);
        const one = world.onewayAt(tx, ty);
        const x = tx * TILE, y = ty * TILE;
        if (solid) {
          const above = world.solidAt(tx, ty - 1);
          ctx.fillStyle = pal.ground;
          ctx.fillRect(x, y, TILE, TILE);
          ctx.fillStyle = 'rgba(0,0,0,0.22)';
          ctx.fillRect(x, y + TILE - 3, TILE, 3);
          if (!above) {
            ctx.fillStyle = pal.accent;
            ctx.globalAlpha = 0.55;
            ctx.fillRect(x, y, TILE, 2);
            ctx.globalAlpha = 1;
          }
        } else if (one) {
          ctx.fillStyle = pal.ground;
          ctx.fillRect(x, y, TILE, 4);
          ctx.fillStyle = 'rgba(0,0,0,0.25)';
          ctx.fillRect(x, y + 4, TILE, 1);
          if (ty + 1 < world.solidAt.length) {} // reserved
        }
      }
    }
  }

  _entity(ctx, e) {
    const bob = Math.sin((this.t + e.x) * 0.08) * 1.2;
    switch (e.type) {
      case 'coin':
        ctx.fillStyle = '#ffd447';
        ctx.beginPath(); ctx.arc(e.x + 3, e.y + 3 + bob, 3.2, 0, Math.PI * 2); ctx.fill();
        break;
      case 'health':
        ctx.fillStyle = '#33e1c0';
        ctx.fillRect(e.x, e.y + bob, 8, 3); ctx.fillRect(e.x + 2.5, e.y - 2.5 + bob, 3, 8);
        break;
      case 'key':
        ctx.fillStyle = '#ffd447';
        ctx.fillRect(e.x, e.y + bob, 6, 3); ctx.fillRect(e.x + 5, e.y + bob, 3, 6);
        break;
      case 'exit': {
        ctx.fillStyle = '#33e1c0';
        ctx.globalAlpha = 0.35 + Math.sin(this.t * 0.1) * 0.15;
        ctx.fillRect(e.x, e.y, 16, 32);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#e8eefc';
        ctx.fillRect(e.x + 7, e.y, 2, 32);
        break;
      }
      case 'checkpoint':
        ctx.fillStyle = e.active ? '#33e1c0' : '#5a6a85';
        ctx.fillRect(e.x, e.y, 2, 24);
        ctx.fillRect(e.x, e.y, 10, 6);
        break;
      case 'spike':
        ctx.fillStyle = '#c9d4e8';
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          ctx.moveTo(e.x + i * 4, e.y + 5);
          ctx.lineTo(e.x + i * 4 + 2, e.y);
          ctx.lineTo(e.x + i * 4 + 4, e.y + 5);
          ctx.closePath(); ctx.fill();
        }
        break;
      default:
        if (e.kind === 'enemy') this._enemy(ctx, e);
    }
  }

  _enemy(ctx, e) {
    const t = {
      enemy1: '#ff6b6b', enemy2: '#ff9f43', enemy3: '#d94bff', boss: '#ff3b5c',
    }[e.type] ?? '#ff6b6b';
    const flash = e.hurtT > 0 && this.t % 4 < 2;
    ctx.fillStyle = flash ? '#fff' : t;
    if (e.boss) {
      const wob = Math.sin(this.t * 0.12) * 2;
      ctx.fillRect(e.x + wob, e.y, e.w, e.h);
      ctx.fillStyle = '#0a0d14';
      ctx.fillRect(e.x + 8 + wob, e.y + 9, 5, 5);
      ctx.fillRect(e.x + e.w - 13 + wob, e.y + 9, 5, 5);
      ctx.fillStyle = '#ffd447';
      ctx.fillRect(e.x + 6 + wob, e.y - 4, 6, 4);
      ctx.fillRect(e.x + e.w - 12 + wob, e.y - 4, 6, 4);
      // health bar
      const pct = e.hp / e.maxHp;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(e.x - 20, e.y - 12, e.w + 40, 5);
      ctx.fillStyle = '#ff3b5c';
      ctx.fillRect(e.x - 19, e.y - 11, (e.w + 38) * pct, 3);
    } else {
      ctx.beginPath();
      ctx.ellipse(e.x + e.w / 2, e.y + e.h / 2, e.w / 2, e.h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0a0d14';
      const eye = e.vx > 0 ? e.x + e.w - 5 : e.x + 2;
      ctx.fillRect(eye, e.y + 3, 3, 3);
      if (e.type === 'enemy3') {
        ctx.fillStyle = '#fff';
        ctx.fillRect(e.x + 2, e.y - 3, 2, 4); ctx.fillRect(e.x + e.w - 4, e.y - 3, 2, 4);
      }
    }
  }

  _player(ctx, p) {
    if (!p) return;
    const flash = p.invuln > 0 && this.t % 4 < 2;
    ctx.globalAlpha = flash ? 0.45 : 1;
    const x = Math.round(p.x), y = Math.round(p.y);
    // body
    ctx.fillStyle = '#dff5ff';
    ctx.fillRect(x, y, p.w, p.h);
    // scarf / accent depends on facing
    ctx.fillStyle = '#33e1c0';
    if (p.facing >= 0) ctx.fillRect(x - 2, y + 3, 3, 6);
    else ctx.fillRect(x + p.w - 1, y + 3, 3, 6);
    // eye
    ctx.fillStyle = '#0a0d14';
    ctx.fillRect(p.facing >= 0 ? x + p.w - 4 : x + 1, y + 3, 2, 3);
    // dash trail
    if (p.dashT > 0) {
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = '#33e1c0';
      ctx.fillRect(x - p.facing * 10, y + 2, p.w, p.h - 4);
      ctx.globalAlpha = 1;
    }
    // attack arc
    if (p.attackT > 0) {
      ctx.strokeStyle = '#fff';
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 2;
      ctx.beginPath();
      const cx = x + (p.facing >= 0 ? p.w + 6 : -6);
      ctx.arc(cx, y + p.h / 2, 9, 0, Math.PI * 1.4);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.globalAlpha = 1;
    if (p.name) {
      ctx.fillStyle = '#e8eefc';
      ctx.font = '6px ui-sans-serif, system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(p.name, x + p.w / 2, y - 4);
      ctx.textAlign = 'left';
    }
  }

  _peer(ctx, p) {
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = p.dead ? '#6b7280' : '#ffd0e8';
    ctx.fillRect(p.x, p.y, 10, 14);
    ctx.fillStyle = '#0a0d14';
    ctx.fillRect(p.x + (p.facing >= 0 ? 6 : 2), p.y + 3, 2, 3);
    ctx.fillStyle = '#e8eefc';
    ctx.font = '6px ui-sans-serif, system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(p.name ?? '', p.x + 5, p.y - 4);
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
  }

  _particles(ctx) {
    for (const pt of this.particles) {
      pt.x += pt.vx; pt.y += pt.vy; pt.vy += pt.g; pt.life--;
      ctx.globalAlpha = Math.max(0, pt.life / 34);
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x, pt.y, 2, 2);
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    ctx.globalAlpha = 1;
  }

  _floaters(ctx) {
    ctx.font = 'bold 8px ui-sans-serif, system-ui';
    for (const f of this.floaters) {
      f.y -= 0.35; f.life--;
      ctx.globalAlpha = Math.max(0, f.life / 48);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    this.floaters = this.floaters.filter((f) => f.life > 0);
    ctx.globalAlpha = 1;
  }

  /** World-space half of the FX pass: at most one canvas primitive per live
   *  slot, no allocations, no Math.random. Slots are walked in place; the fixed
   *  offset table supplies the per-slot jitter that used to be a random roll. */
  _fxWorld(ctx) {
    let draws = 0;
    for (let i = 0; i < FX_POOL_SIZE; i++) {
      const s = this.fxSlots[i];
      if (!s.active) continue;
      const off = FX_OFFSETS[i];
      const p = s.life > 0 ? s.t / s.life : 1;
      if (p >= 1) continue;
      const fade = 1 - p;
      const dx = off[0], dy = off[1], scale = off[2], rot = off[3];
      switch (s.kind) {
        case 'fell': {
          // A grey puff that rises and disperses — deliberately nothing like the
          // orange/red kill burst, so a pit death reads as "it fell" at a glance.
          ctx.globalAlpha = fade * 0.75;
          ctx.fillStyle = '#8b95a8';
          const r = 2.5 + p * (7 + scale * 4);
          ctx.beginPath();
          ctx.arc(s.x + dx * p * 7, s.y - p * (14 + dy * 4), r, 0, TAU);
          ctx.fill();
          draws++;
          break;
        }
        case 'checkpoint': {
          // Expanding ring on the pole that just saved you.
          ctx.globalAlpha = fade * 0.9;
          ctx.strokeStyle = '#33e1c0';
          ctx.lineWidth = 2;
          const r = 4 + p * 16;
          ctx.beginPath();
          ctx.arc(s.x + 5, s.y + 10, r, 0, TAU);
          ctx.stroke();
          draws++;
          break;
        }
        case 'door': {
          // The locked gate's answer: an amber ring pushed out of the exit.
          ctx.globalAlpha = fade * 0.85;
          ctx.strokeStyle = '#ffb03a';
          ctx.lineWidth = 2;
          const r = 5 + p * 16;
          ctx.strokeRect(s.x + 8 - r, s.y + 16 - r * 1.5, r * 2, r * 3);
          draws++;
          break;
        }
        case 'kill': {
          // One path, one fill: an 8-point star that opens and fades. The boss
          // variant is bigger and red instead of orange (opts.boss).
          const boss = s.opts.boss === true;
          ctx.globalAlpha = fade;
          ctx.fillStyle = boss ? '#ff3b5c' : '#ff9f43';
          const R = (boss ? 14 : 6) * (0.5 + p * 1.1) * scale;
          const r2 = R * 0.42;
          const a0 = rot * TAU;
          ctx.beginPath();
          for (let k = 0; k < 8; k++) {
            const a = a0 + (k / 8) * TAU;
            const rad = (k & 1) === 0 ? R : r2;
            const px = s.x + Math.cos(a) * rad;
            const py = s.y + Math.sin(a) * rad;
            if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fill();
          draws++;
          break;
        }
        case 'coin':
        case 'hurt':
        case 'heal':
        case 'key': {
          // Small one-shot sparkles, all off the same slot type. A single 2px
          // mote thrown along the slot's fixed offset and fading out.
          ctx.globalAlpha = fade;
          ctx.fillStyle = s.kind === 'hurt' ? '#ff6b6b'
            : s.kind === 'heal' ? '#33e1c0'
              : '#ffd447';
          const d = 3 + p * (6 + scale * 5);
          ctx.fillRect(s.x + dx * d, s.y + dy * d - p * 3, 2, 2);
          draws++;
          break;
        }
        default:
          break; // 'respawn' is screen-space; anything else draws nothing
      }
    }
    ctx.globalAlpha = 1;
    this.fxDraws = draws;
    return draws;
  }

  /** Screen-space half of the FX pass. The respawn flash is a full-frame white
   *  wash fading over its ~0.25s life — the loudest thing a run can show, and
   *  the one frame overlay that must not be inside the camera translate. */
  _fxScreen(ctx) {
    let draws = this.fxDraws;
    for (let i = 0; i < FX_POOL_SIZE; i++) {
      const s = this.fxSlots[i];
      if (!s.active || s.kind !== 'respawn') continue;
      const p = s.life > 0 ? s.t / s.life : 1;
      if (p >= 1) continue;
      const fade = 1 - p;
      ctx.globalAlpha = fade * fade * 0.9;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      draws++;
    }
    ctx.globalAlpha = 1;
    this.fxDraws = draws;
    return draws;
  }

  _vignette(ctx) {
    const g = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.35, VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.85);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
}

function clampCam(v, max) { return Math.max(0, Math.min(v, Math.max(0, max))); }
