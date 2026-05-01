const mongoose=require('mongoose');
const PS=new mongoose.Schema({_id:String,'glicko.r':Number,pieceCount:Number,themes:[String]},{strict:false,versionKey:false,_id:false});
const BPS=new mongoose.Schema({_id:String,theme:String,ratingBand:Number,maxPc:Number,ids:[String],count:Number,gen:Number},{versionKey:false,_id:false});
const THEMES=['mix','advancedPawn','advantage','anastasiaMate','arabianMate','attackingF2F7','attraction','backRankMate','balestraMate','bishopEndgame','blindSwineMate','bodenMate','capturingDefender','castling','clearance','collinearMove','cornerMate','crushing','defensiveMove','deflection','discoveredAttack','discoveredCheck','doubleBishopMate','doubleCheck','dovetailMate','endgame','enPassant','epauletteMate','equality','exposedKing','fork','hangingPiece','hookMate','interference','intermezzo','kingsideAttack','knightEndgame','long','mate','mateIn1','mateIn2','mateIn3','mateIn4','mateIn5','middlegame','oneMove','opening','operaMate','pawnEndgame','pin','promotion','queenEndgame','queenRookEndgame','queensideAttack','quietMove','rookEndgame','sacrifice','short','skewer','smotheredMate','superGM','triangleMate','trappedPiece','underPromotion','veryLong','xRayAttack','zugzwang'];
const RATING_BANDS=[];for(let r=400;r<=2900;r+=100)RATING_BANDS.push(r);
const PC_BANDS=[4,5,6,7,8,10,12,16,20,32];
const POOL_SIZE=200,MIN_COUNT=50,RWIN=150;
const TT=THEMES.length,TB=RATING_BANDS.length,TP=PC_BANDS.length,MAX=TT*TB*TP;
let puzzlesSeen=0,lastM=0;
function fmt(ms){const s=Math.floor(ms/1000);if(s<60)return s+'s';const m=Math.floor(s/60),r=s%60;if(m<60)return m+'m'+r+'s';return Math.floor(m/60)+'h'+m%60+'m';}
function bar(d,t){const f=Math.round(d/t*20);return'['.padEnd(1)+'#'.repeat(f)+'.'.repeat(20-f)+'] '+d+'/'+t+' ('+Math.round(d/t*100)+'%)';}
function eta(el,d,t){if(!d)return'?';return fmt(el/d*(t-d));}
function line(c=45){return c.repeat(45);}
mongoose.connect('mongodb://localhost/chessguru').then(async()=>{
  const P=mongoose.model('Puzzle',PS,'puzzles');
  const BP=mongoose.model('BfPool',BPS,'bfPools');
  const t0=Date.now();
  let built=0,skipped=0,tDone=0;
  console.log(line('='));
  console.log('bfPools Builder v2 | '+TT+' themes | '+TB+' rating bands (400-2900) | '+TP+' pc bands');
  console.log('Max docs: '+MAX+' | Skip if count < '+MIN_COUNT+' | Rating window: +-'+RWIN);
  console.log(line('='));
  for(const theme of THEMES){
    tDone++;
    const tTS=Date.now();
    let tB=0,tS=0;
    console.log('');
    console.log(line('-'));
    console.log('THEME ['+tDone+'/'+TT+'] "'+theme+'"  overall: '+bar(tDone-1,TT)+'  ETA: '+eta(Date.now()-t0,tDone-1,TT));
    console.log(line('-'));
    for(let bi=0;bi<RATING_BANDS.length;bi++){
      const rb=RATING_BANDS[bi];
      const tBS=Date.now();
      let bB=0,bS=0;
      console.log('  Band rb='+rb+' ['+( bi+1)+'/'+TB+'] ...');
      for(let pi=0;pi<PC_BANDS.length;pi++){
        const pc=PC_BANDS[pi];
        const q=theme==='mix'?{pieceCount:{$lte:pc},'glicko.r':{$gte:rb-RWIN,$lte:rb+RWIN}}:{themes:theme,pieceCount:{$lte:pc},'glicko.r':{$gte:rb-RWIN,$lte:rb+RWIN}};
        const count=await P.countDocuments(q);
        puzzlesSeen+=count;
        const nm=Math.floor(puzzlesSeen/50000);
        if(nm>lastM){lastM=nm;console.log('  *** 50k MILESTONE: '+nm*50000+' puzzles scanned (theme='+theme+' rb='+rb+' pc<='+pc+')');}
        if(count<MIN_COUNT){bS++;tS++;skipped++;if(count>0)console.log('    pc<='+pc+': '+count+' -> SKIP');continue;}
        const sz=Math.min(POOL_SIZE,count);
        const s=await P.aggregate([{$match:q},{$sample:{size:sz}},{$project:{_id:1}}]);
        await BP.collection.replaceOne({_id:theme+'|'+rb+'|'+pc},{_id:theme+'|'+rb+'|'+pc,theme,ratingBand:rb,maxPc:pc,ids:s.map(x=>x._id),count,gen:Date.now()},{upsert:true});
        bB++;tB++;built++;
        console.log('    pc<='+String(pc).padStart(2)+': '+String(count).padStart(7)+' puzzles -> BUILT | total built='+built+' skip='+skipped+' | '+fmt(Date.now()-t0));
      }
      const bEl=Date.now()-tBS,oEl=Date.now()-t0;
      console.log('  >> Band rb='+rb+' DONE | built='+bB+' skip='+bS+' | band_time='+fmt(bEl)+' | elapsed='+fmt(oEl)+' | ETA='+eta(oEl,built+skipped,MAX));
    }
    const tEl=Date.now()-tTS,oEl=Date.now()-t0;
    console.log('');
    console.log(' THEME DONE: "'+theme+'" ['+tDone+'/'+TT+'] built='+tB+' skip='+tS+' theme_time='+fmt(tEl));
    console.log('   TOTAL: built='+built+' skip='+skipped+' elapsed='+fmt(oEl));
    console.log('   '+bar(tDone,TT)+'  ETA: '+eta(oEl,tDone,TT));
    if(tDone%10===0||tDone===TT){
      console.log('');
      console.log(line('='));
      console.log(' MILESTONE: '+tDone+' themes ('+Math.round(tDone/TT*100)+'%) | '+built+' pools built | '+fmt(oEl)+' elapsed');
      console.log(line('='));
    }
  }
  const tot=Date.now()-t0;
  console.log('');
  console.log(line('='));
  console.log('ALL DONE | time='+fmt(tot)+' | built='+built+' | skipped='+skipped);
  console.log(line('='));
  console.log('Verifying:');
  for(const id of['mix|800|8','mateIn1|800|8','endgame|1000|6','fork|800|8','skewer|800|4','pin|1200|12']){
    const d=await BP.findById(id).lean();
    console.log(' '+(d?'OK':'MISS')+' '+id+(d?' ('+d.ids.length+' ids from '+d.count+')':''));
  }
  process.exit(0);
}).catch(e=>{console.error(e);process.exit(1);});
