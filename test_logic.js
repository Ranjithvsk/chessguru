const mongoose = require('mongoose');
const PS = new mongoose.Schema(
  {_id:String, glicko:{r:Number}, pieceCount:Number, themes:[String]},
  {versionKey:false, _id:false}
);

mongoose.connect('mongodb://localhost/chessguru').then(async () => {
  const P = mongoose.model('Puzzle', PS, 'puzzles');

  const ratings   = [600, 800, 1000, 1200, 1500];
  const pcBands   = [4, 6, 8, 10, 32];
  const themes    = ['mix', 'mateIn1', 'endgame', 'fork'];

  console.log('\n=== DB DISTRIBUTION: pieceCount<=X AND rating in [R-200, R+200] ===');
  console.log('theme       | rating | maxPc | count_in_band | nearest_pc_band_with_puzzles');
  console.log('------------|--------|-------|---------------|-----------------------------');

  for (const theme of themes) {
    for (const rating of ratings) {
      for (const maxPc of pcBands) {
        const q = theme === 'mix' ? {} : {themes: theme};
        const count = await P.countDocuments({
          ...q,
          'glicko.r': {$gte: rating-200, $lte: rating+200},
          pieceCount: {$lte: maxPc}
        });

        // Also find nearest rating band that HAS puzzles with pieceCount<=maxPc
        let nearest = 'N/A';
        if (count === 0 && maxPc <= 10) {
          for (const step of [400, 600, 800, 1200]) {
            const c2 = await P.countDocuments({
              ...q,
              'glicko.r': {$gte: rating-step, $lte: rating+step},
              pieceCount: {$lte: maxPc}
            });
            if (c2 > 0) {
              nearest = 'r+-' + step + ':' + c2;
              break;
            }
          }
        }

        if (count > 0 || nearest !== 'N/A') {
          const t = theme.padEnd(11);
          console.log(`${t} | ${rating}  | ${String(maxPc).padEnd(5)} | ${String(count).padEnd(13)} | ${nearest}`);
        }
      }
    }
  }

  // Summary: what is the min-rating puzzle for each piece count band?
  console.log('\n=== MIN RATING PUZZLE FOR EACH PIECE BAND (all themes) ===');
  for (const maxPc of [4,5,6,7,8,10,12]) {
    const p = await P.findOne({pieceCount: {$lte: maxPc}}).sort({'glicko.r': 1}).lean();
    if (p) console.log(`pieceCount<=${maxPc}: lowest rating = ${Math.round(p.glicko.r)}`);
  }

  // What is the rating distribution of pieceCount<=8 puzzles?
  console.log('\n=== RATING DISTRIBUTION of pieceCount<=8 puzzles ===');
  const ranges = [[400,800],[800,1000],[1000,1200],[1200,1400],[1400,1600],[1600,1800],[1800,2000],[2000,2200],[2200,2600]];
  for (const [lo, hi] of ranges) {
    const c = await P.countDocuments({'glicko.r':{$gte:lo,$lte:hi}, pieceCount:{$lte:8}});
    console.log(`  r[${lo}-${hi}]: ${c} puzzles`);
  }

  process.exit(0);
});
