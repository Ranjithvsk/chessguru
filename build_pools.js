const mongoose = require('mongoose');

const THEMES = ['advancedPawn','advantage','anastasiaMate','arabianMate','attackingF2F7','attraction','backRankMate','balestraMate','bishopEndgame','blindSwineMate','bodenMate','capturingDefender','castling','clearance','collinearMove','cornerMate','crushing','defensiveMove','deflection','discoveredAttack','discoveredCheck','doubleBishopMate','doubleCheck','dovetailMate','endgame','enPassant','epauletteMate','equality','exposedKing','fork','hangingPiece','hookMate','interference','intermezzo','kingsideAttack','knightEndgame','long','mate','mateIn1','mateIn2','mateIn3','mateIn4','mateIn5','middlegame','oneMove','opening','operaMate','pawnEndgame','pin','promotion','queenEndgame','queenRookEndgame','queensideAttack','quietMove','rookEndgame','sacrifice','short','skewer','smotheredMate','superGM','triangleMate','trappedPiece','underPromotion','veryLong','xRayAttack','zugzwang'];
const PC_BANDS = [4,5,6,7,8,10,12,16,20,32];
const SAMPLE = 200;

const Puzzle = mongoose.model('Puzzle', new mongoose.Schema({},{strict:false,collection:'puzzles'}));
const PiecePool = mongoose.model('PiecePool', new mongoose.Schema({_id:String,theme:String,maxPc:Number,count:Number,ids:[String],gen:Number},{collection:'piecePools'}));

async function build() {
  await mongoose.connect('mongodb://localhost:27017/chessguru');
  console.log('Connected');
  const existing = new Set(await PiecePool.distinct('_id'));
  console.log('Existing:', existing.size);
  let built=0;
  for (const theme of THEMES) {
    for (const maxPc of PC_BANDS) {
      const key = theme+'|'+maxPc;
      if (existing.has(key)) continue;
      const query = {themes:theme, pieceCount:{$lte:maxPc}};
      const count = await Puzzle.countDocuments(query);
      if (count===0) { console.log('SKIP(0)',key); continue; }
      const docs = await Puzzle.aggregate([{$match:query},{$sample:{size:SAMPLE}},{$project:{_id:1}}]);
      await PiecePool.create({_id:key,theme,maxPc,count,ids:docs.map(d=>d._id),gen:Date.now()});
      built++;
      console.log('BUILT',built,key,count);
    }
  }
  console.log('DONE',built);
  process.exit(0);
}
build().catch(e=>{console.error(e.message);process.exit(1);});
