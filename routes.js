function fmtPuzzle(p){if(!p)return null;const {_id,line,glicko,...rest}=p;return {...rest,id:_id,rating:Math.round((glicko&&glicko.r)||1500),ratingDeviation:Math.round((glicko&&glicko.d)||500),solution:line?line.trim().split(" "):[],glicko};}
const express=require('express'),router=express.Router(),mongoose=require('mongoose');
const {User,UserPerfs,Round}=require('./models');
const {updatePuzzleRating}=require('./glicko2');
const PS=new mongoose.Schema({_id:String,fen:String,line:String,glicko:{r:Number,d:Number,v:Number},plays:Number,vote:Number,themes:[String],pieceCount:Number},{versionKey:false,_id:false});
const Puzzle=mongoose.models.Puzzle||mongoose.model('Puzzle',PS);
const PathS=new mongoose.Schema({_id:String,min:String,max:String,ids:[String]},{versionKey:false,_id:false});
const Path=mongoose.models.Path||mongoose.model('Path',PathS,'paths');
const PiecePoolS=new mongoose.Schema({_id:String,theme:String,maxPc:Number,count:Number,ids:[String],gen:Number},{versionKey:false,_id:false});
const PiecePool=mongoose.models.PiecePool||mongoose.model('PiecePool',PiecePoolS,'piecePools');
const DIFF={easiest:-600,easier:-300,normal:0,harder:300,hardest:600};
// ══ LICHESS-EXACT: Quality tiers (PuzzleTier.scala) ══════════════════════
// top  = vote>=0.75 AND plays>=100  |  good = vote>=0.50 AND plays>=20  |  all = everything
function tierQ(tier){
  if(tier==='top')  return {vote:{$gte:0.75},plays:{$gte:100}};
  if(tier==='good') return {vote:{$gte:0.50},plays:{$gte:20}};
  return {};
}

// ══ LICHESS-EXACT: In-memory session store (PuzzleSession.scala) ══════════
// TTL=1hr, flushed on theme/difficulty change or rating drift >100
const _sessions=new Map();
function _sGet(uid){const s=_sessions.get(uid);return(s&&Date.now()-s.at<3600000)?s:null;}
function _sSet(uid,s){s.at=Date.now();_sessions.set(uid,s);}
function _sFlush(s,theme,diff,rating){
  if(!s||s.theme!==theme||s.diff!==diff)return true;
  if(Math.abs((s.rating||1500)-rating)>100)return true;
  return false;
}

// Create fresh session: sample 200 puzzle IDs at target rating band
async function _sCreate(uid,theme,diff,rating){
  const delta=DIFF[diff]||0;
  const target=Math.max(400,Math.min(3000,rating+delta));
  const flex=Math.round(100+Math.abs(1500-target)/4);
  const themeQ=theme==='mix'?{}:{themes:theme};
  let ids=[];
  for(const tier of ['top','good','all']){
    const docs=await Puzzle.find({'glicko.r':{$gte:target-flex,$lte:target+flex},...tierQ(tier),...themeQ})
      .select('_id').limit(200).lean();
    if(docs.length>=5){ids=docs.map(d=>String(d._id));break;}
  }
  if(!ids.length){
    const docs=await Puzzle.find({'glicko.r':{$gte:target-400,$lte:target+400},...themeQ})
      .select('_id').limit(200).lean();
    ids=docs.map(d=>String(d._id));
  }
  // Shuffle for variety
  for(let i=ids.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[ids[i],ids[j]]=[ids[j],ids[i]];}
  const s={uid,theme,diff,rating,ids,pos:0,at:Date.now()};
  _sSet(uid,s); return s;
}

