import WebSocket from "ws";
const N=Number(process.env.N||200), URL=process.env.U||"ws://127.0.0.1:8787/ws";
let ok=0,errs={},maxPeers=0;
const t0=Date.now();
await Promise.all(Array.from({length:N},(_,i)=>new Promise(res=>{
  const ws=new WebSocket(URL); let id=null,f=0,self=false,st=false,moves=0;
  const fin=(k)=>{if(st)return;st=true;clearTimeout(T);clearInterval(P);try{ws.close()}catch{};if(k)ok++;else errs[k]=(errs[k]||0)+1;res()};
  const T=setTimeout(()=>fin("timeout"),35000);
  const P=setInterval(()=>{if(ws.readyState!==1)return;const k=++moves,d=Math.sin(i+k/8)>0;
    ws.send(JSON.stringify({t:"in",left:!d,right:d,jump:k%22<3,attack:k%45<2,dash:k%60<2,down:false}))},50);
  ws.on("open",()=>ws.send(JSON.stringify({t:"join",mode:i%5===0?"royale":"coop",level:"arena",name:"b"+i})));
  ws.on("message",raw=>{let m;try{m=JSON.parse(raw)}catch{return}
    if(m.t==="welcome"&&m.id)id=m.id;
    if(m.t==="error")return fin(m.error);
    if(m.t==="state"){f++;const s=new Set((m.players||[]).map(p=>p.id));if(id&&s.has(id))self=true;
      // count peers from this bot"s perspective
      if(m.players)maxPeers=Math.max(maxPeers,m.players.length);
      if(f>=20&&self)fin(true)}});
  ws.on("close",()=>fin(self?"ok":"closed"));
  ws.on("error",e=>fin(e.message));
})));
console.log(JSON.stringify({N,ok,failed:N-ok,errs,maxPeers,sec:Math.round((Date.now()-t0)/100)/10}));
