import { LEVELS } from './game/src/level.js';
const spec = LEVELS[process.argv[2] ?? 's3'];
const a = Number(process.argv[3] ?? 0), b = Number(process.argv[4] ?? spec.width);
const hdr = Array.from({length: b-a}, (_, i) => ((a+i)%10===0 ? String(Math.floor((a+i)/10)%10) : ' ')).join('');
const idx = Array.from({length: b-a}, (_, i) => String((a+i)%10)).join('');
for (let y = 6; y < spec.height; y++) console.log(String(y).padStart(2), spec.rows[y].slice(a,b));
console.log('   ', hdr); console.log('   ', idx);
