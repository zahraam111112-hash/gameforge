import { simulate } from './harness/sim.mjs';
for (let seed = 1; seed <= 24; seed++) {
  const r = simulate({ level: 's1', steps: 5400, seed });
  console.log(seed, r.progress, 'deaths', r.deaths, JSON.stringify(r.deathSpots), 'stuck', r.stuckRatio);
}
