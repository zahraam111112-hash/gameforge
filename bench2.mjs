import { Room } from "/app/server/rooms.mjs";
const room=new Room("coop","b"); for(let i=0;i<100;i++) room.add("p"+i,"b"+i);
let t=Date.now(); for(let i=0;i<300;i++) room.prepare(); const prep=(Date.now()-t)/300;
t=Date.now(); const pv=room.prepare(); for(let c=0;c<300;c++) room.render(pv,null); const rend=(Date.now()-t)/300;
t=Date.now(); const m=room.render(pv,null); for(let c=0;c<300;c++) JSON.stringify(m); const str=(Date.now()-t)/300;
t=Date.now(); for(let i=0;i<300;i++) room.step(); const step=(Date.now()-t)/300;
console.log("prepare",prep.toFixed(2),"render",rend.toFixed(2),"stringify",str.toFixed(2),"step",step.toFixed(2),"ms each");
console.log("jsonBytes",JSON.stringify(m).length);
