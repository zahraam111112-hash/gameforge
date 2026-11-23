import test from 'node:test';
import assert from 'node:assert/strict';
import { World, makePlayer } from '../game/src/world.js';
import { LEVELS, parseLevel, STORY_ORDER } from '../game/src/level.js';
import { simulate } from '../harness/sim.mjs';

test('every level parses with a spawn and correct dimensions', () => {
  for (const [id, spec] of Object.entries(LEVELS)) {
    const parsed = parseLevel(spec);
    assert.equal(spec.rows.length, spec.height, `${id} height`);
    for (const row of spec.rows) assert.equal(row.length, spec.width, `${id} width`);
    assert.ok(parsed.player, `${id} spawn`);
    assert.ok(parsed.spawns.length > 0, `${id} spawns`);
  }
});

test('gravity pulls the player down onto solid ground', () => {
  const world = new World('s1', 1);
  const p = makePlayer(world.spawnPoint.x, world.spawnPoint.y - 40);
  for (let i = 0; i < 200; i++) world.tick(p, {});
  assert.ok(p.onGround, 'player should land');
  assert.ok(Number.isFinite(p.y));
});

test('moving right increases x', () => {
  const world = new World('arena', 1);
  const p = makePlayer(100, 100);
  for (let i = 0; i < 30; i++) world.tick(p, { right: true });
  assert.ok(p.x > 100);
});

test('jumping leaves the ground', () => {
  const world = new World('arena', 1);
  const p = makePlayer(100, 100);
  world.tick(p, {});
  world.tick(p, { jump: true });
  assert.ok(p.vy < 0 || !p.onGround);
});

test('coins are collected and score rises', () => {
  const world = new World('arena', 1);
  const p = makePlayer(world.spawnPoint.x, world.spawnPoint.y);
  const coin = world.entities.find((e) => e.type === 'coin');
  assert.ok(coin, 'arena should have coins');
  p.x = coin.x - 2; p.y = coin.y - 2;
  world.tick(p, {});
  assert.ok(p.coins > 0);
});

test('bot simulation makes progress and never goes NaN', () => {
  for (const id of STORY_ORDER) {
    const r = simulate({ level: id, steps: 2400, seed: 11 });
    assert.equal(r.bugs.length, 0, `${id}: ${r.bugs.join(',')}`);
    assert.ok(r.progress > 0, `${id}: no progress`);
  }
});

test('determinism: same seed yields the same result', () => {
  const a = simulate({ level: 's1', steps: 900, seed: 5 });
  const b = simulate({ level: 's1', steps: 900, seed: 5 });
  assert.equal(a.progress, b.progress);
  assert.equal(a.score, b.score);
});
