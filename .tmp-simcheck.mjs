import { World, makePlayer } from './game/src/world.js';
import { simulate } from './harness/sim.mjs';
// quick trace: replicate sim loop but log every 20 frames
import { rng } from './game/src/util.js';

const r = simulate({ level: process.argv[2] ?? 's1', steps: 3600, seed: 1 });
console.log(JSON.stringify(r));
