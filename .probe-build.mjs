import { World, makePlayer, PIT_DAMAGE, STRIKE_DAMAGE, BOSS_DAMAGE_MULT, ATTACK_CD } from './game/src/world.js';
import { LEVELS, STORY_ORDER } from './game/src/level.js';

const w = new World('arena', 3);
try { console.log('exitUnlocked before waves:', w.exitUnlocked()); } catch (e) { console.log('exitUnlocked THREW:', e.message); }
console.log('wavesTotal', w.wavesTotal, 'wave', w.wave, 'wavesDone', w.wavesDone, 'entities', w.entities.length);

const w2 = new World('s1', 1);
const p = makePlayer(w2.spawnPoint.x, w2.spawnPoint.y);
const hp0 = p.hp;
w2.tick(p, {});
p.y = w2.height + 100;
w2.tick(p, {});
console.log('after fall hp', p.hp, 'delta', hp0 - p.hp, 'status', w2.status, 'pos', Math.round(p.x), Math.round(p.y), 'events', w2.drainEvents().map((e) => e.type).join(','));

for (const id of STORY_ORDER) {
  const rows = LEVELS[id].rows.join('');
  console.log(id, 'has C:', rows.includes('C'), 'count', (rows.match(/C/g) ?? []).length);
}

// boss strike test
const w3 = new World('s3', 1);
const boss = w3.entities.find((e) => e.boss);
console.log('boss', boss.type, boss.hp, boss.maxHp);
const p3 = makePlayer(boss.x - 12, boss.y);
let strikes = 0;
for (let i = 0; i < 200 && strikes < 8; i++) {
  p3.attackCd = 0;
  const before = boss.hp;
  w3.stepPlayer(p3, { attack: true, right: boss.x > p3.x });
  if (boss.hp < before) strikes++;
  p3.invuln = 99;
  boss.hurtT = 0;
}
console.log('after strikes boss hp', boss.hp, 'maxHp', boss.maxHp, 'strikes landed', strikes, 'STRIKE', STRIKE_DAMAGE, 'MULT', BOSS_DAMAGE_MULT, 'ATTACK_CD', ATTACK_CD);
