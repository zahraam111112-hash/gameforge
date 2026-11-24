import { Room } from "/app/server/rooms.mjs";
const room = new Room("coop", "bench");
for (let i=0;i<100;i++) room.add("p"+i, "b"+i);
const t0=Date.now(); let rounds=0; const views=[];
const N=100;
const v=room.prepare();
for(let it=0;it<30;it++){ // 30 ticks
  const pv=room.prepare();
  for(let c=0;c<N;c++){ const m=room.render(pv,null); JSON.stringify(m); rounds++; }
}
const dt=Date.now()-t0;
console.log("100 players x 100 clients x 30 ticks =",rounds,"msgs in",dt,"ms =>",Math.round(dt/30),"ms per tick");
