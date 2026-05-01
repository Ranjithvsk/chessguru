'use strict';
const fs=require('fs'),path=require('path'),{spawn}=require('child_process'),{EventEmitter}=require('events'),http=require('http'),WebSocket=require('ws'),mongoose=require('mongoose');
const ENGINES_DIR=path.join(process.env.HOME,'engines'),EB_DIR=path.join(process.env.HOME,'chessguru/engine-battle'),ENGINES_JSON=path.join(EB_DIR,'engines.json'),PORT=3002,MONGO=`mongodb://localhost:27017/chessguru`;
const gS=new mongoose.Schema({tournamentId:String,round:Number,whiteId:String,whiteName:String,blackId:String,blackName:String,result:String,moves:[String],pgn:String,thinkMs:Number,startedAt:Date,endedAt:Date,termination:String,whiteElo:Number,blackElo:Number});
const tS=new mongoose.Schema({_id:String,name:String,engineIds:[String],thinkMs:Number,maxGames:Number,startedAt:Date,endedAt:Date,status:{type:String,default:'running'},currentRound:{type:Number,default:0},standings:mongoose.Schema.Types.Mixed});
let Game,Tournament;
function loadEngines(){
  const reg=JSON.parse(fs.readFileSync(ENGINES_JSON));
  const out=[];
  const seenBinaries=new Map();
  for(const e of reg.engines){
    if(!e.binary)continue;
    const bp=path.join(ENGINES_DIR.replace('~',process.env.HOME),e.binary);
    if(!fs.existsSync(bp))continue;
    // sf_limited: allow multiple entries per binary (different UCI_Elo)
    if(e.type==='sf_limited'||e.type==='maia'){
      out.push({...e,path:bp});
    } else {
      if(!seenBinaries.has(bp)){seenBinaries.set(bp,true);out.push({...e,path:bp});}
    }
  }
  return out;
}
class UCIEngine extends EventEmitter{
  constructor(eng){super();this.engine=eng;this.proc=null;this.buf='';}
  start(){return new Promise((res,rej)=>{this.proc=spawn(this.engine.path,[],{cwd:path.dirname(this.engine.path)});this.proc.stdout.setEncoding('utf8');this.proc.stderr.setEncoding('utf8');this.proc.stdout.on('data',d=>this._data(d));this.proc.stderr.on('data',()=>{});this.proc.on('error',rej);this.proc.on('exit',()=>{this.ready=false;});this.send('uci');const t=setTimeout(()=>rej(new Error(this.engine.name+' uci timeout')),10000);this.once('uciok',()=>{clearTimeout(t);if(this.engine.skillLevel!=null)this.send('setoption name Skill Level value '+this.engine.skillLevel);if(this.engine.uciElo!=null){this.send('setoption name UCI_LimitStrength value true');this.send('setoption name UCI_Elo value '+this.engine.uciElo);}this.send('isready');});this.once('readyok',()=>res());});}
  _data(data){this.buf+=data;const ls=this.buf.split('\n');this.buf=ls.pop();for(const l of ls){const t=l.trim();if(t==='uciok')this.emit('uciok');else if(t==='readyok')this.emit('readyok');else if(t.startsWith('bestmove'))this.emit('bestmove',t.split(' ')[1]);
      else if(t.startsWith('info')&&t.includes('depth')&&t.includes('score'))this.emit('info',t);}}
  send(cmd){if(this.proc&&this.proc.stdin.writable)this.proc.stdin.write(cmd+'\n');}
  think(fen,moves,tc,side,engineName){return new Promise((res,rej)=>{this.send('ucinewgame');this.send('position fen '+fen+(moves.length?' moves '+moves.join(' '):''));const timeout=tc.wtime+tc.btime+30000;const t=setTimeout(()=>rej(new Error('timeout')),timeout);const infoH=raw=>{const parsed=parseInfo(raw);if(parsed)bc({type:'engine_info',side,engine:engineName,info:parsed});};this.on('info',infoH);this.once('bestmove',mv=>{clearTimeout(t);this.removeListener('info',infoH);res(mv);});this.send('go wtime '+tc.wtime+' btime '+tc.btime+' winc '+tc.winc+' binc '+tc.binc);});}
  quit(){try{this.send('quit');}catch(e){}setTimeout(()=>{try{this.proc&&this.proc.kill();}catch(e){}},500);}
}
let Chess=null;try{const cjs=require('chess.js');Chess=cjs.Chess||cjs;}catch(e){console.error('chess.js load fail:',e.message);}
function parseInfo(raw){
  const get=(k)=>{const m=raw.match(new RegExp(k+' ([-\d]+)'));return m?parseInt(m[1]):null;}
  const getStr=(k)=>{const m=raw.match(new RegExp(k+' (.+?)(?= (?:depth|seldepth|nodes|score|time|pv|nps)|$)'));return m?m[1].trim():null;}
  const depth=get('depth'),nodes=get('nodes'),nps=get('nps'),time=get('time');
  const scoreCp=raw.includes('score cp')?get('score cp'):null;
  const scoreMate=raw.includes('score mate')?get('score mate'):null;
  const pvMatch=raw.match(/ pv (.+)$/);
  const pv=pvMatch?pvMatch[1].split(' ').slice(0,5):[];
  if(depth===null)return null;
  return{depth,nodes,nps,time,scoreCp,scoreMate,pv};
}
let wss,clients=new Set();
function bc(msg){const d=JSON.stringify(msg);for(const c of clients)if(c.readyState===1)c.send(d);}
async function runGame(W,B,tc,tid,round){
  const FEN='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const moves=[];let chess=Chess?new Chess():null,result='*',term='';
  let wtime=tc.base, btime=tc.base;
  const gd={tournamentId:tid,round,whiteId:W.engine.id,whiteName:W.engine.name,blackId:B.engine.id,blackName:B.engine.name,result:'*',moves:[],thinkMs:tc.base,startedAt:new Date(),whiteElo:W.engine.elo,blackElo:B.engine.elo};
  bc({type:'game_start',game:gd,round,tc});
  try{
    let cur=W,oth=B,side='white';
    for(let p=0;p<300;p++){
      const clock={wtime,btime,winc:tc.inc,binc:tc.inc};
      const t0=Date.now();
      const mv=await cur.think(FEN,moves,clock,side,cur.engine.name);
      const elapsed=Date.now()-t0;
      if(side==='white'){wtime=Math.max(100,wtime-elapsed+tc.inc);}else{btime=Math.max(100,btime-elapsed+tc.inc);}
      bc({type:'clock',wtime,btime,side});
      if(!mv||mv==='(none)'||mv==='null'){result=side==='white'?'0-1':'1-0';term='no move';break;}
      if(chess){const m=chess.move(mv,{sloppy:true});if(!m){result=side==='white'?'0-1':'1-0';term='illegal';break;}moves.push(mv);bc({type:'move',move:m.san,uci:mv,fen:chess.fen(),ply:p,side});if(chess.isCheckmate()){result=side==='white'?'1-0':'0-1';term='checkmate';break;}if(chess.isDraw()){result='1/2-1/2';term='draw';break;}}
      else{moves.push(mv);bc({type:'move',move:mv,uci:mv,fen:'',ply:p,side});if(moves.length>=200){result='1/2-1/2';term='limit';break;}}
      [cur,oth]=[oth,cur];side=side==='white'?'black':'white';
    }
  }catch(e){result='1/2-1/2';term='err:'+e.message;}
  if(result==='*'){result='1/2-1/2';term='move limit';}
  const d=new Date().toISOString().slice(0,10).replace(/-/g,'.');
  let pgn=`[Event "ChessGuru Engine Battle"]\n[White "${gd.whiteName}"]\n[Black "${gd.blackName}"]\n[Date "${d}"]\n[Result "${result}"]\n\n`;
  if(chess)pgn+=chess.pgn()+' '+result;
  else{let n=1;for(let i=0;i<moves.length;i++){if(i%2===0)pgn+=n+++'. ';pgn+=moves[i]+' ';}pgn+=result;}
  const fin={...gd,result,moves,pgn,termination:term,endedAt:new Date()};
  try{await Game.create(fin);}catch(e){}
  bc({type:'game_end',game:fin,result,termination:term});
  return fin;
}
function rr(engines){const p=[];for(let i=0;i<engines.length;i++)for(let j=i+1;j<engines.length;j++){p.push({W:engines[i],B:engines[j]});p.push({W:engines[j],B:engines[i]});}return p;}
function calc(games,ids){const s={};for(const id of ids)s[id]={id,wins:0,draws:0,losses:0,points:0,games:0};for(const g of games){if(!g.result||g.result==='*')continue;const w=s[g.whiteId],b=s[g.blackId];if(!w||!b)continue;w.games++;b.games++;if(g.result==='1-0'){w.wins++;w.points+=1;b.losses++;}else if(g.result==='0-1'){b.wins++;b.points+=1;w.losses++;}else{w.draws++;b.draws++;w.points+=0.5;b.points+=0.5;}}return Object.values(s).sort((a,b)=>b.points-a.points);}
let running=false,active=null;
async function tourney(cfg){
  const{engineIds,thinkMs,maxGames,name,base,inc}=cfg;
  const tc={base:base||(thinkMs?thinkMs:600000),inc:(inc||0)*1000};
  const sel=loadEngines().filter(e=>engineIds.includes(e.id)).slice(0,16);
  if(sel.length<2){bc({type:'error',msg:'Need 2+ engines'});return;}
  const tid='T'+Date.now(),pairs=rr(sel),limit=maxGames?Math.min(maxGames,pairs.length):pairs.length;
  const t={_id:tid,name:name||'Tournament '+new Date().toLocaleDateString(),engineIds:sel.map(e=>e.id),thinkMs,maxGames:limit,startedAt:new Date(),status:'running'};
  try{await Tournament.create(t);}catch(e){}
  active=t;running=true;
  bc({type:'tournament_start',tournament:t,engines:sel.map(e=>({id:e.id,name:e.name,elo:e.elo})),totalGames:limit,tc});
  const done=[];
  for(let i=0;i<limit&&running;i++){
    const{W,B}=pairs[i];bc({type:'round_start',round:i+1,total:limit,white:W.name,black:B.name});
    const we=new UCIEngine(W),be=new UCIEngine(B);
    try{await Promise.all([we.start(),be.start()]);const gm=await runGame(we,be,tc,tid,i+1);done.push(gm);
      const st=calc(done,sel.map(e=>e.id));const nm={};for(const e of sel)nm[e.id]=e.name;st.forEach(s=>{s.name=nm[s.id]||s.id;});
      bc({type:'standings_update',standings:st,gamesPlayed:i+1,totalGames:limit});
      await Tournament.findByIdAndUpdate(tid,{currentRound:i+1,standings:{list:st}}).catch(()=>{});
    }catch(err){bc({type:'game_error',error:err.message,round:i+1});}
    finally{we.quit();be.quit();await new Promise(r=>setTimeout(r,500));}
  }
  const fin=calc(done,sel.map(e=>e.id));const nm={};for(const e of sel)nm[e.id]=e.name;fin.forEach(s=>{s.name=nm[s.id]||s.id;});
  await Tournament.findByIdAndUpdate(tid,{status:'completed',endedAt:new Date(),standings:{list:fin}}).catch(()=>{});
  bc({type:'tournament_end',standings:fin,tournamentId:tid});running=false;active=null;
}
async function main(){
  await mongoose.connect(MONGO);
  Game=mongoose.model('EngineGame',gS);Tournament=mongoose.model('EngineTournament',tS);
  const srv=http.createServer((req,res)=>{
    const h={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'};
    if(req.url==='/health'){res.writeHead(200,h);res.end(JSON.stringify({status:'ok',running}));return;}
    if(req.url==='/engines'){res.writeHead(200,h);res.end(JSON.stringify(loadEngines().map(e=>({id:e.id,name:e.name,elo:e.elo,type:e.type}))));return;}
    if(req.url.startsWith('/games')){Game.find({}).sort({startedAt:-1}).limit(50).then(g=>{res.writeHead(200,h);res.end(JSON.stringify(g));}).catch(()=>{res.writeHead(500);res.end('[]');});return;}
    if(req.url==='/tournaments'){Tournament.find({}).sort({startedAt:-1}).limit(20).then(t=>{res.writeHead(200,h);res.end(JSON.stringify(t));}).catch(()=>{res.writeHead(500);res.end('[]');});return;}
    res.writeHead(404);res.end('nf');
  });
  wss=new WebSocket.Server({server:srv});
  wss.on('connection',ws=>{
    clients.add(ws);
    ws.send(JSON.stringify({type:'connected',engines:loadEngines().map(e=>({id:e.id,name:e.name,elo:e.elo,type:e.type})),running,tournament:active}));
    ws.on('message',async raw=>{
      try{const msg=JSON.parse(raw);
        if(msg.type==='start_tournament'){if(running){ws.send(JSON.stringify({type:'error',msg:'Already running'}));return;}tourney(msg).catch(e=>bc({type:'error',msg:e.message}));}
        else if(msg.type==='stop'){running=false;bc({type:'stopped'});}
      }catch(e){}
    });
    ws.on('close',()=>clients.delete(ws));
  });
  srv.listen(PORT,()=>console.log('[engine_runner] port',PORT));
}
main().catch(e=>{console.error('Fatal:',e.message);process.exit(1);});
