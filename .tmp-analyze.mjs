// Dev-only: enumerate pits, spikes, enemies and walls on the critical path.
import { LEVELS, parseLevel } from './game/src/level.js';

for (const id of ['s1', 's2', 's3']) {
  const spec = LEVELS[id];
  const p = parseLevel(spec);
  const row = spec.rows[12];
  const solidRow = (y) => spec.rows[y].split('').map((c) => c === '#' || c === 'D');
  const ground = solidRow(13);
  console.log(`\n=== ${id} width=${spec.width}`);
  const runs = (arr, val) => {
    const out = [];
    let start = -1;
    for (let x = 0; x <= arr.length; x++) {
      const v = x < arr.length ? arr[x] === val : false;
      if (v && start < 0) start = x;
      if (!v && start >= 0) { out.push([start, x - 1]); start = -1; }
    }
    return out;
  };
  console.log('  pits(row13 gaps):', JSON.stringify(runs(ground, false)));
  console.log('  spikes:', JSON.stringify(p.spawns.filter((s) => s.type === 'spike').map((s) => [Math.floor(s.x / 16), Math.floor(s.y / 16)])));
  console.log('  enemies:', JSON.stringify(p.spawns.filter((s) => /enemy|boss/.test(s.type)).map((s) => [s.type, Math.floor(s.x / 16), Math.floor(s.y / 16)])));
  console.log('  exits:', JSON.stringify(p.spawns.filter((s) => s.type === 'exit').map((s) => [Math.floor(s.x / 16), Math.floor(s.y / 16)])));
  // anything in row 11/12 that is solid (blocks running)
  for (const y of [10, 11, 12]) {
    const cols = row ?? '';
    const arr = (spec.rows[y] ?? '').split('').map((c) => c === '#');
    console.log(`  solid wall row${y}:`, JSON.stringify(runs(arr, true)));
  }
  // floaters: spike cells with no ground below within 3 rows
  for (const s of p.spawns.filter((q) => q.type === 'spike')) {
    const tx = Math.floor(s.x / 16), ty = Math.floor(s.y / 16);
    let support = -1;
    for (let y = ty; y < spec.height; y++) if (p.solids[y][tx]) { support = y; break; }
    if (support !== ty + 1) console.log(`  FLOATING SPIKE at col ${tx} row ${ty} (support row ${support})`);
  }
}
