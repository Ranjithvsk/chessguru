// Rebuild `paths` pools with rating VARIETY across each band.
// Old gen_paths2.js used find(...).limit(500) (index order = ascending rating)
// so every pool was the band's lowest-rated puzzles -> users always saw the
// band floor (e.g. exactly 1000). Here we sample a few puzzles at ~SUBS rating
// sub-points across each band via small indexed limit() queries (cheap, low
// memory). Builds into `paths_new`, then atomically renames over `paths`.
const mongoose = require('mongoose');
mongoose.connect('mongodb://localhost:27017/chessguru').then(()=>console.log('connected')).catch(e=>{console.error(e);process.exit(1)});
const PS = new mongoose.Schema({_id:String,themes:[String],'glicko.r':Number,vote:Number},{versionKey:false,_id:false,strict:false});
const Puzzle = mongoose.model('Puzzle', PS);
const PathSchema = new mongoose.Schema({_id:String,min:String,max:String,ids:[String],gen:Number},{versionKey:false,_id:false});
const Path = mongoose.model('Path', PathSchema, 'paths_new');
const THEMES=['mix','advancedPawn','advantage','anastasiaMate','arabianMate','attackingF2F7','attraction','backRankMate','balestraMate','bishopEndgame','blindSwineMate','bodenMate','capturingDefender','castling','clearance','collinearMove','cornerMate','crushing','defensiveMove','deflection','discoveredAttack','discoveredCheck','doubleBishopMate','doubleCheck','dovetailMate','endgame','enPassant','epauletteMate','equality','exposedKing','fork','hangingPiece','hookMate','interference','intermezzo','kingsideAttack','knightEndgame','long','mate','mateIn1','mateIn2','mateIn3','mateIn4','mateIn5','middlegame','oneMove','opening','operaMate','pawnEndgame','pin','promotion','queenEndgame','queenRookEndgame','queensideAttack','quietMove','rookEndgame','sacrifice','short','skewer','smotheredMate','superGM','triangleMate','trappedPiece','underPromotion','veryLong','xRayAttack','zugzwang'];
const TIERS=[{name:'top',minVote:70},{name:'good',minVote:40},{name:'all',minVote:-100}];
const BANDS=[[0,900],[900,1000],[1000,1100],[1100,1200],[1200,1270],[1270,1340],[1340,1410],[1410,1480],[1480,1550],[1550,1620],[1620,1690],[1690,1760],[1760,1830],[1830,1900],[1900,2000],[2000,2100],[2100,2200],[2200,2350],[2350,2500],[2500,2650],[2650,2800],[2800,9999]];
const TARGET=50, SUBS=10, PER=6;
function pid(a,t,r){return a+'|'+t+'|'+String(r).padStart(4,'0');}
async function run(){
  await mongoose.connection.dropCollection('paths_new').catch(()=>{});
  let total=0; const gen=Date.now();
  for(const theme of THEMES){
    process.stdout.write(theme+' ');
    const tf = theme==='mix' ? {} : {themes:theme};
    for(const tier of TIERS){
      const vf = tier.minVote>-100 ? {vote:{$gte:tier.minVote}} : {};
      for(const band of BANDS){
        const mn=band[0], mx=band[1];
        const step=(mx-mn)/SUBS; const seen=new Set(); const ids=[];
        for(let k=0;k<SUBS && ids.length<TARGET;k++){
          const lo=Math.floor(mn+k*step), hi=Math.floor(mn+(k+1)*step);
          if(hi<=lo) continue;
          const docs=await Puzzle.find({...tf,...vf,'glicko.r':{$gte:lo,$lt:hi}},{_id:1}).limit(PER).lean();
          for(const d of docs){ if(!seen.has(d._id)){ seen.add(d._id); ids.push(d._id); } }
        }
        if(ids.length<3) continue;
        await Path.collection.insertOne({_id:pid(theme,tier.name,mx),min:pid(theme,tier.name,mn),max:pid(theme,tier.name,mx-1),ids:ids.slice(0,TARGET),gen}).catch(()=>{});
        total++;
      }
    }
  }
  console.log('\nbuilt paths_new total='+total+'  swapping...');
  await mongoose.connection.collection('paths_new').createIndex({min:1,max:-1});
  await mongoose.connection.collection('paths_new').rename('paths',{dropTarget:true});
  console.log('swapped. done.');
  await mongoose.disconnect();
}
run().catch(e=>{console.error(e);process.exit(1)});
