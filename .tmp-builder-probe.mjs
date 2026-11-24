import { LEVELS } from './game/src/level.js';

for (const id of ['s1', 's2', 's3']) {
  const { rows, width } = LEVELS[id];
  const r12 = rows[12];
  const r13 = rows[13];
  console.log('==', id, 'width', width, 'mid', Math.floor(width / 2));
  let line = '';
  for (let x = 0; x < width; x++) {
    if (r13[x] !== '#') { line += '~'; continue; }   // pit gap
    line += r12[x] === '.' ? '_' : r12[x];           // walkable floor vs occupied
  }
  console.log(line);
  console.log([...Array(width).keys()].map((i) => (i % 10 === 0 ? String(Math.floor(i / 10)) : String(i % 10))).join(''));
}
