import { LEVELS } from './game/src/level.js';

function ruler(n) {
  let tens = '';
  let ones = '';
  for (let i = 0; i < n; i++) {
    tens += Math.floor(i / 10) % 10;
    ones += i % 10;
  }
  return tens + '\n' + ones;
}

for (const id of ['s1', 's2', 's3']) {
  const spec = LEVELS[id];
  console.log(`\n=== ${id} w=${spec.width}`);
  console.log(ruler(spec.width));
  for (const y of [8, 9, 10, 11, 12, 13]) {
    console.log(String(y).padStart(2), spec.rows[y]);
  }
}
