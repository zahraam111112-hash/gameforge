import { simulate } from './harness/sim.mjs';
for (const id of ['s1','arena']) {
  const r = simulate({ level: id, steps: 5400, seed: 7 });
  console.log(id, JSON.stringify(r));
}
