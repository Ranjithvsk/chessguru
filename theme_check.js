const mongoose=require('mongoose');
const S=new mongoose.Schema({_id:String,glicko:{r:Number},pieceCount:Number,themes:[String]},{versionKey:false,_id:false});
mongoose.connect('mongodb://localhost/chessguru').then(async()=>{
  const P=mongoose.model('Puzzle',S,'puzzles');
  const themes=['mateIn1','endgame','fork','pin','skewer','crushing'];
  const ratings=[600,800,1000,1200,1500];
  const pcs=[4,6,8,12];
  console.log('theme | rating | maxPc | count');
  for(const t of themes){
    for(const r of ratings){
      for(const pc of pcs){
        const c=await P.countDocuments({themes:t,'glicko.r':{$gte:r-200,$lte:r+200},pieceCount:{$lte:pc}});
        if(c>0) console.log(t,'|',r,'|',pc,'|',c);
      }
    }
  }
  process.exit();
});
