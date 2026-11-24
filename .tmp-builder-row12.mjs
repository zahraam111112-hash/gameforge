import { LEVELS } from './game/src/level.js';
import { simulate } from './harness/sim.mjs';

const base = LEVELS.s1.rows[12];
console.log('base:', base);

const spikes = ['21', '22', '23'];
const keepSets = [['21'], ['22'], ['23'], ['21', '22'], ['22', '23'], ['21', '23'], []];
const cpPositions = [19, 20];

for (const keep of keepSets) {
  for (const cp of cpPositions) {
    const arr = [...base];
    for (const c of spikes) if (!keep.includes(c)) arr[Number(c)] = '.';
    // old checkpoints: 27 and 51 -> keep 51 (past the wall), move 27 -> cp
    arr[27] = '.';
    arr[cp] = 'C';
    LEVELS.s1.rows[12] = arr.join('');
    const r = simulate({ level: 's1', steps: 5400, seed: 7 });
    console.log(JSON.stringify({
      keep: keep.join('') || 'none', cp, row: LEVELS.s1.rows[12],
      progress: r.progress, deaths: r.deaths, deathSpots: r.deathSpots,
      minHp: r.minHp, stuck: r.stuckRatio, won: r.won, bugs: r.bugs,
    }));
  }
}
