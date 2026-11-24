import { LEVELS } from './game/src/level.js';

for (const [id, spec] of Object.entries(LEVELS)) {
  console.log(`\n=== ${id} w=${spec.width} h=${spec.height} rows=${spec.rows.length}`);
  spec.rows.forEach((r, i) => {
    if (!/[^.]/.test(r)) return;
    console.log(String(i).padStart(2), JSON.stringify(r));
  });
  // pits per floor row
  const W = spec.width;
  const floorRows = [];
  for (let y = 0; y < spec.height; y++) if ((spec.rows[y] ?? '').startsWith('####')) floorRows.push(y);
  console.log('floorRows', floorRows);
  for (const y of floorRows) {
    const row = spec.rows[y];
    let runs = [];
    let s = -1;
    for (let x = 0; x < W; x++) {
      const empty = row[x] !== '#';
      if (empty && s < 0) s = x;
      if (!empty && s >= 0) { runs.push([s, x - 1]); s = -1; }
    }
    if (s >= 0) runs.push([s, W - 1]);
    console.log(' row', y, 'gaps', JSON.stringify(runs));
  }
  // spikes
  const spikes = [];
  spec.rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] === '^') spikes.push([x, y]); });
  console.log('spikes', JSON.stringify(spikes));
  const cs = [];
  spec.rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] === 'C') cs.push([x, y]); });
  console.log('checkpoints', JSON.stringify(cs));
}
