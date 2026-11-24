import { World, makePlayer } from "/app/game/src/world.js";
const w=new World("arena",424242);
console.log("entities:",w.entities.length,"solids rows:",w.solids.length,"cols:",w.solids[0].length);
const ps=[];for(let i=0;i<100;i++){const p=makePlayer(40+(i%8)*48,96+Math.floor(i/8)*40);p.input={left:false,right:true,jump:false,attack:true,dash:false,down:false};ps.push(p)}
let t=Date.now(); for(const p of ps) w.stepPlayer(p,p.input); const sp=(Date.now()-t);
t=Date.now(); for(let i=0;i<10;i++) w.updateEnemies(); const ue=(Date.now()-t)/10;
console.log("stepPlayer x100:",sp,"ms  updateEnemies:",ue.toFixed(2),"ms");
