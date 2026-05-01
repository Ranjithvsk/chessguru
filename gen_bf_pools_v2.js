// gen_bf_pools_v2.js — CORRECTED + RESUME + MIN_COUNT=1
// Fixes: uses themes, includes pools with even 1 puzzle, resumes after crash
// Run: node gen_bf_pools_v2.js

const mongoose = require('mongoose');

const PS  = new mongoose.Schema({},{strict:false,versionKey:false,_id:false});
const BPS = new mongoose.Schema({_id:String,theme:String,ratingBand:Number,maxPc:Number,ids:[String],count:Number,gen:Number},{versionKey:false,_id:false});

const THEMES = [
  'mix',
  'advancedPawn','advantage','anastasiaMate','arabianMate','attackingF2F7',
  'attraction','backRankMate','balestraMate','bishopEndgame','blindSwineMate',
  'bodenMate','capturingDefender','castling','clearance','collinearMove',
  'cornerMate','crushing','defensiveMove','deflection','discoveredAttack',
  'discoveredCheck','doubleBishopMate','doubleCheck','dovetailMate','endgame',
  'enPassant','epauletteMate','equality','exposedKing','fork','hangingPiece',
  'hookMate','interference','intermezzo','kingsideAttack','knightEndgame',
  'long','mate','mateIn1','mateIn2','mateIn3','mateIn4','mateIn5','middlegame',
  'oneMove','opening','operaMate','pawnEndgame','pin','promotion','queenEndgame',
  'queenRookEndgame','queensideAttack','quietMove','rookEndgame','sacrifice',
  'short','skewer','smotheredMate','superGM','triangleMate','trappedPiece',
  'underPromotion','veryLong','xRayAttack','zugzwang'
];

const RATING_BANDS = [];
for (let r = 400; r <= 2900; r += 100) RATING_BANDS.push(r);

const PC_BANDS  = [4,5,6,7,8,10,12,16,20,32];
const POOL_SIZE = 200;
const MIN_COUNT = 1;   // include even 1 puzzle — no combo is skipped
const RWIN      = 150;

const TT = THEMES.length, TB = RATING_BANDS.length, TP = PC_BANDS.length;
const MAX = TT * TB * TP;

let puzzlesSeen = 0, lastM = 0;

function fmt(ms){
  const s=Math.floor(ms/1000);
  if(s<60) return s+'s';
  const m=Math.floor(s/60),r=s%60;
  if(m<60) return m+'m'+r+'s';
  return Math.floor(m/60)+'h'+m%60+'m';
}
function bar(d,t){
  const f=Math.round(d/t*20);
  return '['+('#'.repeat(f))+('.'.repeat(20-f))+'] '+d+'/'+t+' ('+Math.round(d/t*100)+'%)';
}
function eta(el,d,t){
  if(!d) return '?';
  return fmt(el/d*(t-d));
}

// KEY FIX: themes for named themes, glicko.r dot notation for rating
function buildQuery(theme, rb, pc){
  const ratingQ = {'glicko.r': {$gte: rb-RWIN, $lte: rb+RWIN}};
  if(theme === 'mix'){
    return {pieceCount:{$lte:pc}, ...ratingQ};
  }
  return {themes: theme, pieceCount:{$lte:pc}, ...ratingQ};
}

