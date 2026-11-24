import { World, makePlayer } from './game/src/world.js';
import { LEVELS } from './game/src/level.js';
import { rng } from './game/src/util.js';

function run({level='s3', steps=3600, seed=7, skill=0.82, noCoin=false, verbose=false}) {
  const world = new World(level, seed);
  const p = makePlayer(world.spawnPoint.x, world.spawnPoint.y);
  const rand = rng(seed);
  const bot = { dir: 1, hold: 0, chase: 0, chased: null };
  let maxX = p.x, lastX = p.x, deaths=0;
  const peturb=(bot,rand)=>{bot.dir=rand()<0.5?1:-1;bot.hold=20+Math.floor(rand()*30);};
  const pitSpan=(p,dir)=>{const ty=Math.floor((p.y+p.h+2)/16);const sx=Math.floor((p.x+p.w/2)/16);let s=0;for(let i=1;i<=8;i++){const tx=sx+i*dir;if(world.solidAt(tx,ty)||world.onewayAt(tx,ty))break;s++;}return s;};
  for (let i=0;i<steps;i++){
    let input;
    {
      if (bot.hold>0) bot.hold--;
      const aheadX=p.x+bot.dir*26;
      const tx=Math.floor(aheadX/16), ty=Math.floor((p.y+p.h)/16)+1;
      const gap=!world.solidAt(tx,ty)&&!world.onewayAt(tx,ty);
      const wall=world.solidAt(Math.floor((p.x+p.w/2+bot.dir*10)/16), Math.floor((p.y+p.h/2)/16));
      const enemy=world.entities.find(e=>e.kind==='enemy'&&!e.dead&&Math.abs(e.x-p.x)<40);
      const coin=noCoin?null:world.entities.find(e=>e.type==='coin'&&!e.dead&&Math.abs(e.x-p.x)<44);
      if(gap&&p.onGround){const span=pitSpan(p,bot.dir); if(span>3){bot.dir=-bot.dir;bot.hold=40;}}
      if(coin&&!gap&&!wall&&bot.chase<=0){bot.dir=coin.x>p.x?1:-1;bot.chase=45;bot.chased=coin;}
      if(bot.chase>0){bot.chase--; if(bot.chased?.dead){bot.chase=0;bot.chased=null;}}
      input={right:bot.dir>0,left:bot.dir<0,jump:gap||(wall&&rand()<skill),attack:Boolean(enemy)&&rand()<skill,dash:wall&&rand()<0.4,down:false};
    }
    world.tick(p,input);
    if (world.status!=='playing') { if(world.status==='lost'){deaths++;world.status='playing';p.hp=p.maxHp;p.x=world.spawnPoint.x;p.y=world.spawnPoint.y;} else break; }
    if(Math.abs(p.x-lastX)<0.2&&p.onGround&&bot.hold<=0) peturb(bot,rand);
    lastX=p.x; maxX=Math.max(maxX,p.x);
    if (verbose && i%100===0) console.log(i, 'col', (p.x/16).toFixed(1), 'status', world.status);
  }
  const progress=Math.min(1,maxX/Math.max(1,world.width-80));
  return {status:world.status, progress:+(progress*1000/10).toFixed(1), maxCol:(maxX/16).toFixed(1), deaths, hp:p.hp, coins:p.coins};
}
for (const noCoin of [false,true]) for (const seed of [1,7,11]) console.log('noCoin',noCoin,'seed',seed, JSON.stringify(run({level:'s3',noCoin,seed})));
