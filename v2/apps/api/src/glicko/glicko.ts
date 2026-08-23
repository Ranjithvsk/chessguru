// Lichess-exact Glicko-2, ported from the original glicko2.js. Constants frozen.
// DEFAULT_RATING = 1500 is the Glicko-2 math anchor (formula normalizes
// around it — DO NOT change). NEW_USER_RATING is a separate concept:
// what a brand-new account is seeded at before their first puzzle. Owner
// directive 2026-08-23: was 1500 (Lichess default), now 800 — better
// starting point for academy kids (the primary audience). Strong players
// climb rapidly via Glicko convergence (high d=500 → big early swings).
export const DEFAULT_RATING = 1500, DEFAULT_DEVIATION = 500, DEFAULT_VOLATILITY = 0.09;
export const NEW_USER_RATING = 800;
const TAU = 0.75, RATING_PERIODS_PER_DAY = 0.21436, MAX_DEVIATION = 500, MIN_DEVIATION = 45;
const MAX_RATING_DELTA = 700, RATING_FLOOR = 400, CONVERGENCE_TOL = 1e-6, SCALE = 173.7178;

export interface Glicko { r: number; d: number; v: number }
export interface Perf { gl: Glicko; nb?: number; re?: number[]; la?: Date | string | null }

const toG2 = (r: number, d: number) => ({ mu: (r - DEFAULT_RATING) / SCALE, phi: d / SCALE });
const fromG2 = (mu: number, phi: number) => ({ r: mu * SCALE + DEFAULT_RATING, d: phi * SCALE });
const g = (phi: number) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
const E = (mu: number, muJ: number, phiJ: number) => 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));

export function computeGame(player: Glicko, opponent: Glicko, score: number): Glicko {
  const { mu, phi } = toG2(player.r, player.d);
  const { mu: muJ, phi: phiJ } = toG2(opponent.r, opponent.d);
  const sigma = player.v, gPhi = g(phiJ), eVal = E(mu, muJ, phiJ);
  const v = 1 / (gPhi * gPhi * eVal * (1 - eVal));
  const delta = v * gPhi * (score - eVal);
  const a = Math.log(sigma * sigma);
  const f = (x: number) => { const eX = Math.exp(x), d2 = phi * phi + v + eX; return (eX * (delta * delta - d2)) / (2 * d2 * d2) - (x - a) / (TAU * TAU); };
  let A = a;
  let B = delta * delta > phi * phi + v
    ? Math.log(delta * delta - phi * phi - v)
    : (() => { let k = 1; while (f(a - k * TAU) < 0) k++; return a - k * TAU; })();
  let fA = f(A), fB = f(B);
  while (Math.abs(B - A) > CONVERGENCE_TOL) {
    const C = A + ((A - B) * fA) / (fB - fA), fC = f(C);
    if (fC * fB < 0) { A = B; fA = fB; } else { fA /= 2; }
    B = C; fB = fC;
  }
  const sigmaPrime = Math.exp(A / 2), phiStar = Math.sqrt(phi * phi + sigmaPrime * sigmaPrime);
  const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muPrime = mu + phiPrime * phiPrime * gPhi * (score - eVal);
  const res = fromG2(muPrime, phiPrime);
  return {
    r: Math.max(RATING_FLOOR, Math.round(res.r)),
    d: Math.min(MAX_DEVIATION, Math.max(MIN_DEVIATION, Math.round(res.d))),
    v: sigmaPrime,
  };
}

export function liveDeviation(perf: Perf, reverse = false): number {
  const la = perf.la ? new Date(perf.la) : null;
  if (!la) return perf.gl.d;
  const days = (Date.now() - la.getTime()) / 86400000;
  const periods = days * RATING_PERIODS_PER_DAY, d = perf.gl.d, v = perf.gl.v || DEFAULT_VOLATILITY;
  if (reverse) return Math.sqrt(Math.max(0, d * d - periods * v * v));
  return Math.min(MAX_DEVIATION, Math.sqrt(d * d + periods * v * v));
}

const sanity = (x: Glicko) => x.r > 0 && x.r < 4000 && x.d > 0 && x.d < 2000 && x.v > 0 && x.v < 2;

export function updatePuzzleRating(userPerf: Perf, puzzleGlicko: Glicko, win: boolean, solvePatternType?: "legitimate" | "borderline" | "grinder") {
  const uG: Glicko = { r: userPerf.gl.r, d: liveDeviation(userPerf), v: userPerf.gl.v || DEFAULT_VOLATILITY };
  const score = win ? 1 : 0;
  const nU = computeGame(uG, puzzleGlicko, score);
  const nP = computeGame(puzzleGlicko, uG, 1 - score);
  nU.r = Math.max(uG.r - MAX_RATING_DELTA, Math.min(uG.r + MAX_RATING_DELTA, nU.r));
  // Cap upward drift from grinding easy puzzles (gap > 250 pts).
  //   - legitimate / borderline / unknown: +1 max (tiny reward, no inflation)
  //   - grinder (per solvePattern classifier):  0    (rating truly stuck until
  //                                                    they face at-level)
  // LOSSES take their full Glicko-2 delta which is already 5-10× larger than
  // an equivalent win by formula — that natural asymmetry is enough to
  // correct rating in ~8-12 easy losses.
  const gap = uG.r - puzzleGlicko.r;
  if (win && gap > 250 && nU.r > uG.r) {
    const cap = solvePatternType === "grinder" ? 0 : 1;
    nU.r = Math.min(nU.r, uG.r + cap);
  }
  if (!sanity(nU)) nU.r = uG.r;
  // Rating history kept per user. Bumped 12 → 100 on 2026-08-18 to power the
  // coach performance-dashboard sparkline — 12 points was too short for the
  // trend to be readable. 100 = ~a few months of daily solving for an active
  // student; ~800 bytes per user (negligible storage). Existing users grow
  // into it naturally; no migration needed.
  const recent = [nU.r, ...(userPerf.re || [])].slice(0, 100);
  return {
    userPerf: { gl: { r: nU.r, d: liveDeviation({ gl: nU, la: new Date() }, true), v: nU.v }, nb: (userPerf.nb || 0) + 1, re: recent, la: new Date() },
    puzzleGlicko: nP,
    ratingDiff: nU.r - uG.r,
  };
}
