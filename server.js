
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const words = JSON.parse(fs.readFileSync(path.join(__dirname, "words.json"), "utf8"));
const rooms = new Map();

function shuffle(a){ return [...a].sort(()=>Math.random()-0.5); }
function code(){
  const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let c; do { c=""; for(let i=0;i<4;i++) c+=chars[Math.floor(Math.random()*chars.length)]; } while(rooms.has(c));
  return c;
}
function makeCards(){
  const selected=shuffle(words).slice(0,25);
  const roles=shuffle([
    ...Array(9).fill("blue"),
    ...Array(8).fill("red"),
    ...Array(7).fill("neutral"),
    "assassin"
  ]);
  return selected.map((word,i)=>({word,role:roles[i],revealed:false}));
}
function publicCards(room, captainId){
  return room.cards.map((c,i)=>({
    word:c.word,
    revealed:c.revealed,
    role:(c.revealed || captainId===room.captainId) ? c.role : undefined
  }));
}
function send(ws,obj){ if(ws.readyState===1) ws.send(JSON.stringify(obj)); }
function broadcast(room, revealIndex=-1, message=""){
  for(const p of room.players.values()){
    send(p.ws,{
      type:"state", room:room.code, playerId:p.id, captain:room.captainId,
      players:[...room.players.values()].map(x=>({name:x.name,captain:x.id===room.captainId})),
      cards:publicCards(room,p.id), clue:room.clue, revealIndex, message
    });
  }
}
function newRoom(){
  const r={code:code(),players:new Map(),captainId:null,cards:makeCards(),clue:"",ended:false};
  rooms.set(r.code,r); return r;
}
function addPlayer(room,ws,name){
  const id=crypto.randomUUID();
  const p={id,name:String(name||"لاعب").slice(0,18),ws};
  room.players.set(id,p);
  if(!room.captainId) room.captainId=id;
  return p;
}
function cleanup(room){
  if(room.players.size===0) rooms.delete(room.code);
}

const server=http.createServer((req,res)=>{
  let file=req.url.split("?")[0];
  if(file==="/"||file==="/index.html") file="/index.html";
  if(file==="/words.json") {res.writeHead(404);return res.end("not found");}
  const fp=path.join(__dirname,file);
  if(!fp.startsWith(__dirname)||!fs.existsSync(fp)) {res.writeHead(404);return res.end("404");}
  res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"});
  res.end(fs.readFileSync(fp));
});
const wss=new WebSocketServer({server});

wss.on("connection",ws=>{
  ws.room=null; ws.player=null;
  ws.on("message",raw=>{
    let m; try{m=JSON.parse(raw)}catch{return}
    if(m.type==="create"){
      const room=newRoom(), p=addPlayer(room,ws,m.name);
      ws.room=room;ws.player=p;
      send(ws,{type:"created",room:room.code,playerId:p.id,captain:true});
      broadcast(room,-1,"👑 أنت قائد الغرفة. ارسل الرابط لخويانك.");
      return;
    }
    if(m.type==="join"){
      const room=rooms.get(String(m.room||"").toUpperCase());
      if(!room)return send(ws,{type:"error",message:"الغرفة غير موجودة أو انتهت"});
      if(room.players.size>=12)return send(ws,{type:"error",message:"الغرفة فلّت"});
      const p=addPlayer(room,ws,m.name);ws.room=room;ws.player=p;
      send(ws,{type:"joined",room:room.code,playerId:p.id,captain:p.id===room.captainId});
      broadcast(room,-1,p.name+" دخل الغرفة 🎮");
      return;
    }
    const room=ws.room,p=ws.player;
    if(!room||!p)return;
    if(m.type==="reveal"){
      const i=Number(m.index);
      if(!Number.isInteger(i)||!room.cards[i]||room.cards[i].revealed||room.ended)return;
      room.cards[i].revealed=true;
      const role=room.cards[i].role;
      let msg=role==="assassin"?"💀 النذر انكشف! انتهت الجولة.":role==="neutral"?"⚪ محايد — الدور ينتقل.":role==="blue"?"🔵 انكشفت كلمة الأزرق":"🔴 انكشفت كلمة الأحمر";
      if(role==="assassin")room.ended=true;
      broadcast(room,i,msg);
      return;
    }
    if(m.type==="clue"){
      room.clue=String(m.value||"").slice(0,80);
      broadcast(room,-1,"💡 تم تحديث التلميح");
      return;
    }
    if(m.type==="newGame"){
      if(p.id!==room.captainId)return;
      room.cards=makeCards();room.clue="";room.ended=false;
      broadcast(room,-1,"🎲 بدأت لعبة جديدة!");
      return;
    }
  });
  ws.on("close",()=>{
    const room=ws.room,p=ws.player;if(!room||!p)return;
    room.players.delete(p.id);
    if(room.captainId===p.id){
      const next=room.players.values().next().value;
      room.captainId=next?next.id:null;
    }
    if(room.players.size)broadcast(room,-1,"👋 لاعب طلع من الغرفة");
    cleanup(room);
  });
});

server.listen(PORT,()=>console.log("Abu Saad Codenames online on "+PORT));
