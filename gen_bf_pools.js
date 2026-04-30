const mongoose=require('mongoose');
const PS=new mongoose.Schema({_id:String,glicko:{r:Number},pieceCount:Number,themes:[String]},{versionKey:false,_id:false});
const BPS=new mongoose.Schema({_id:String,theme:String,ratingBand:Number,maxPc:Number,ids:[String],count:Number,gen:Number},{versionKey:false,_id:false});
const THEMES=['mix','advancedPawn','advantage','anastasiaMate','arabianMate','attackingF2F7','attraction','backRankMate','balestraMate','bishopEndgame','blindSwineMate','bodenMate','capturingDefender','castling','clearance','collinearMove','cornerMate','crushing','defensiveMove','deflection','discoveredAttack','discoveredCheck','doubleBishopMate','doubleCheck','dovetailMate','endgame','enPassant','epauletteMate','equality','exposedKing','fork','hangingPiece','hookMate','interference','intermezzo','kingsideAttack','knightEndgame','long','mate','mateIn1','mateIn2','mateIn3','mateIn4','mateIn5','middlegame','oneMove','opening','operaMate','pawnEndgame','pin','promotion','queenEndgame','queenRookEndgame','queensideAttack','quietMove','rookEndgame','sacrifice','short','skewer','smotheredMate','superGM','triangleMate','trappedPiece','underPromotion','veryLong','xRayAttack','zugzwang'];
const RATING_BANDS=[400,600,800,1000,1200,1400,1600,1800,2000,2200];
const PC_BANDS=[4,5,6,7,8,10,12,16,20,32];
const POOL_SIZE=200,MIN_COUNT=50,RWIN=200;
const TOTAL_THEMES=THEMES.length, TOTAL_COMBOS=THEMES.length*RATING_BANDS.length*PC_BANDS.length;

function fmt(ms){if(ms<60000)return (ms/1000).toFixed(0)+'s';return (ms/60000).toFixed(1)+'min';}
function bar(done,total,w=20){const f=Math.round(done/total*w);return '['+('#').repeat(f)+('.').repeat(w-f)+']';}

mongoose.connect('mongodb://localhost/chessguru').then(async()=>{
  const P=mongoose.model('Puzzle',PS,'puzzles');
  const BP=mongoose.model('BfPool',BPS,'bfPools');
  let built=0,skipped=0,themesDone=0;
  const t0=Date.now();
  console.log('');
  console.log('  bfPools Builder  '+TOTAL_THEMES+' themes  '+RATING_BANDS.length+' rating bands  '+PC_BANDS.length+' pc bands');
  console.log('  Max pool docs: '+TOTAL_COMBOS+' | Skip if count < '+MIN_COUNT);
  console.log('\n');

  for(const theme of THEMES){
    const tThemeStart=Date.now();
    let themeBuilt=0,themeSkipped=0;
    process.stdout.write(' Theme '+('['+(themesDone+1)+'/'+TOTAL_THEMES+']').padEnd(8)+' '+theme.padEnd(22));

    for(const rb of RATING_BANDS){
      for(const pc of PC_BANDS){
        const q=theme==='mix'
          ?{pieceCount:{$lte:pc},'glicko.r':{$gte:rb-RWIN,$lte:rb+RWIN}}
          :{themes:theme,pieceCount:{$lte:pc},'glicko.r':{$gte:rb-RWIN,$lte:rb+RWIN}};
        const count=await P.countDocuments(q);
        if(count<MIN_COUNT){skipped++;themeSkipped++;continue;}
        const sz=Math.min(POOL_SIZE,count);
        const s=await P.aggregate([{$match:q},{$sample:{size:sz}},{$project:{_id:1}}]);
        await BP.collection.replaceOne(
          {_id:theme+'|'+rb+'|'+pc},
          {_id:theme+'|'+rb+'|'+pc,theme,ratingBand:rb,maxPc:pc,ids:s.map(x=>x._id),count,gen:Date.now()},
          {upsert:true}
        );
        built++;themeBuilt++;
      }
    }

    themesDone++;
    const elapsed=Date.now()-tThemeStart;
    const totalElapsed=Date.now()-t0;
    const pct=Math.round(themesDone/TOTAL_THEMES*100);
    const eta=themesDone<TOTAL_THEMES?fmt((totalElapsed/themesDone)*(TOTAL_THEMES-themesDone)):'done';
    console.log(' built='+themeBuilt+' skip='+themeSkipped+' ('+fmt(elapsed)+')  total: '+bar(themesDone,TOTAL_THEMES)+' '+pct+'%  ETA: '+eta);
    if(themesDone%10===0||themesDone===TOTAL_THEMES){
      console.log('   Milestone '+themesDone+'/'+TOTAL_THEMES+' themes | '+built+' pool docs built | '+skipped+' skipped | elapsed: '+fmt(totalElapsed)+' ');
    }
  }

  const totalTime=Date.now()-t0;
  console.log('\n');
  console.log('  DONE in '+fmt(totalTime)+' | '+built+' pool docs built | '+skipped+' skipped');
  console.log('');

  console.log('\nVerifying sample docs:');
  for(const id of['mix|800|8','mateIn1|800|8','endgame|1000|6','fork|800|8','skewer|800|4']){
    const doc=await BP.findById(id).lean();
    if(doc)console.log('   '+id+': '+doc.ids.length+' IDs (from '+doc.count+' total)');
    else console.log('   '+id+': NOT BUILT (skipped - too sparse)');
  }
  process.exit(0);
}).catch(e=>{console.error(e);process.exit(1);});
