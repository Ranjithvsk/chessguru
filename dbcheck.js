const mongoose=require('mongoose');
const PS=new mongoose.Schema({_id:String,glicko:{r:Number},pieceCount:Number},{versionKey:false,_id:false});
mongoose.connect('mongodb://localhost/chessguru').then(async()=>{
  const P=mongoose.model('Puzzle',PS,'puzzles');
  const c1=await P.countDocuments({'glicko.r':{$gte:600,$lte:1000},pieceCount:{$lte:8}});
  const c2=await P.countDocuments({'glicko.r':{$gte:600,$lte:1000}});
  const c3=await P.countDocuments({pieceCount:{$lte:8}});
  const c4=await P.countDocuments({'glicko.r':{$gte:400,$lte:1200},pieceCount:{$lte:8}});
  console.log('r600-1000 AND pc<=8:', c1);
  console.log('r600-1000 any pc:   ', c2);
  console.log('total pc<=8:        ', c3);
  console.log('r400-1200 AND pc<=8:', c4);
  process.exit();
});
