const mongoose = require('mongoose');

mongoose.connect('mongodb://127.0.0.1:27017/chessguru');

const Puzzle = mongoose.model('Puzzle', new mongoose.Schema({
  _id: String, themes: [String], pieceCount: Number, 'glicko.r': Number
}, {strict: false}));

const PiecePool = mongoose.model('PiecePool', new mongoose.Schema({
  _id: String,       // "mateIn1|8"
  theme: String,     // "mateIn1"
  maxPc: Number,     // 8
  count: Number,     // total matching in DB
  ids: [String],     // 200 sampled puzzle IDs
  gen: Number        // timestamp
}), 'piecePools');

const THEMES = ['mix','advancedPawn','advantage','anastasiaMate','arabianMate',
  'attackingF2F7','attraction','backRankMate','balestraMate','bishopEndgame',
  'blindSwineMate','bodenMate','capturingDefender','castling','clearance',
  'collinearMove','cornerMate','crushing','defensiveMove','deflection',
  'discoveredAttack','discoveredCheck','doubleBishopMate','doubleCheck',
  'dovetailMate','endgame','enPassant','epauletteMate','equality','exposedKing',
  'fork','hangingPiece','hookMate','interference','intermezzo','kingsideAttack',
  'knightEndgame','long','mate','mateIn1','mateIn2','mateIn3','mateIn4','mateIn5',
  'middlegame','oneMove','opening','operaMate','pawnEndgame','pin','promotion',
  'queenEndgame','queenRookEndgame','queensideAttack','quietMove','rookEndgame',
  'sacrifice','short','skewer','smotheredMate','superGM','triangleMate',
  'trappedPiece','underPromotion','veryLong','xRayAttack','zugzwang'];

// Piece count bands — the max of each band
const PC_BANDS = [4, 5, 6, 7, 8, 10, 12, 16, 20, 32];
const SAMPLE = 200;

async function build() {
  await PiecePool.deleteMany({});
  console.log('piecePools cleared');

  let total = 0, skipped = 0;

  for (const theme of THEMES) {
    const themeQuery = theme === 'mix' ? {} : { themes: theme };

    for (const maxPc of PC_BANDS) {
      const query = { ...themeQuery, pieceCount: { $lte: maxPc } };

      // Count total matching
      const count = await Puzzle.countDocuments(query);

      if (count === 0) {
        skipped++;
        continue;
      }

      // Sample up to SAMPLE IDs using $sample aggregation
      const pipeline = [
        { $match: query },
        { $sample: { size: SAMPLE } },
        { $project: { _id: 1 } }
      ];
      const docs = await Puzzle.aggregate(pipeline);
      const ids = docs.map(d => d._id);

      const key = `${theme}|${maxPc}`;
      await PiecePool.create({ _id: key, theme, maxPc, count, ids, gen: Date.now() });

      total++;
      if (total % 50 === 0) console.log(`  built ${total} pools so far...`);
    }
    console.log(`done: ${theme}`);
  }

  console.log(`\nFinished: ${total} pools built, ${skipped} skipped (no puzzles)`);
  process.exit(0);
}

build().catch(e => { console.error(e); process.exit(1); });
