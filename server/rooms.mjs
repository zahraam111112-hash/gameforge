// Authoritative rooms. Each room owns its World and applies the sim at a fixed
// tick; clients only send input intents. This is what lets the harness load-test
// "hundreds of players" without a browser: bots are ordinary room clients too.
import { World, makePlayer } from '../game/src/world.js';

export const TICK_HZ = 30;
// Measured ceiling for one room is far below "hundreds": every tick a room of N
// sends a delta to N clients, so a packed room costs O(N²) messages. 200 players
// in one room timed out every client. Players are sharded across rooms instead
// (see RoomManager.join), so this is the size of one shard, not the site.
export const MAX_PLAYERS = 100;
const MAX_SHARDS = 20;

const SPAWN_OFFSETS = Array.from({ length: 16 }, (_, i) => ({ x: 40 + (i % 8) * 48, y: 96 + Math.floor(i / 8) * 40 }));

export class Room {
  constructor(kind, level = 'arena') {
    this.kind = kind; // coop | royale
    this.level = level;
    this.world = new World(level, 424242);
    this.players = new Map();
    this.frame = 0;
    this.startedAt = Date.now();
    this.winner = null;
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
    if (this.kind === 'royale') this.winner = null; // a join re-opens the round
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
        // Royale is single-elimination: a fallen player stays down until the
        // round ends. Co-op respawns so a session keeps going.
        if (this.kind !== 'royale') {
          p.respawnT = (p.respawnT ?? 0) - 1;
          if (p.respawnT <= 0) this._respawn(p);
        }
        continue;
      }
      // Physics for this player only. Enemy AI is world state, so it runs once
      // per tick below — running it per player cost O(players × enemies) and
      // was what capped the room at ~80 players on one core.
      this.world.stepPlayer(p, p.input);
      if (p.hp <= 0 && !p.dead) { p.dead = true; p.respawnT = 90; }
    }
    this.world.updateEnemies();
    if (this.kind === 'royale') this._royaleCombat();
  }

  /** PvP: a strike that lands on another player costs hp; last one standing wins. */
  _royaleCombat() {
    const alive = [...this.players.values()].filter((p) => !p.dead);
    for (const p of alive) {
      p.pvpCd = Math.max(0, (p.pvpCd ?? 0) - 1);
      p.invuln = Math.max(0, (p.invuln ?? 0) - 1);
      if (!p.input?.attack || (p.pvpCd ?? 0) > 0) continue;
      p.pvpCd = 16;
      const reach = 18;
      const dir = p.facing ?? 1;
      const hitbox = {
        x: dir > 0 ? p.x + p.w - 2 : p.x - reach,
        y: p.y + 2, w: reach, h: p.h - 4,
      };
      for (const o of alive) {
        if (o === p) continue;
        if (o.invuln > 0) continue;
        if (hitbox.x < o.x + o.w && hitbox.x + hitbox.w > o.x &&
            hitbox.y < o.y + o.h && hitbox.y + hitbox.h > o.y) {
          o.hp -= 12;
          o.invuln = 20;
          o.vx = dir * 3.4;
          o.vy = -3.4;
          if (o.hp <= 0) { o.hp = 0; o.dead = true; p.score = (p.score ?? 0) + 100; }
        }
      }
    }
    const left = [...this.players.values()].filter((p) => !p.dead);
    if (!this.winner && this.players.size >= 2 && left.length === 1) {
      this.winner = { id: left[0].id, name: left[0].name, at: Date.now() };
      left[0].score = (left[0].score ?? 0) + 1000;
    }
  }

  _respawn(p) {
    p.dead = false;
    p.hp = p.maxHp;
    // Deterministic per-player spawn so a replay of the same room state lands
    // every player in the same place. Math.random here made resurrections
    // un-reproducible and could drop a player inside terrain.
    const idx = this.players.has(p.id) ? [...this.players.keys()].indexOf(p.id) : 0;
    const sp = SPAWN_OFFSETS[idx % SPAWN_OFFSETS.length];
    p.x = sp.x;
    p.y = sp.y;
    p.vx = 0;
    p.vy = 0;
  }

  snapshot() {
    return {
      t: 'state',
      frame: this.frame,
      room: this.kind,
      winner: this.winner,
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

  /** This tick's player records plus their change keys, computed once.
   *  Every client in the room shares this; building it per client made the
   *  broadcast O(N²) in map work and starved the room under load. */
  prepare() {
    const records = [];
    const keys = new Map();
    for (const p of this.players.values()) {
      const rec = {
        id: p.id, name: p.name, x: Math.round(p.x), y: Math.round(p.y),
        facing: p.facing, hp: p.hp, score: p.score ?? 0, dead: !!p.dead,
      };
      keys.set(rec.id, `${rec.x},${rec.y},${rec.facing},${rec.hp},${rec.score},${rec.dead ? 1 : 0},${rec.name}`);
      records.push(rec);
    }
    return { records, keys, at: this.frame, winner: this.winner };
  }

  /** What this client has not seen yet, given the view it holds. */
  render(views, seen) {
    const players = [];
    for (const rec of views.records) {
      if (seen?.get(rec.id) !== views.keys.get(rec.id)) players.push(rec);
    }
    const gone = [...(seen?.keys() ?? [])].filter((id) => !views.keys.has(id));
    return { t: 'state', room: this.kind, frame: views.at, winner: views.winner, players, gone, keys: views.keys };
  }

  /** Everything that changed since the last snapshot this client received.
   *  A room of N players used to send N copies of N players every tick; a delta
   *  is proportional to who actually moved, and an empty room costs nothing. */
  delta(seen) {
    return this.render(this.prepare(), seen);
  }
}

export class RoomManager {
  constructor() {
    this.rooms = new Map();
    // Timers, not a spin loop: a room with nothing in it must cost nothing.
    // A delayed timer is caught up rather than made up for: the simulation is
    // frame-stepped, so replaying 40 ticks at once after a stall would jump
    // every player and charge them for time they never saw. The debt is capped
    // so a long stall cannot spend the next minute running instantly.
    this._last = Date.now();
    this._timer = setInterval(() => this._tick(), 1000 / TICK_HZ);
    this._timer.unref?.();
  }

  get(kind, level) {
    const key = `${kind}:${level}`;
    if (!this.rooms.has(key)) this.rooms.set(key, new Room(kind, level));
    return this.rooms.get(key);
  }

  /** Places a player in the first shard of this level that has room.
   *  A packed room is quadratic to broadcast, so a full room routes the next
   *  player to `level#2` rather than refusing them or overloading the room. */
  join(kind, level, id, name) {
    for (let shard = 0; shard <= MAX_SHARDS; shard++) {
      const key = shard === 0 ? level : `${level}#${shard + 1}`;
      const room = this.get(kind, key);
      if (room.players.size < MAX_PLAYERS && room.add(id, name)) return room;
    }
    return null;
  }

  _tick() {
    const now = Date.now();
    const behind = Math.min(8, Math.max(0, Math.round((now - this._last) / (1000 / TICK_HZ)) - 1));
    this._last = now;
    for (let i = 0; i <= behind; i++) {
      for (const room of this.rooms.values()) room.step();
    }
  }

  stats() {
    return {
      rooms: [...this.rooms.entries()].map(([k, r]) => ({ key: k, players: r.players.size, frame: r.frame })),
      totalPlayers: [...this.rooms.values()].reduce((n, r) => n + r.players.size, 0),
    };
  }
}
