const mongoose = require('mongoose');
const THEMES = ['advancedPawn','advantage','anastasiaMate','arabianMate','attackingF2F7','attraction','backRankMate','balestraMate','bishopEndgame','blindSwineMate','bodenMate','capturingDefender','castling','clearance','collinearMove','cornerMate','crushing','defensiveMove','deflection','discoveredAttack','discoveredCheck','doubleBishopMate','doubleCheck','dovetailMate','endgame','enPassant','epauletteMate','equality','exposedKing','fork','hangingPiece','hookMate','interference','intermezzo','kingsideAttack','knightEndgame','long','mate','mateIn1','mateIn2','mateIn3','mateIn4','mateIn5','middlegame','oneMove','opening','operaMate','pawnEndgame','pin','promotion','queenEndgame','queenRookEndgame','queensideAttack','quietMove','rookEndgame','sacrifice','short','skewer','smotheredMate','superGM','triangleMate','trappedPiece','underPromotion','veryLong','xRayAttack','zugzwang','mix'];
const PC_BANDS=[4,5,6,7,8,10,12,16,20,32];
const SAMPLE=200;
const Puzzle=mongoose.model('Puzzle',new mongoose.Schema({},{strict:false,collection:'puzzles'}));
const PiecePool=mongoose.model('PiecePool',new mongoose.Schema({_id:String,theme:String,maxPc:Number,count:Number,ids:[String],gen:Number},{collection:'piecePools'}));
async function fastSample(query,count,n){
  n=Math.min(n,count);
  const offs=new Set();
  while(offs.size<n) offs.add(Math.floor(Math.random()*count));
  const ids=[];
  for(const o of offs){const d=await Puzzle.findOne(query,{_id:1}).skip(o).lean();if(d)ids.push(d._id);}
  return ids;
}
async function build(){
  await mongoose.connect('mongodb://localhost:27017/chessguru');
  console.log('Connected');
  const existing=new Set(await PiecePool.distinct('_id'));
  console.log('Existing:',existing.size);
  let built=0;
  for(const theme of THEMES){
    const tq=theme==='mix'?{}:{themes:theme};
    for(const maxPc of PC_BANDS){
      const key=theme+'|'+maxPc;
      if(existing.has(key)) continue;
      const q={...tq,pieceCount:{$lte:maxPc}};
      const count=await Puzzle.countDocuments(q);
      if(count===0){console.log('SKIP(0)',key);continue;}
      const ids=await fastSample(q,count,SAMPLE);
      await PiecePool.create({_id:key,theme,maxPc,count,ids,gen:Date.now()});
      built++;
      console.log('BUILT',existing.size+built,key,count);
    }
    console.log('theme done:',theme);
  }
  console.log('DONE built:',built);
  process.exit(0);
}
build().catch(e=>{console.error(e.message);process.exit(1);});
