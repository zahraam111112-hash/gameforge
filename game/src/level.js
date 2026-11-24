import { TILE } from './util.js';

/* Tile legend — every character below is placed by a shipped map:
 *  '#' solid floor   '=' one-way platform   '.' empty
 *  'S' spawn   'L' exit flag   'C' checkpoint pole
 *  'E' easy enemy   'M' medium enemy   'H' hard enemy   'B' boss
 *  'o' coin   'h' health   '^' spikes
 *
 *  'C' is a respawn pole, not scenery. parseLevel emits a 'checkpoint' spawn at
 *  the tile's top-left +2 (the same x/y convention as 'E'/'M'/'H'), and
 *  world.js builds an {type:'checkpoint', x, y, w:12, h:24, dead:false,
 *  active:false} entity from it: `active` starts false, flips true the first
 *  time a player overlaps it, and that latch is what _fallOut respawns on.
 *  Each story stage carries exactly two poles, both on the walking row (the row
 *  directly above the floor) and both above a solid '#' tile: s1 columns 27 and
 *  51 of 68, s2 columns 30 and 57 of 76, s3 columns 34 and 63 of 84 — i.e.
 *  roughly 40% and 75% of each route, each clear of every '^' run and of the
 *  boss, and never over one of the pit gaps.
 *
 *  'L' is the exit flag: parseLevel emits {type:'exit', x, y}, which world.js
 *  widens to w:16/h:32 with dead:false. s1/s2/s3 each keep their one trailing
 *  'L' on the walking row; the arena carries exactly one, on its lowest
 *  walkable row (row 8) one column in from the far-right column that is backed
 *  by solid floor, and that gate stays locked until every seeded arena wave is
 *  cleared (see World.hasClearedWaves() and World.exitUnlocked()).
 *
 *  Neither 'C' nor 'L' is solid ('#' is the only solid tile any shipped map
 *  places), so the walking row keeps its width, grid columns stay put, and no
 *  enemy spawn index moves when a pole or flag is added.
 */

const P_FOREST = { sky1: '#0b1a2a', sky2: '#14324a', far: '#0e2635', near: '#123340', ground: '#23503f', accent: '#33e1c0' };
const P_CAVE   = { sky1: '#0a0a12', sky2: '#161226', far: '#1b1430', near: '#241a3d', ground: '#33264c', accent: '#b088ff' };
const P_FACTORY= { sky1: '#140f0a', sky2: '#2a1d10', far: '#2d2416', near: '#3a2e1c', ground: '#4e3c22', accent: '#ffb347' };

function pad(rows, h) {
  const out = rows.slice();
  while (out.length < h) out.push('.'.repeat(out[0].length));
  return out;
}

export const LEVELS = {
  s1: {
    id: 's1', name: 'Ashfall Meadow', width: 68, height: 17, music: 'meadow', palette: P_FOREST,
    rows: [
      '....................................................................',
      '....................................................................',
      '....................................................................',
      '....................................................................',
      '....................................................................',
      '....................................................................',
      '....................................................................',
      '......................................oooooooo......................',
      '...................oooooooo...........=========.....................',
      '......oooooooo.....=========......................oooooooooo........',
      '......=========...................................===========.......',
      '................................####................................',
      '..S......E...........^^^...CM..####......H...^^^...Ch....E....L.....',
      '################...###############...###############################',
      '################...###############...###############################',
      '################...###############...###############################',
      '################...###############...###############################',
    ],
  },
  s2: {
    id: 's2', name: 'Hollow Depths', width: 76, height: 17, music: 'cave', palette: P_CAVE,
    rows: [
      '............................................................................',
      '............................................................................',
      '............................................................................',
      '............................................................................',
      '............................................................................',
      '..........................................ooooooooo.........................',
      '..........................................=========.........................',
      '........................ooooooo.............................................',
      '......oooooooo..........=======.............................................',
      '......=========.............................................oooooooo........',
      '............................................................=========.......',
      '...............................#####........................................',
      '..S.......E......^^^^.....M....####..........H...^^^^.........h.....E...L...',
      '##################...###############...###############...###################',
      '##################...###############...###############...###################',
      '##################...###############...###############...###################',
      '##################...###############...###############...###################',
    ],
  },
  s3: {
    id: 's3', name: 'The Foundry', width: 84, height: 17, music: 'factory', palette: P_FACTORY,
    rows: [
      '....................................................................................',
      '....................................................................................',
      '....................................................................................',
      '....................................................................................',
      '....................................................................................',
      '....................................................................................',
      '..............................................ooooooo...............................',
      '..........................ooooooo.............=======...............................',
      '........oooooooo..........=======...................................................',
      '........=========.....................................h.............oooooooo........',
      '.....................................................####...........=========.......',
      '.................................................####...............................',
      '..S......E....^^^^.....M.....ooo.H...^^^.....####...............M.....B.....E...L...',
      '####################...#################...#################...#####################',
      '####################...#################...#################...#####################',
      '####################...#################...#################...#####################',
      '####################...#################...#################...#####################',
    ],
  },
  arena: {
    id: 'arena', name: 'Proving Grounds', width: 48, height: 14, music: 'arena', palette: P_FOREST,
    rows: [
      '................................................',
      '................................................',
      '................................................',
      'oooooooooooooo..................................',
      '................................................',
      '============....................................',
      '========........................................',
      'oo..............................................',
      'SSSSS...........................................',
      '################################################',
      '################################################',
      '################################################',
      '################################################',
      '################################################',
    ].map((r) => r.padEnd(48, '.')),
  },
};

export const STORY_ORDER = ['s1', 's2', 's3'];

export function parseLevel(spec) {
  const solids = [];
  const oneway = [];
  const spawns = [];
  const width = spec.width;
  const height = spec.height;
  let player = null;
  for (let y = 0; y < height; y++) {
    solids.push(new Array(width).fill(false));
    oneway.push(new Array(width).fill(false));
    const row = spec.rows[y] ?? '';
    for (let x = 0; x < width; x++) {
      const c = row[x] ?? '.';
      const px = x * TILE;
      const py = y * TILE;
      if (c === '#' || c === 'D') solids[y][x] = true;
      if (c === '=') oneway[y][x] = true;
      switch (c) {
        case 'S': player = { x: px + 2, y: py + 2 }; break;
        case 'L': spawns.push({ type: 'exit', x: px, y: py }); break;
        case 'E': spawns.push({ type: 'enemy1', x: px + 2, y: py + 2 }); break;
        case 'M': spawns.push({ type: 'enemy2', x: px + 2, y: py + 2 }); break;
        case 'H': spawns.push({ type: 'enemy3', x: px + 2, y: py + 2 }); break;
        case 'B': spawns.push({ type: 'boss', x: px - 8, y: py - 4 }); break;
        case 'o': spawns.push({ type: 'coin', x: px + 5, y: py + 5 }); break;
        case 'h': spawns.push({ type: 'health', x: px + 4, y: py + 4 }); break;
        case 'C': spawns.push({ type: 'checkpoint', x: px + 2, y: py + 2 }); break;
        case 'k': spawns.push({ type: 'key', x: px + 5, y: py + 4 }); break;
        case '^': spawns.push({ type: 'spike', x: px, y: py + 11 }); break;
        case 'D': spawns.push({ type: 'door', x: px, y: py }); break;
      }
    }
  }
  return { solids, oneway, spawns, player: player ?? { x: 32, y: 32 }, spec, width, height };
}