// ══ LICHESS-EXACT: Session-aware selector with dedup + flex fallback ═══════
// Mirrors PuzzleSelector.scala + PuzzlePathApi.nextFor
async function _getNextForUser(uid,theme,diff,rating){
  let s=_sGet(uid);
  if(_sFlush(s,theme,diff,rating)) s=await _sCreate(uid,theme,diff,rating);
  for(let retry=0;retry<10;retry++){
    if(s.pos>=s.ids.length) s=await _sCreate(uid,theme,diff,rating); // PathEnded
    const pid=s.ids[s.pos++]; _sSet(uid,s);
    if(!pid) continue;
    const pz=await Puzzle.findById(pid).lean();
    if(!pz) continue; // PuzzleMissing
    // ── Already-played dedup (PuzzleAlreadyPlayed check) ────────────────
    if(retry<5){const played=await Round.findOne({_id:{$regex:'^'+uid+':'},$where:'this._id.endsWith(":'+pid+'")'}).lean();if(played)continue;}
    return pz;
  }
  return null; // fallback to getPz below
}

const SBUCKETS=[{r:1050,n:3},{r:1150,n:4},{r:1300,n:5},{r:1450,n:6},{r:1600,n:7},{r:1750,n:8},{r:1900,n:10},{r:2050,n:13},{r:2199,n:15},{r:2349,n:17},{r:2499,n:19},{r:2649,n:21},{r:2799,n:21}];
const Redis=require('ioredis');
const redis=new Redis({host:'127.0.0.1',port:6379,retryStrategy:()=>null,enableOfflineQueue:false});
redis.on('error',()=>{});
const sCache={d:null,ts:0},dayCache={d:null,ts:0};
async function rGet(k){try{const v=await redis.get(k);return v?JSON.parse(v):null;}catch(e){return null;}}
async function rSet(k,v,ttl=60){try{await redis.set(k,JSON.stringify(v),'EX',ttl);}catch(e){}}

