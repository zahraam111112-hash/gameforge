// Authoritative rooms. Each room owns its World and applies the sim at a fixed
// tick; clients only send input intents. This is what lets the harness load-test
// "hundreds of players" without a browser: bots are ordinary room clients too.
import { World, makePlayer } from '../game/src/world.js';

export const TICK_HZ = 30;
export const MAX_PLAYERS = 64;

const SPAWN_OFFSETS = Array.from({ length: 16 }, (_, i) => ({ x: 40 + (i % 8) * 48, y: 96 + Math.floor(i / 8) * 40 }));

export class Room {
  constructor(kind, level = 'arena') {
    this.kind = kind; // coop | royale
    this.level = level;
    this.world = new World(level, 424242);
    this.players = new Map();
    this.frame = 0;
    this.startedAt = Date.now();
  }

  add(id, name) {
    if (this.players.size >= MAX_PLAYERS) return false;
    const sp = SPAWN_OFFSETS[this.players.size % SPAWN_OFFSETS.length];
    const p = makePlayer(sp.x, sp.y);
    p.id = id;
    p.name = name || `p${this.players.size + 1}`;
    p.input = { left: false, right: false, jump: false, attack: false, dash: false, down: false };
    p.lastSeen = Date.now();
    this.players.set(id, p);
    return true;
  }

  remove(id) { this.players.delete(id); }

  setInput(id, input) {
    const p = this.players.get(id);
    if (!p) return;
    p.input = input;
    p.lastSeen = Date.now();
  }

  step() {
    this.frame++;
    for (const p of this.players.values()) {
      if (p.dead) {
        p.respawnT = (p.respawnT ?? 0) - 1;
        if (p.respawnT <= 0) this._respawn(p);
        continue;
      }
      this.world.tickPlayerOnly?.(p, p.input, this.world);
    }
  }

  _respawn(p) {
    p.dead = false;
    p.hp = p.maxHp;
    p.x = 40 + Math.random() * 600;
    p.y = 96;
    p.vx = 0;
    p.vy = 0;
  }

  snapshot() {
    return {
      t: 'state',
      frame: this.frame,
      room: this.kind,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        x: Math.round(p.x),
        y: Math.round(p.y),
        facing: p.facing,
        hp: p.hp,
        score: p.score ?? 0,
        dead: !!p.dead,
      })),
    };
  }
}

export class RoomManager {
  constructor() {
    this.rooms = new Map();
    this._timer = setInterval(() => this._tick(), 1000 / TICK_HZ);
    this._timer.unref?.();
  }

  get(kind, level) {
    const key = `${kind}:${level}`;
    if (!this.rooms.has(key)) this.rooms.set(key, new Room(kind, level));
    return this.rooms.get(key);
  }

  _tick() {
    for (const room of this.rooms.values()) room.step();
  }

  stats() {
    return {
      rooms: [...this.rooms.entries()].map(([k, r]) => ({ key: k, players: r.players.size, frame: r.frame })),
      totalPlayers: [...this.rooms.values()].reduce((n, r) => n + r.players.size, 0),
    };
  }
}
