// Gate: everything the site will serve must exist and be consistent.
// Exits non-zero with a reason when a build is not shippable.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { simulate } from './sim.mjs';
import { LEVELS } from '../game/src/level.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];

const required = [
  'game/src/main.js', 'game/src/world.js', 'game/src/render.js', 'game/src/audio.js',
  'server/index.mjs', 'site/public/index.html',
];
for (const f of required) if (!fs.existsSync(path.join(ROOT, f))) problems.push(`missing ${f}`);

// Every level parses, has a spawn and an exit.
for (const id of Object.keys(LEVELS)) {
  const spec = LEVELS[id];
  const joined = spec.rows.join('');
  if (!joined.includes('S')) problems.push(`level ${id} has no spawn`);
  if (id !== 'arena' && !joined.includes('L') && !joined.includes('B')) problems.push(`level ${id} has no exit or boss`);
  if (spec.rows.length !== spec.height) problems.push(`level ${id} row count ${spec.rows.length} != ${spec.height}`);
  for (const row of spec.rows) if (row.length !== spec.width) problems.push(`level ${id} has a row of width ${row.length} != ${spec.width}`);
}

// Simulation: no NaN, no falling out of the world, and progress is not zero.
for (const id of Object.keys(LEVELS)) {
  const r = simulate({ level: id, steps: 3600, seed: 3 });
  if (r.bugs?.length) problems.push(`sim ${id}: ${r.bugs.join('; ')}`);
  if (r.progress < 4) problems.push(`sim ${id}: bot made no progress (${r.progress}%)`);
}

// Version file must be valid.
try { JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8')); }
catch { problems.push('version.json missing or invalid'); }

if (problems.length) {
  console.error('VERIFY FAILED\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log('VERIFY OK');
