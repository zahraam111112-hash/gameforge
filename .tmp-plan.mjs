import { LEVELS } from './game/src/level.js';
const plan = { s1: [27, 51], s2: [30, 57], s3: [34, 63] };
for (const [id, cols] of Object.entries(plan)) {
  const spec = LEVELS[id];
  const walk = spec.rows[12].split('');
  for (const c of cols) {
    console.log(id, 'col', c, 'char', walk[c], 'below', spec.rows[13][c], 'pct', (c / spec.width * 100).toFixed(1));
    if (walk[c] !== '.') throw new Error('not empty');
    if (spec.rows[13][c] !== '#') throw new Error('not solid');
  }
  for (const c of cols) walk[c] = 'C';
  console.log(id, JSON.stringify(walk.join('')), walk.length);
}