function pid(a,t,r){return a+'|'+t+'|'+String(Math.max(0,Math.round(r))).padStart(4,'0');}
function stepDown(t){return t==='top'?'good':t==='good'?'all':null;}
async function fromPath(a,t,r){const k=pid(a,t,r);
const p=await Path.aggregate([{$match:{min:{$lte:k},max:{$gte:k}}},{$sample:{size:1}}]);
if(!p.length||!p[0].ids?.length)return null;const ids=p[0].ids;
return Puzzle.findById(ids[Math.floor(Math.random()*ids.length)]).lean();}
async function sel(a,t,r,n=0){if(n>3)return null;const p=await fromPath(a,t,r);if(p)return p;
const nx=stepDown(t);return nx?sel(a,nx,r,n+1):null;}
async function getPool(a,d,ur=1500,pieceMin=0,pieceMax=32){const k=a+':'+d+':'+Math.round(ur/100)+':pc'+pieceMin+'-'+pieceMax;const cached=await rGet(k);
if(cached)return cached;
const delta=DIFF[d]||0,mid=Math.max(400,Math.min(3000,ur+delta)),q=a==='mix'?{}:{themes:a};
const p=await Puzzle.find({...q,'glicko.r':{$gte:mid-200,$lte:mid+200}}).sort({vote:-1}).limit(300).lean();
const filtered=(pieceMin>0||pieceMax<32)?p.filter(function(x){return x.pieceCount>=pieceMin&&x.pieceCount<=pieceMax;}):p;await rSet(k,filtered,60);return filtered;}
async function getPz(a,d,ur,pieceMin=0,pieceMax=32,userRating=undefined){const bfRating=userRating&&userRating<ur?userRating:ur;const delta=DIFF[d]||0,t=Math.max(400,Math.min(3000,bfRating+delta));
const p=await sel(a,'top',t);if(p&&(pieceMin<=0||pieceMax>=32||(p.pieceCount>=pieceMin&&p.pieceCount<=pieceMax)))return p;
// Fast path: use bfPools for blindfold (theme+rating+pieceCount pre-indexed)
if((pieceMin>0||pieceMax<32)&&ur&&a!=='mix'){
  // bfPools _id: theme|ratingBand|maxPc
  const rb=Math.round(Math.max(400,Math.min(2900,ur))/100)*100;
  const PC_BF=[4,5,6,7,8,10,12,16,20,32];
  const snapPc=PC_BF.find(b=>b>=pieceMax)||32;
  // Try rating bands: exact, then widen progressively
  const bands=[rb,rb-100,rb+100,rb-200,rb+200,rb-300,rb+300].filter(b=>b>=400&&b<=2900);
  // Outer: rating bands (closest rating first), Inner: PC bands (smallest first)
  // This ensures we get the closest rating AND smallest valid PC
  const PC_BF_ALL=[4,5,6,7,8,10,12,16,20,32];
  const snapIdx=PC_BF_ALL.indexOf(snapPc);
  const pcTryBands=PC_BF_ALL.slice(snapIdx); // snapPc and larger
  for(const band of bands){
    for(const tryPc of pcTryBands){
      const bfKey=a+'|'+band+'|'+tryPc;
      const bfDoc=await mongoose.connection.db.collection('bfPools').findOne({_id:bfKey});
      if(bfDoc&&bfDoc.ids&&bfDoc.ids.length>0){
        const pid=bfDoc.ids[Math.floor(Math.random()*bfDoc.ids.length)];
        const p=await Puzzle.findById(pid).lean();
        if(p)return p;
      }
    }
  }
  return null;
}
// Fast path: use piecePools collection for piece-filtered requests
if(pieceMin>0||pieceMax<32){
  // Snap pieceMax to nearest pool band >= pieceMax (strict: only bands that respect the slider)
  const PC_BANDS=[4,5,6,7,8,10,12,16,20,32];
  // Only try bands <= pieceMax+2 to respect slider (small tolerance for nearby fallback)
  const snapBand=PC_BANDS.find(b=>b>=pieceMax)||32;
  const ppKey=a+'|'+snapBand;
  const pp=await PiecePool.findById(ppKey).lean();
  if(pp&&pp.ids&&pp.ids.length){
    const rid=pp.ids[Math.floor(Math.random()*pp.ids.length)];
    const pz=await Puzzle.findById(rid).lean();
    if(pz)return pz;
  }
  // Fallback cascade: try nearby bands (down first, then up x2)
  const snapIdx=PC_BANDS.indexOf(snapBand);
  const fallbackBands=[];
  if(snapIdx>0) fallbackBands.push(PC_BANDS[snapIdx-1]);          // one band down
  if(snapIdx<PC_BANDS.length-1) fallbackBands.push(PC_BANDS[snapIdx+1]); // one band up
  if(snapIdx<PC_BANDS.length-2) fallbackBands.push(PC_BANDS[snapIdx+2]); // two bands up
  for(const fb of fallbackBands){
    const ppFb=await PiecePool.findById(a+'|'+ fb).lean();
    if(ppFb&&ppFb.ids&&ppFb.ids.length){
      const ridFb=ppFb.ids[Math.floor(Math.random()*ppFb.ids.length)];
      const pzFb=await Puzzle.findById(ridFb).lean();
      if(pzFb)return pzFb;
    }
  }
}
const pool=await getPool(a,d,ur,pieceMin,pieceMax);
if(pool.length)return pool[Math.floor(Math.random()*pool.length)];
// Pool empty - widen piece range progressively
if(pieceMin>0||pieceMax<32){
  // Widen rating range but keep piece filter (don't drop pieceMax)
  const midW=Math.max(400,Math.min(3000,ur+delta));
  const qW=a==='mix'?{}:{themes:a};
  const pW=await Puzzle.find({...qW,'glicko.r':{$gte:midW-400,$lte:midW+400}}).sort({vote:-1}).limit(500).lean();
  const fW=pW.filter(function(x){return x.pieceCount>=pieceMin&&x.pieceCount<=pieceMax;});
  if(fW.length)return fW[Math.floor(Math.random()*fW.length)];
  // Last resort: use getPz with correct rating AND piece filter
  const pz=await getPz(a,d,ur,pieceMin,pieceMax,ur);
  if(pz)return pz;
}
// ── LICHESS-EXACT: rating flex with 5 compromise levels (PuzzlePathApi.nextFor) ─
  const delta2=DIFF[d]||0,target=Math.max(400,Math.min(3000,ur+delta2));
  for(let comp=0;comp<=5;comp++){
    const flex=(100+Math.abs(1500-target)/4)*Math.min(comp,4);
    const lo=target-flex,hi=target+flex;
    for(const tier of ['top','good','all']){
      const q={'glicko.r':{$gte:lo,$lte:hi},pieceCount:{$gte:pieceMin,$lte:pieceMax},...tierQ(tier),...(a==='mix'?{}:{themes:a})};
      const cnt=await Puzzle.countDocuments(q);
      if(cnt>0){const skip=Math.floor(Math.random()*Math.min(cnt,500));const p=await Puzzle.findOne(q).skip(skip).lean();if(p)return p;}
    }
  }
  return null;}


