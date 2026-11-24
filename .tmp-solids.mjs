import { LEVELS, parseLevel } from './game/src/level.js';
const spec = LEVELS[process.argv[2] ?? 's3'];
const p = parseLevel(spec);
const a = Number(process.argv[3] ?? 0), b = Number(process.argv[4] ?? spec.width);
for (let y = 9; y < spec.height; y++) {
  let s = '';
  for (let x = a; x < b; x++) s += p.solids[y][x] ? '#' : (p.oneway[y][x] ? '=' : '.');
  console.log(String(y).padStart(2), s);
}
console.log('   ', Array.from({length: b-a}, (_, i) => String((a+i)%10)).join(''));
