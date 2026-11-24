import { LEVELS, parseLevel } from './game/src/level.js';
const id = process.argv[2] ?? 's3';
const spec = LEVELS[id];
for (let y = 5; y < spec.height; y++) console.log(String(y).padStart(2), spec.rows[y]);
console.log('   ' + Array.from({length: spec.width}, (_, i) => (i % 10 === 0 ? String(Math.floor(i/10)) : ' ')).join(''));
console.log('   ' + Array.from({length: spec.width}, (_, i) => String(i % 10)).join(''));
const p = parseLevel(spec);
console.log('spawns', p.spawns.map(s => `${s.type}@${Math.floor(s.x/16)},${Math.floor(s.y/16)}`).join(' '));
