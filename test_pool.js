const m=require('mongoose');
m.connect('mongodb://localhost/chessguru').then(async()=>{
  const PP=m.model('PP',new m.Schema({_id:String,ids:[String]},{versionKey:false,_id:false}),'piecePools');
  const Pz=m.model('Pz',new m.Schema({},{strict:false}),'puzzles');
  const p=await PP.findById('mateIn1|4');
  console.log('pool ids count:',p.ids.length);
  // test first 5 ids
  for(const id of p.ids.slice(0,5)){
    const pz=await Pz.findById(id).lean();
    console.log('id:',id,'found:',!!pz,'pc:',pz&&pz.pieceCount);
  }
  m.disconnect();
});
