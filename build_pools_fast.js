const mongoose = require('mongoose');

const THEMES = ['advancedPawn','advantage','anastasiaMate','arabianMate','attackingF2F7','attraction','backRankMate','balestraMate','bishopEndgame','blindSwineMate','bodenMate','capturingDefender','castling','clearance','collinearMove','cornerMate','crushing','defensiveMove','deflection','discoveredAttack','discoveredCheck','doubleBishopMate','doubleCheck','dovetailMate','endgame','enPassant','epauletteMate','equality','exposedKing','fork','hangingPiece','hookMate','interference','intermezzo','kingsideAttack','knightEndgame','long','mate','mateIn1','mateIn2','mateIn3','mateIn4','mateIn5','middlegame','oneMove','opening','operaMate','pawnEndgame','pin','promotion','queenEndgame','queenRookEndgame','queensideAttack','quietMove','rookEndgame','sacrifice','short','skewer','smotheredMate','superGM','triangleMate','trappedPiece','underPromotion','veryLong','xRayAttack','zugzwang','mix'];
const PC_BANDS = [4,5,6,7,8,10,12,16,20,32];
const SAMPLE = 200;
const TOTAL = THEMES.length * PC_BANDS.length;

const Puzzle = mongoose.model('Puzzle', new mongoose.Schema({},{strict:false,collection:'puzzles'}));
const PiecePoolS = new mongoose.Schema({_id:String,theme:String,maxPc:Number,count:Number,ids:[String],gen:Number},{versionKey:false,_id:false});
const PiecePool = mongoose.models.PiecePool || mongoose.model('PiecePool',PiecePoolS,'piecePools');

async function fastSample(query, count) {
  const n = Math.min(SAMPLE, count);
  const skip = Math.floor(Math.random() * Math.max(1, count - n));
  const docs = await Puzzle.find(query, {_id:1}).skip(skip).limit(n).lean();
  return docs.map(d => d._id);
}

async function build() {
  await mongoose.connect('mongodb://localhost:27017/chessguru');
  const existing = new Set(await PiecePool.distinct('_id'));
  const total = THEMES.length * PC_BANDS.length;
  console.log(`START: ${existing.size} existing / ${total} total`);
  let built=0, skipped=0, noData=0;
  const t0 = Date.now();
  for (const theme of THEMES) {
    const tq = theme==='mix' ? {} : {themes:theme};
    for (const maxPc of PC_BANDS) {
      const key = theme+'|'+maxPc;
      if (existing.has(key)) { skipped++; continue; }
      const query = {...tq, pieceCount:{$lte:maxPc}};
      const count = await Puzzle.countDocuments(query);
      if (!count) { noData++; continue; }
      const ids = await fastSample(query, count);
      await PiecePool.create({_id:key,theme,maxPc,count,ids,gen:Date.now()});
      built++;
      const done = existing.size+built;
      const elapsed = ((Date.now()-t0)/1000).toFixed(0);
      const rate = built/((Date.now()-t0)/1000);
      const eta = Math.round((total-done)/rate);
      console.log(`[${done}/${total}] ${key} | ${count} puzzles | ${elapsed}s elapsed | ETA ${eta}s`);
    }
  }
  console.log(`\nDONE: built=${built} skipped=${skipped} noData=${noData} time=${((Date.now()-t0)/1000).toFixed(0)}s`);
  process.exit(0);
}
build().catch(e=>{console.error(e.message);process.exit(1);});
