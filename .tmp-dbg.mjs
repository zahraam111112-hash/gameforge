import { World, makePlayer } from './game/src/world.js';
import { rng } from './game/src/util.js';
import { simulate } from './harness/sim.mjs';

// replicate simulate() but log
const level='s3', steps=3600, seed=7, skill=0.82;
const world = new World(level, seed);
const p = makePlayer(world.spawnPoint.x, world.spawnPoint.y);
const rand = rng(seed);
const bot = { dir: 1, hold: 0, chase: 0, chased: null };
function peturb(bot, rand){ bot.dir = rand()<0.5?1:-1; bot.hold = 20+Math.floor(rand()*30); }
function pitSpan(world,p,dir){ const ty=Math.floor((p.y+p.h+2)/16); const startX=Math.floor((p.x+p.w/2)/16); let span=0; for(let i=1;i<=8;i++){const tx=startX+i*dir; if(world.solidAt(tx,ty)||world.onewayAt(tx,ty))break; span++;} return span; }
function botInput(p, world, rand, skill, bot){
  if (bot.hold>0) bot.hold--;
  const lookAhead=26, aheadX=p.x+bot.dir*lookAhead;
  const tx=Math.floor(aheadX/16), ty=Math.floor((p.y+p.h)/16)+1;
  const gap=!world.solidAt(tx,ty)&&!world.onewayAt(tx,ty);
  const wall=world.solidAt(Math.floor((p.x+p.w/2+bot.dir*10)/16), Math.floor((p.y+p.h/2)/16));
  const enemy=world.entities.find(e=>e.kind==='enemy'&&!e.dead&&Math.abs(e.x-p.x)<40);
  const coin=world.entities.find(e=>e.type==='coin'&&!e.dead&&Math.abs(e.x-p.x)<44);
  if(gap&&p.onGround){const span=pitSpan(world,p,bot.dir); if(span>3){bot.dir=-bot.dir;bot.hold=40;}}
  if(coin&&!gap&&!wall&&bot.chase<=0){bot.dir=coin.x>p.x?1:-1;bot.chase=45;bot.chased=coin;}
  if(bot.chase>0){bot.chase--; if(bot.chased?.dead){bot.chase=0;bot.chased=null;}}
  return {right:bot.dir>0,left:bot.dir<0,jump:gap||(wall&&rand()<skill),attack:Boolean(enemy)&&rand()<skill,dash:wall&&rand()<0.4,down:false};
}
let lastX=p.x;
for(let i=0;i<steps;i++){
  const inp=botInput(p,world,rand,skill,bot);
  world.tick(p,inp);
  if(Math.abs(p.x-lastX)<0.2&&p.onGround&&bot.hold<=0) peturb(bot,rand);
  if(i%100===0) console.log(i,'x',p.x.toFixed(0),'col',(p.x/16).toFixed(1),'y',p.y.toFixed(0),'dir',bot.dir,'hp',p.hp,'status',world.status);
  lastX=p.x;
  if(world.status!=='playing'){ if(world.status==='lost'){world.status='playing';p.hp=p.maxHp;p.x=world.spawnPoint.x;p.y=world.spawnPoint.y;} else break; }
}
console.log('end', world.status, p.x/16, world.entities.filter(e=>e.kind==='enemy').map(e=>[e.type,Math.round(e.x/16),e.hp,e.dead]));
