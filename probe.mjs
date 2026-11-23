import WebSocket from "ws";
const N=120, URL="ws://site:8787/ws";
const got={frames:[],welcome:0,state:0};
const runs=await Promise.all(Array.from({length:N},(_,i)=>new Promise(res=>{
  const ws=new WebSocket(URL); let f=0, self=false, id=null;
  const t=setTimeout(()=>{try{ws.close()}catch{};res({f,self})},15000);
  ws.on("open",()=>ws.send(JSON.stringify({t:"join",mode:"coop",level:"arena",name:"b"+i})));
  ws.on("message",raw=>{const m=JSON.parse(raw); if(m.t==="welcome"&&m.id)id=m.id;
    if(m.t==="state"){f++; got.state++; if((m.players||[]).some(p=>p.id===id))self=true;}});
  ws.on("close",()=>{clearTimeout(t);res({f,self})});
  ws.on("error",()=>{clearTimeout(t);res({f,self})});
})));
const frames=runs.map(r=>r.f).sort((a,b)=>a-b);
console.log("bots",N,"selfSeen",runs.filter(r=>r.self).length,"frames min/med/max",frames[0],frames[Math.floor(N/2)],frames[N-1]);
console.log("bots with <10 frames:",frames.filter(f=>f<10).length,"== 0 frames:",frames.filter(f=>f===0).length);
process.exit(0);
