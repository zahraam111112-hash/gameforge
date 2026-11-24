import { Room } from "/app/server/rooms.mjs";
for (const n of [50,100]) {
  const r=new Room("coop","arena"); for(let i=0;i<n;i++) r.add("p"+i,"b"+i);
  for(let i=0;i<n;i++){const p=r.players.get("p"+i); p.x+=i;}
  const v=r.prepare();
  const seen=new Map(); for(const [k,val] of v.keys) seen.set(k,val);
  let t=Date.now(); for(let c=0;c<n;c++) r.render(v,seen); // nobody changed
  console.log(n+" players, 0 changes: "+(Date.now()-t)+"ms");
  t=Date.now(); for(let c=0;c<n;c++) JSON.stringify(r.render(v,seen));
  console.log(n+" players, stringify x"+n+": "+(Date.now()-t)+"ms");
}