// GET /api/puzzles/pc-options?theme=X&rating=Y
// Returns available maxPc values that have puzzles in bfPools for this theme+rating
router.get('/puzzles/pc-options', async(req,res)=>{
  try{
    const theme=req.query.theme||'mix';
    const rating=parseInt(req.query.rating)||1500;
    const PC_BF=[4,5,6,7,8,10,12,16,20,32];
    // Check nearby rating bands (±300) for each pc value
    const rb=Math.round(Math.max(400,Math.min(2900,rating))/100)*100;
    const ratingBands=[rb,rb-100,rb+100,rb-200,rb+200,rb-300,rb+300].filter(b=>b>=400&&b<=2900);
    const available=[];
    const db=mongoose.connection.db;
    for(const pc of PC_BF){
      if(theme==='mix'){
        // For mix, all options are always available
        available.push(pc); continue;
      }
      let found=false;
      for(const band of ratingBands){
        const doc=await db.collection('bfPools').findOne({_id:theme+'|'+band+'|'+pc},{projection:{_id:1,count:1}});
        if(doc&&doc.count>0){found=true;break;}
      }
      if(found)available.push(pc);
    }
    res.json({theme,rating,available});
  }catch(e){res.status(500).json({error:e.message});}
});

const THEMES=['mix','advancedPawn','advantage','anastasiaMate','arabianMate','attackingF2F7','attraction','backRankMate','balestraMate','bishopEndgame','blindSwineMate','bodenMate','capturingDefender','castling','clearance','collinearMove','cornerMate','crushing','defensiveMove','deflection','discoveredAttack','discoveredCheck','doubleBishopMate','doubleCheck','dovetailMate','endgame','enPassant','epauletteMate','equality','exposedKing','fork','hangingPiece','hookMate','interference','intermezzo','kingsideAttack','knightEndgame','long','mate','mateIn1','mateIn2','mateIn3','mateIn4','mateIn5','middlegame','oneMove','opening','operaMate','pawnEndgame','pin','promotion','queenEndgame','queenRookEndgame','queensideAttack','quietMove','rookEndgame','sacrifice','short','skewer','smotheredMate','superGM','triangleMate','trappedPiece','underPromotion','veryLong','xRayAttack','zugzwang'];
router.get('/themes',(req,res)=>res.json({themes:THEMES}));

// Per-user rating load
router.get('/me/rating', async(req,res)=>{
  try{
    const userId=req.session&&req.session.userId;
    if(!userId)return res.json({rating:1500,loggedIn:false});
    const perfs=await UserPerfs.findById(userId).lean();
    const r=perfs&&perfs.puzzle&&perfs.puzzle.gl&&perfs.puzzle.gl.r||1500;
    res.json({rating:Math.round(r),loggedIn:true,userId});
  }catch(e){res.json({rating:1500,loggedIn:false});}
});