async function main(){
  await mongoose.connect('mongodb://localhost/chessguru');
  const P  = mongoose.model('Puzzle', PS, 'puzzles');
  const BP = mongoose.model('BfPool', BPS, 'bfPools');

  // Schema check
  const sample = await P.findOne({themes:{$exists:true}}).lean();
  if(!sample){ console.error('ERROR: themes not found in puzzles!'); process.exit(1); }

  // Resume: load already built pool IDs
  const alreadyBuilt = new Set();
  const existing = await BP.find({},{_id:1}).lean();
  existing.forEach(d => alreadyBuilt.add(d._id));

  console.log('='.repeat(58));
  console.log('  bfPools Builder — CORRECTED (themes + MIN_COUNT=1)');
  console.log('='.repeat(58));
  console.log(`  Themes: ${TT} | Bands: ${TB} (400-2900) | PC bands: ${TP}`);
  console.log(`  Max docs: ${MAX} | MIN_COUNT: ${MIN_COUNT} (include ALL combos)`);
  console.log(`  Already built: ${alreadyBuilt.size} | Remaining: ~${MAX - alreadyBuilt.size}`);
  if(alreadyBuilt.size > 0){
    console.log(`  *** RESUMING — ${alreadyBuilt.size} pools already saved, skipping them ***`);
  }
  console.log('='.repeat(58));
  console.log('');

  const t0 = Date.now();
  let built=0, skipped=0, resumed=0, tDone=0;

  for(const theme of THEMES){
    tDone++;
    const tTS = Date.now();
    let tB=0, tS=0, tR=0;

    console.log('-'.repeat(58));
    console.log(`  THEME [${tDone}/${TT}] "${theme}"  ${bar(tDone-1,TT)}  ETA: ${eta(Date.now()-t0,tDone-1,TT)}`);
    console.log('-'.repeat(58));

    for(let bi=0;bi<RATING_BANDS.length;bi++){
      const rb = RATING_BANDS[bi];
      const tBS = Date.now();
      let bB=0, bS=0, bR=0;
      process.stdout.write(`  Band rb=${rb} [${bi+1}/${TB}] ...\n`);

      for(let pi=0;pi<PC_BANDS.length;pi++){
        const pc = PC_BANDS[pi];
        const id = `${theme}|${rb}|${pc}`;

        // RESUME: skip if already built in a previous run
        if(alreadyBuilt.has(id)){
          bR++; tR++; resumed++;
          continue;
        }

        const q = buildQuery(theme, rb, pc);
        const count = await P.countDocuments(q);

        puzzlesSeen += count;
        const nm = Math.floor(puzzlesSeen/50000);
        if(nm > lastM){
          lastM = nm;
          console.log(`  *** 50k: ${(nm*50000).toLocaleString()} puzzles scanned (${theme} rb=${rb} pc<=${pc})`);
        }

        // Skip only if truly zero puzzles exist
        if(count < MIN_COUNT){
          bS++; tS++; skipped++;
          process.stdout.write(`    pc<=${pc}: 0 puzzles -> SKIP (none exist)\n`);
          continue;
        }

        const sz = Math.min(POOL_SIZE, count);
        const s  = await P.aggregate([{$match:q},{$sample:{size:sz}},{$project:{_id:1}}]);

        await BP.collection.replaceOne(
          {_id:id},
          {_id:id, theme, ratingBand:rb, maxPc:pc, ids:s.map(x=>x._id), count, gen:Date.now()},
          {upsert:true}
        );
        alreadyBuilt.add(id);

        bB++; tB++; built++;
        process.stdout.write(`    pc<=${String(pc).padStart(2)}: ${String(count).padStart(7)} puzzles -> BUILT | total=${built} | ${fmt(Date.now()-t0)}\n`);
      }

      const bEl=Date.now()-tBS, oEl=Date.now()-t0;
      const done = built+skipped+resumed;
      console.log(`  >> Band rb=${rb} DONE | built=${bB} skip=${bS} resumed=${bR} | band_time=${fmt(bEl)} | elapsed=${fmt(oEl)} | ETA=${eta(oEl,done,MAX)}`);
    }

    const tEl=Date.now()-tTS, oEl=Date.now()-t0;
    console.log('');
    console.log(`  THEME DONE: "${theme}" [${tDone}/${TT}] built=${tB} skip=${tS} resumed=${tR} time=${fmt(tEl)}`);
    console.log(`  TOTAL built=${built} skip=${skipped} resumed=${resumed} elapsed=${fmt(oEl)}`);
    console.log(`  ${bar(tDone,TT)}  ETA: ${eta(oEl,tDone,TT)}`);
    console.log('');

    if(tDone%10===0||tDone===TT){
      console.log('='.repeat(58));
      console.log(`  MILESTONE: ${tDone} themes (${Math.round(tDone/TT*100)}%) | ${built} built | ${fmt(oEl)}`);
      console.log('='.repeat(58));
    }
  }

  const tot = Date.now()-t0;
  console.log('');
  console.log('='.repeat(58));
  console.log('  ALL DONE!');
  console.log(`  Time: ${fmt(tot)} | Built: ${built} | Zero-skipped: ${skipped} | Resumed: ${resumed}`);
  console.log(`  Total pool docs: ${alreadyBuilt.size}`);
  console.log('='.repeat(58));
  console.log('');
  console.log('Next — dump bfPools and upload to GCP:');
  console.log('  mongodump --db chessguru --collection bfPools --gzip --archive=C:\\Users\\Ranji\\pools\\bfpools.archive');
  console.log('  scp -i C:\\Users\\Ranji\\.ssh\\id_ed25519 C:\\Users\\Ranji\\pools\\bfpools.archive ranjith_vsk@34.143.245.57:/tmp/');
  process.exit(0);
}

main().catch(e=>{ console.error('ERROR:',e.message); process.exit(1); });
