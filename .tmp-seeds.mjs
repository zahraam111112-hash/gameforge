import { simulate } from './harness/sim.mjs';
for (const level of ['s1','s2','s3']) {
  const out = [];
  for (let seed = 1; seed <= 12; seed++) {
    const r = simulate({ level, steps: 3600, seed });
    out.push(`${seed}:${r.status[0]}${r.won?'W':''}/${r.progress}`);
  }
  console.log(level, out.join(' '));
}