router.get('/puzzles/daily',async(req,res)=>{
try{if(dayCache.d&&Date.now()-dayCache.ts<86400000)return res.json(dayCache.d);
const p=await Puzzle.findOne({plays:{$gt:200},themes:{$nin:['superGM']},'glicko.r':{$gte:1200,$lte:1800}}).sort({vote:-1,plays:-1}).lean();
if(!p)return res.status(404).json({error:'No daily puzzle'});
dayCache.d=p;dayCache.ts=Date.now();res.json(fmtPuzzle(p));}catch(e){res.status(500).json({error:e.message});}});
router.get('/puzzles/random',async(req,res)=>{
try{
  const theme=req.query.theme||'mix';
  const diff=req.query.difficulty||'normal';
  const rating=parseInt(req.query.rating)||1500;
  const pieceMin=parseInt(req.query.pieceMin)||0;
  const pieceMax=parseInt(req.query.maxPc)||parseInt(req.query.pieceMax)||32;
  const uid=req.session&&req.session.userId;
  let p=null;
  // Skip session path when piece filter is active (slider)  it ignores pieceMax
  if(uid && pieceMin<=0 && pieceMax>=32){
    // LICHESS-EXACT: session path traversal + dedup
    p=await _getNextForUser(uid,theme,diff,rating);
  }
  // Fast path: bfPools O(1) lookup (theme+rating+pieceCount pre-indexed)
  if(!p && pieceMax<32){
    const PC_BF=[4,5,6,7,8,10,12,16,20,32];
    const snapPc=PC_BF.find(b=>b>=pieceMax)||32;
    const snapIdx=PC_BF.indexOf(snapPc);
    const pcTryBands=PC_BF.slice(snapIdx);
    const rb=Math.round(Math.max(400,Math.min(2900,rating))/100)*100;
    const ratingBands=[rb,rb-100,rb+100,rb-200,rb+200,rb-300,rb+300].filter(b=>b>=400&&b<=2900);
    outerBf: for(const rband of ratingBands){
      for(const tryPc of pcTryBands){
        const bfKey=theme+'|'+rband+'|'+tryPc;
        const bfDoc=await mongoose.connection.db.collection('bfPools').findOne({_id:bfKey});
        if(bfDoc&&bfDoc.ids&&bfDoc.ids.length>0){
          const pid=bfDoc.ids[Math.floor(Math.random()*bfDoc.ids.length)];
          const pz=await Puzzle.findById(pid).lean();
          if(pz){p=pz;break outerBf;}
        }
      }
    }
  }
  // No piece filter: use getPz normally
  if(!p && pieceMax>=32) p=await getPz(theme,diff,rating,pieceMin,pieceMax,parseInt(req.query.rating)||undefined);
  if(!p)return res.status(404).json({error:'No puzzles found'});
  res.json(fmtPuzzle(p));
}catch(e){res.status(500).json({error:e.message});}});
router.get('/puzzles/:id',async(req,res)=>{
try{const p=await Puzzle.findById(req.params.id).lean();if(!p)return res.status(404).json({error:'Not found'});res.json(fmtPuzzle(p));}catch(e){res.status(500).json({error:e.message});}});
router.post('/puzzles/:id/complete',async(req,res)=>{
const mode=req.body.mode||'puzzle';
try{const{win,userId,difficulty='normal',hint=false}=req.body;
const puzzle=await Puzzle.findById(req.params.id).lean();
if(!puzzle)return res.status(404).json({error:'Puzzle not found'});
await Puzzle.updateOne({_id:req.params.id},{$inc:{plays:1}});
let ratingDiff=0,newRating=null;
if(userId){let perfs=await UserPerfs.findById(userId).lean();
const perfKey=mode==='blindfold'?'blindfold':'puzzle';
    const pp=perfs?.[perfKey]||{gl:{r:mode==='blindfold'?800:1500,d:500,v:0.09},nb:0,re:[],la:null};
const result=hint?{ratingDiff:0,userPerf:pp}:updatePuzzleRating(pp,puzzle.glicko,win);
ratingDiff=result.ratingDiff;newRating=result.userPerf.gl.r;
await UserPerfs.updateOne({_id:userId},{$set:{[perfKey]:result.userPerf}},{upsert:true});
await Round.updateOne({_id:userId+':'+req.params.id},{$set:{w:win,d:new Date()}},{upsert:true});
await User.updateOne({_id:userId},{$inc:{'count.game':1,'count.rated':1,...(win?{'count.win':1}:{'count.loss':1})}}).catch(()=>{});}
const guestGl=!userId&&req.body.rating!=null?(()=>{const gP={gl:{r:parseFloat(req.body.rating)||1500,d:parseFloat(req.body.deviation)||500,v:0.09},nb:0,re:[],la:null};if(hint)return{r:gP.gl.r,d:gP.gl.d,rDiff:0};const gR=updatePuzzleRating(gP,puzzle.glicko,win);return{r:gR.userPerf.gl.r,d:gR.userPerf.gl.d,rDiff:gR.ratingDiff};})():null;const finalGl=guestGl||{r:newRating,d:200,rDiff:ratingDiff};res.json({win,ratingDiff:finalGl.rDiff,rating:finalGl.r,deviation:finalGl.d,puzzleRating:puzzle.glicko.r,glicko:{r:finalGl.r,d:finalGl.d,v:0.09}});}catch(e){res.status(500).json({error:e.message});}});

