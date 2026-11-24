import { LEVELS } from './game/src/level.js';
for (const [id, spec] of Object.entries(LEVELS)) {
  console.log('==', id, 'w', spec.width, 'h', spec.height, 'rows', spec.rows.length);
  spec.rows.forEach((r, i) => {
    const counts = {};
    for (const c of r) counts[c] = (counts[c] ?? 0) + 1;
    console.log(String(i).padStart(2), 'len=' + r.length, JSON.stringify(counts), JSON.stringify(r));
  });
}
