const DEFAULT_RATING=1500,DEFAULT_DEVIATION=500,DEFAULT_VOLATILITY=0.09,TAU=0.75,RATING_PERIODS_PER_DAY=0.21436,MAX_DEVIATION=500,MIN_DEVIATION=45,MAX_RATING_DELTA=700,RATING_FLOOR=400,CONVERGENCE_TOL=1e-6,SCALE=173.7178;
function toG2(r,d){return{mu:(r-DEFAULT_RATING)/SCALE,phi:d/SCALE};}
function fromG2(mu,phi){return{r:mu*SCALE+DEFAULT_RATING,d:phi*SCALE};}
function g(phi){return 1/Math.sqrt(1+(3*phi*phi)/(Math.PI*Math.PI));}
function E(mu,muJ,phiJ){return 1/(1+Math.exp(-g(phiJ)*(mu-muJ)));}
function computeGame(player,opponent,score){
const{mu,phi}=toG2(player.r,player.d);
const{mu:muJ,phi:phiJ}=toG2(opponent.r,opponent.d);
const sigma=player.v,gPhi=g(phiJ),eVal=E(mu,muJ,phiJ);
const v=1/(gPhi*gPhi*eVal*(1-eVal));
const delta=v*gPhi*(score-eVal);
const a=Math.log(sigma*sigma);
const f=(x)=>{const eX=Math.exp(x),d2=phi*phi+v+eX;return(eX*(delta*delta-d2))/(2*d2*d2)-(x-a)/(TAU*TAU);};
let A=a,B=delta*delta>phi*phi+v?Math.log(delta*delta-phi*phi-v):(()=>{let k=1;while(f(a-k*TAU)<0)k++;return a-k*TAU;})();
let fA=f(A),fB=f(B);
while(Math.abs(B-A)>CONVERGENCE_TOL){const C=A+((A-B)*fA)/(fB-fA),fC=f(C);if(fC*fB<0){A=B;fA=fB;}else{fA/=2;}B=C;fB=fC;}
const sigmaPrime=Math.exp(A/2),phiStar=Math.sqrt(phi*phi+sigmaPrime*sigmaPrime);
const phiPrime=1/Math.sqrt(1/(phiStar*phiStar)+1/v);
const muPrime=mu+phiPrime*phiPrime*gPhi*(score-eVal);
const res=fromG2(muPrime,phiPrime);
return{r:Math.max(RATING_FLOOR,Math.round(res.r)),d:Math.min(MAX_DEVIATION,Math.max(MIN_DEVIATION,Math.round(res.d))),v:sigmaPrime};
}
function liveDeviation(perf,reverse=false){
const la=perf.la?new Date(perf.la):null;
if(!la)return perf.gl.d;
const days=(Date.now()-la.getTime())/(86400000),periods=days*RATING_PERIODS_PER_DAY,d=perf.gl.d,v=perf.gl.v||DEFAULT_VOLATILITY;
if(reverse)return Math.sqrt(Math.max(0,d*d-periods*v*v));
return Math.min(MAX_DEVIATION,Math.sqrt(d*d+periods*v*v));
}
function sanityCheck(g){return g.r>0&&g.r<4000&&g.d>0&&g.d<2000&&g.v>0&&g.v<2;}
function updatePuzzleRating(userPerf,puzzleGlicko,win){
const uG={r:userPerf.gl.r,d:liveDeviation(userPerf),v:userPerf.gl.v||DEFAULT_VOLATILITY};
const score=win?1:0;
let nU=computeGame(uG,puzzleGlicko,score);
const nP=computeGame(puzzleGlicko,uG,1-score);
nU.r=Math.max(uG.r-MAX_RATING_DELTA,Math.min(uG.r+MAX_RATING_DELTA,nU.r));
if(!sanityCheck(nU))nU.r=uG.r;
const recent=[nU.r,...(userPerf.re||[])].slice(0,12);
return{userPerf:{gl:{r:nU.r,d:liveDeviation({gl:nU,la:new Date()},true),v:nU.v},nb:(userPerf.nb||0)+1,re:recent,la:new Date()},puzzleGlicko:nP,ratingDiff:nU.r-uG.r};
}
module.exports={computeGame,liveDeviation,sanityCheck,updatePuzzleRating,DEFAULT_RATING,DEFAULT_DEVIATION,DEFAULT_VOLATILITY};