import WebSocket from "ws";
const N=Number(process.env.N||200), URL="ws://127.0.0.1:8787/ws";
const res=await Promise.all(Array.from({length:N},(_,i)=>new Promise(r=>{
  const ws=new WebSocket(URL); let id=null,f=0,self=false,st=false,room=null,moves=0;
  const fin=()=>{if(st)return;st=true;clearTimeout(T);clearInterval(P);try{ws.close()}catch{};r({f,self,room})};
  const T=setTimeout(fin,25000);
  const P=setInterval(()=>{if(ws.readyState!==1)return;const k=++moves,d=Math.sin(i+k/8)>0;
    ws.send(JSON.stringify({t:"in",left:!d,right:d,jump:k%22<3,attack:k%45<2,dash:k%60<2,down:false}))},50);
  ws.on("open",()=>ws.send(JSON.stringify({t:"join",mode:i%5===0?"royale":"coop",level:"arena",name:"b"+i})));
  ws.on("message",raw=>{let m;try{m=JSON.parse(raw)}catch{return}
    if(m.t==="welcome"&&m.id)id=m.id;
    if(m.t==="state"){f++;room=m.room;if(id&&(m.players||[]).some(p=>p.id===id))self=true;
      if(f>=20&&self)fin()}});
  ws.on("close",fin); ws.on("error",fin);
})));
const F=res.map(x=>x.f).sort((a,b)=>a-b);
const hist={};for(const x of res)hist[x.f>=20?"20+":x.f]= (hist[x.f>=20?"20+":x.f]||0)+1;
console.log("bots",N,"selfSeen",res.filter(x=>x.self).length,"frames p10/med/max",F[Math.floor(N*.1)],F[Math.floor(N/2)],F[N-1]);
console.log("frame histogram:",JSON.stringify(hist));
