import test from 'node:test';
import assert from 'node:assert/strict';
import { Room, RoomManager, TICK_HZ } from '../server/rooms.mjs';

test('coop respawns a fallen player', () => {
  const room = new Room('coop', 'arena');
  room.add('x', 'xavier');
  const p = room.players.get('x');
  p.dead = true;
  p.respawnT = 2;
  for (let i = 0; i < 5; i++) room.step();
  assert.equal(p.dead, false, 'coop should bring the player back');
  assert.ok(p.hp > 0);
});

test('royale is single-elimination and crowns a winner', () => {
  const room = new Room('royale', 'arena');
  room.add('a', 'alice');
  room.add('b', 'bob');
  const a = room.players.get('a');
  const b = room.players.get('b');
  for (let i = 0; i < 600 && !b.dead; i++) {
    b.x = a.x + 12; b.y = a.y; b.vy = 0;
    a.facing = 1;
    a.input = { right: false, attack: true };
    room.step();
  }
  assert.equal(b.dead, true, 'bob should be eliminated');
  assert.equal(b.hp, 0);
  for (let i = 0; i < 120; i++) room.step();
  assert.equal(b.dead, true, 'royale must not respawn');
  assert.equal(room.winner?.id, 'a', 'the last player standing wins');
});

test('a join reopens a finished royale round', () => {
  const room = new Room('royale', 'arena');
  room.add('a', 'alice');
  room.add('b', 'bob');
  room.winner = { id: 'a', name: 'alice' };
  room.add('c', 'carol');
  assert.equal(room.winner, null);
});

test('snapshots stay bounded and carry the winner', () => {
  const room = new Room('royale', 'arena');
  for (let i = 0; i < 80; i++) room.add(`p${i}`);
  const snap = room.snapshot();
  assert.equal(snap.players.length, 80);
  assert.ok('winner' in snap);
  assert.ok(JSON.stringify(snap).length < 20_000, 'snapshot must stay small enough for 30Hz fan-out');
});

test('room manager reports totals across rooms', () => {
  const rm = new RoomManager();
  rm.get('coop', 'arena').add('a');
  rm.get('royale', 'arena').add('b');
  const s = rm.stats();
  assert.equal(s.totalPlayers, 2);
  assert.equal(s.rooms.length, 2);
  assert.ok(TICK_HZ > 0);
  rm._timer && clearInterval(rm._timer);
});
