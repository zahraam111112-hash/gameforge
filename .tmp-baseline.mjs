import { simulate } from './harness/sim.mjs';
for (const seed of [1, 5, 11, 42]) {
  const r = simulate({ level: 's1', steps: 5400, seed });
  console.log('s1', seed, JSON.stringify({ progress: r.progress, deaths: r.deaths, deathSpots: r.deathSpots, stuck: r.stuckRatio, won: r.won, kills: r.enemiesKilled, bugs: r.bugs }));
}
const a = simulate({ level: 'arena', steps: 5400, seed: 1 });
console.log('arena', JSON.stringify(a));
