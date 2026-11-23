import { TILE, VIEW_W, VIEW_H, lerp } from './util.js';

const PARALLAX = [
  { factor: 0.15, band: 0.55, color: 'far', amp: 26 },
  { factor: 0.35, band: 0.72, color: 'near', amp: 14 },
];

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
    ctx.restore();
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

  _vignette(ctx) {
    const g = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.35, VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.85);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
}

function clampCam(v, max) { return Math.max(0, Math.min(v, Math.max(0, max))); }