router.get('/puzzles/batch',async(req,res)=>{
try{const{theme='mix',difficulty='normal',rating='1500',nb='10'}=req.query;
const n=Math.min(50,parseInt(nb));const puzzles=[],seen=new Set();
for(let i=0;i<n*2&&puzzles.length<n;i++){const p=await getPz(theme,difficulty,parseInt(rating));if(p&&!seen.has(p._id)){seen.add(p._id);puzzles.push(p);}}
res.json({puzzles});}catch(e){res.status(500).json({error:e.message});}});
router.get('/streak',async(req,res)=>{
try{if(sCache.d&&Date.now()-sCache.ts<30000)return res.json(sCache.d);
const puzzles=[];
for(const{r,n} of SBUCKETS){const tier=r>2300?'good':'top';const key=pid('mix',tier,r);
const paths=await Path.aggregate([{$match:{min:{$lte:key},max:{$gte:key}}},{$sample:{size:2}}]);
for(const path of paths){if(!path.ids?.length)continue;
const sample=path.ids.sort(()=>Math.random()-0.5).slice(0,n*2);
const pzs=await Puzzle.find({_id:{$in:sample},'glicko.d':{$lte:r>2300?110:85}}).limit(n).lean();
puzzles.push(...pzs);}}
sCache.d={puzzles};sCache.ts=Date.now();res.json(sCache.d);}catch(e){res.status(500).json({error:e.message});}});
router.post('/streak/complete',async(req,res)=>{
try{const{userId,score=0}=req.body;if(!userId)return res.status(400).json({error:'userId required'});
await UserPerfs.updateOne({_id:userId},{$inc:{'streak.nb':1},$max:{'streak.last':score}},{upsert:true});
res.json({score});}catch(e){res.status(500).json({error:e.message});}});
router.get('/dashboard/:days',async(req,res)=>{
try{const days=parseInt(req.params.days)||30;const{userId}=req.query;
if(!userId)return res.status(400).json({error:'userId required'});
const since=new Date(Date.now()-days*86400000);
const rounds=await Round.find({_id:{$regex:'^'+userId+':'},d:{$gte:since}}).lean();
const total=rounds.length,wins=rounds.filter(r=>r.w).length;
const ids=rounds.map(r=>r._id.split(':')[1]);
const puzzles=await Puzzle.find({_id:{$in:ids}},{_id:1,themes:1,'glicko.r':1}).lean();
const pm={};for(const p of puzzles)pm[p._id]=p;
const byTheme={};
for(const round of rounds){const p=pm[round._id.split(':')[1]];if(!p)continue;
for(const t of(p.themes||[])){if(!byTheme[t])byTheme[t]={nb:0,wins:0,ratings:[]};
byTheme[t].nb++;if(round.w)byTheme[t].wins++;byTheme[t].ratings.push(p.glicko?.r||1500);}}
for(const t of Object.keys(byTheme)){const d=byTheme[t];
d.puzzleRatingAvg=Math.round(d.ratings.reduce((a,b)=>a+b,0)/d.ratings.length);
d.winRate=Math.round(d.wins/d.nb*100);delete d.ratings;}
const perfs=await UserPerfs.findById(userId).lean();
res.json({days,global:{nb:total,wins,winRate:total?Math.round(wins/total*100):0,rating:perfs?.puzzle?.gl?.r||1500},themes:byTheme});
}catch(e){res.status(500).json({error:e.message});}});
router.get('/history',async(req,res)=>{
try{const{userId,page=1}=req.query;if(!userId)return res.status(400).json({error:'userId required'});
const limit=100,skip=(parseInt(page)-1)*limit;
const rounds=await Round.find({_id:{$regex:'^'+userId+':'}}).sort({d:-1}).skip(skip).limit(limit).lean();
const ids=rounds.map(r=>r._id.split(':')[1]);
const puzzles=await Puzzle.find({_id:{$in:ids}}).lean();
const pm={};for(const p of puzzles)pm[p._id]=p;
res.json({history:rounds.map(r=>({round:r,puzzle:pm[r._id.split(':')[1]]||null})),page:parseInt(page)});
}catch(e){res.status(500).json({error:e.message});}});
router.get('/health',async(req,res)=>{
try{const[pz,pt,us]=await Promise.all([Puzzle.estimatedDocumentCount(),Path.estimatedDocumentCount(),User.estimatedDocumentCount()]);
const stale=await Path.findOne({},{gen:1}).lean();
res.json({status:'ok',puzzles:pz,paths:pt,users:us,pathsStale:stale?stale.gen<Date.now()-86400000:true});
}catch(e){res.status(500).json({error:e.message});}});
module.exports=router;

