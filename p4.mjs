import WebSocket from "ws";
const N=200, URL="ws://127.0.0.1:8787/ws";
const t0=Date.now();
const res=await Promise.all(Array.from({length:N},(_,i)=>new Promise(r=>{
  const ws=new WebSocket(URL); let id=null,f=0,self=false,st=false,moves=0,openAt=0,firstStateAt=0,lastStateAt=0;
  const fin=(why)=>{if(st)return;st=true;clearTimeout(T);clearInterval(P);
    try{ws.close()}catch{}
    r({f,self,why,open:openAt-t0,first:firstStateAt?firstStateAt-t0:0,last:lastStateAt?lastStateAt-t0:0});};
  const T=setTimeout(()=>fin("timeout"),30000);
  const P=setInterval(()=>{if(ws.readyState!==1)return;const k=++moves,d=Math.sin(i+k/8)>0;
    ws.send(JSON.stringify({t:"in",left:!d,right:d,jump:k%22<3,attack:k%45<2,dash:k%60<2,down:false}))},50);
  ws.on("open",()=>{openAt=Date.now();ws.send(JSON.stringify({t:"join",mode:i%5===0?"royale":"coop",level:"arena",name:"b"+i}))});
  ws.on("message",raw=>{let m;try{m=JSON.parse(raw)}catch{return}
    if(m.t==="welcome"&&m.id)id=m.id;
    if(m.t==="state"){if(!firstStateAt)firstStateAt=Date.now();lastStateAt=Date.now();f++;
      if(id&&(m.players||[]).some(p=>p.id===id))self=true;
      if(f>=20&&self)fin("ok")}});
  ws.on("close",()=>fin("closed")); ws.on("error",e=>fin("err:"+e.code));
})));
const whys={};for(const x of res)whys[x.why]=(whys[x.why]||0)+1;
const o=res.map(x=>x.open).sort((a,b)=>a-b), l=res.map(x=>x.last).sort((a,b)=>a-b), fr=res.map(x=>x.f).sort((a,b)=>a-b);
console.log("why:",JSON.stringify(whys));
console.log("open ms p10/med/p90:",o[20],o[100],o[180]);
console.log("lastState ms p10/med/p90:",l[20],l[100],l[180]);
console.log("frames p10/med/p90:",fr[20],fr[100],fr[180],"selfSeen",res.filter(x=>x.self).length);