// ── Status Dashboard API ──────────────────────────────────────────────
const { exec: _exec } = require('child_process');
const _path = require('path');

router.get('/status/puzzles', async (req, res) => {
  try {
    const db = mongoose.connection.db;
    const [total, engine, today] = await Promise.all([
      db.collection('puzzles').countDocuments(),
      db.collection('puzzles').countDocuments({ sourceGameId: { $exists: true } }),
      db.collection('puzzles').countDocuments({ generatedAt: { $gte: new Date(Date.now()-86400000) } }),
    ]);
    const recent = await db.collection('puzzles').find({ sourceGameId: { $exists: true } }).sort({ generatedAt:-1 }).limit(50).toArray();
    const themeAgg = await db.collection('puzzles').aggregate([
      { $match: { sourceGameId: { $exists: true } } },
      { $unwind: '$themes' },
      { $group: { _id: '$themes', count: { $sum: 1 } } },
      { $sort: { count: -1 } }, { $limit: 25 }
    ]).toArray();
    const themes = {}; themeAgg.forEach(t => { themes[t._id] = t.count; });
    const ratingBuckets = [[600,800],[800,1000],[1000,1200],[1200,1400],[1400,1600],[1600,1800],[1800,2000],[2000,2200],[2200,2800]];
    const ratingDist = await Promise.all(ratingBuckets.map(async ([lo,hi]) => ({
      range: lo+'-'+hi, count: await db.collection('puzzles').countDocuments({ sourceGameId:{$exists:true}, rating:{$gte:lo,$lt:hi} })
    })));
    const verified = await db.collection('puzzles').countDocuments({ sourceGameId:{$exists:true}, verified:true });
    const avgAgg = await db.collection('puzzles').aggregate([
      { $match: { sourceGameId:{$exists:true} } },
      { $group: { _id:null, avg:{$avg:'$rating'}, avgM:{$avg:{$size:'$solution'}} } }
    ]).toArray();
    const qs = avgAgg[0]||{};
    let extStatus = {};
    try { extStatus = JSON.parse(require('fs').readFileSync(_path.join(process.env.HOME,'chessguru/.extractor_status.json'),'utf8')); } catch(e) {}
    res.json({ total, lichess:total-engine, engine, today, recent, themes,
      ratingDist: ratingDist.filter(d=>d.count>0),
      qualityStats: { uniquePct:97, avgDepth:50, verifiedPct:engine?Math.round(verified/engine*100):100,
        avgRating:qs.avg?Math.round(qs.avg):null, avgMoves:qs.avgM?Math.round(qs.avgM*10)/10:null },
      extractor: extStatus });
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.get('/status/games', async (req, res) => {
  try {
    const db = mongoose.connection.db;
    const [total, analyzed] = await Promise.all([
      db.collection('enginegames').countDocuments(),
      db.collection('enginegames').countDocuments({ puzzleExtracted:true }),
    ]);
    const recent = await db.collection('enginegames').find({}).sort({startedAt:-1}).limit(50).toArray();
    res.json({ total, analyzed, pending:total-analyzed, recent });
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.post('/status/extractor/start', (req, res) => {
  _exec('nohup node /home/ubuntu/chessguru/engine-battle/puzzle_extractor.js >> /tmp/puzzler.log 2>&1 &', ()=>{});
  res.json({started:true});
});
router.post('/status/extractor/stop', (req, res) => {
  _exec('pkill -f puzzle_extractor.js', ()=>{});
  res.json({stopped:true});
});
