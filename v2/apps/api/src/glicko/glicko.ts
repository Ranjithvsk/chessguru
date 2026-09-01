// Lichess-exact Glicko-2, ported from the original glicko2.js. Constants frozen.
// DEFAULT_RATING = 1500 is the Glicko-2 math anchor (formula normalizes
// around it — DO NOT change). NEW_USER_RATING is a separate concept:
// what a brand-new account is seeded at before their first puzzle. Owner
// directives 2026-08-23: initially bumped down from 1500 (Lichess default)
// to 800 for kid-heavy audiences, then adjusted to 1200 as the middle
// ground — kids don't get crushed, adult beginners aren't patronized,
// strong players still climb rapidly via Glicko convergence (d=500 →
// big early swings).
export const DEFAULT_RATING = 1500, DEFAULT_DEVIATION = 500, DEFAULT_VOLATILITY = 0.09;
export const NEW_USER_RATING = 1200;
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

// A rating is "provisional" (Lichess convention) when either sample size is
// too small OR deviation is still high — the number shown is an unstable
// estimate. UI shows "≈" or "?" until this returns false. Thresholds match
// Lichess: nb>=30 puzzles solved AND d<=100 uncertainty → established.
export function isProvisional(perf: Perf): boolean {
  return (perf.nb || 0) < 30 || liveDeviation(perf) > 100;
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

// ─────────────────────────────────────────────────────────────────────────
// Lichess weighted-average model (owner 2026-08-24, ported from lila
// `modules/puzzle/src/main/PuzzleFinisher.scala::ponder.player`).
//
// Instead of running vanilla Glicko-2 and clamping the output ("gap > 250
// → +1 flat"), Lichess computes the raw Glicko-2 delta and keeps only a
// FRACTION of it, weighted by:
//   1. Theme class of the puzzle (mix / neutral / hinting / obvious)
//   2. Whether it's a win or loss (losses weigh heavier — anti-inflation)
//   3. Whether the puzzle itself is provisional (untrusted → less impact)
//
// Weight table (from lila `weightOf`):
//                    win    loss
//   mix              1.00   1.00   ← no theme filter, full delta
//   neutral          0.70   0.80   ← endgame, master, opening, ...
//   hinting          0.20   0.70   ← fork, pin, skewer, sacrifice, ...
//   obvious          0.10   0.40   ← mateIn1, castling, enPassant, all *Mates
//
// Weight is then linearly interpolated between pre-solve and raw-Glicko-
// output ratings. All three components (rating, deviation, volatility)
// move proportionally. Provisional-puzzle penalty subtracts extra weight
// (-0.2 win, -0.7 loss), floored at 0.1.
//
// See PROJECT_MASTER/knowledge/16-lichess-puzzle-system.md for the full
// reference.

// Themes with strong intrinsic hint (title tells you the answer). Wins
// carry only 10% weight; losses 40% — grinding these is break-even at best.
const OBVIOUS_THEMES = new Set([
  "enPassant", "attackingF2F7", "doubleCheck", "mateIn1", "castling",
  // All *Mate patterns
  "anastasiaMate", "arabianMate", "backRankMate", "balestraMate", "blindSwineMate",
  "bodenMate", "cornerMate", "doubleBishopMate", "dovetailMate", "epauletteMate",
  "hookMate", "killBoxMate", "pillsburysMate", "morphysMate", "operaMate",
  "swallowstailMate", "triangleMate", "vukovicMate", "smotheredMate",
]);

// Themes that don't hint at a specific tactic — solving these actually
// measures real skill. Wins 70%, losses 80%.
const NEUTRAL_THEMES = new Set([
  "opening", "middlegame", "endgame",
  "rookEndgame", "bishopEndgame", "pawnEndgame", "knightEndgame",
  "queenEndgame", "queenRookEndgame",
  "master", "masterVsMaster", "superGM",
  // Deep-calculation mates (2026-09-01, owner directive):
  // knowing "there IS a mate in N" doesn't do much of the work when
  // N ≥ 3 — you still have to calculate 6-10 half-moves. Only mateIn1
  // (pattern-match) stays in OBVIOUS; mateIn2 stays default hinting
  // (short-enough that pattern recognition often catches it).
  "mateIn3", "mateIn4", "mateIn5",
]);

const PROVISIONAL_DEVIATION = 110;

// ─────────────────────────────────────────────────────────────────────────
// Additional Lichess safeguards (2026-08-27, ported from lila
// modules/puzzle/src/main/PuzzleFinisher.scala).
//
//   1. DAILY_RATED_LIMIT — how many puzzles per day may move the user's
//      rating. Matches lila `canUpdatePuzzleRating` RateLimit(300, 1.day).
//      Beyond this, further solves complete normally (get counted, show
//      the correct move) but produce ratingDiff=0 — killing binge-farm
//      strategies where a user gets served, wins, moves rating by +5,
//      round-trips 500× a day.
//   2. isDubiousSolve — heuristic that flags an implausibly fast win on a
//      puzzle rated much higher than the user's live rating. When true,
//      we still credit the USER (their solve stands) but do NOT push the
//      PUZZLE's own rating downward — matching lila's `dubiousPlayer`
//      flag semantics which only gates puzzle-side glicko update.
//   3. isCrazyRatingDelta — the analogue of lila `crazyGlicko` monitor.
//      Returns true when the raw Glicko delta on this update looks off
//      the charts (>250 with the user already established, deviation ≤
//      110). Callers should log the event and prefer roll-back over a
//      silent write.
export const DAILY_RATED_LIMIT = 300;

/** Suspicious win: puzzle rated ≥ +300 above user AND solved in < 4s.
 *  Nobody legitimately solves a puzzle 300 rating pts above them in under
 *  four seconds — pattern-match wouldn't pan out. Only fires on WINS
 *  (losses are always credited). */
export function isDubiousSolve(userR: number, puzzleR: number, ms: number | undefined, win: boolean): boolean {
  if (!win) return false;
  if (typeof ms !== "number" || ms <= 0) return false;
  return (puzzleR - userR) >= 300 && ms < 4000;
}

/** Flag rating deltas that shouldn't be possible for an established user.
 *  Post-weight, we should be seeing <150 pt swings on established players
 *  (nb ≥ 30, d ≤ 110). Anything bigger deserves a look. */
export function isCrazyRatingDelta(pre: Perf, ratingDiff: number): boolean {
  if (isProvisional(pre)) return false;   // provisional users LEGITIMATELY swing hard
  return Math.abs(ratingDiff) >= 150;
}

export function themeWeight(theme: string | null | undefined, win: boolean, userRating?: number): number {
  if (!theme || theme === "mix") return 1.0;
  const strong = typeof userRating === "number" && userRating >= 2000;
  if (OBVIOUS_THEMES.has(theme)) {
    // Obvious pattern-mates. Under-2000 kids learning these tactics get
    // full reward for spotting them; 2000+ players see harder mateIn1s
    // but the pattern is still trivial for them → keep low.
    return strong ? (win ? 0.10 : 0.70) : (win ? 0.40 : 0.40);
  }
  if (NEUTRAL_THEMES.has(theme)) return win ? 0.70 : 0.80;
  // hinting (default: fork, pin, skewer, sacrifice, capturingDefender,
  // discoveredAttack, mateIn2, …).
  //
  // Owner directive 2026-09-01: under-2000 gets MORE win credit than 2000+.
  // Reasoning: beginners are LEARNING these tactics — correct solves are
  // real skill demonstration and deserve reward for motivation. Strong
  // players (2000+) already have the tactics internalised; their rating
  // should barely move per themed solve (small perturbations only).
  // Losses stay heavier at 2000+ (they should know these by now).
  //
  // Under 2000:  win 0.70 / loss 0.70
  // At 2000+:    win 0.40 / loss 0.80
  return strong ? (win ? 0.40 : 0.80) : (win ? 0.70 : 0.70);
}

// Weighted linear interp — matches Lichess `Glicko.average`.
function averageGlicko(a: Glicko, b: Glicko, w: number): Glicko {
  if (w >= 1) return b;
  if (w <= 0) return a;
  return {
    r: a.r * (1 - w) + b.r * w,
    d: a.d * (1 - w) + b.d * w,
    v: a.v * (1 - w) + b.v * w,
  };
}

/** Update a rating using the Lichess weighted-average model.
 *
 *  Used for BOTH global puzzle rating AND per-theme ratings — pass the
 *  puzzle's SELECTED theme filter (body.theme) OR the per-theme's theme
 *  key. Each per-theme update uses the same weighted-average logic; only
 *  the theme argument differs.
 *
 *  Returns the new user perf (with rating history + nb bumped) and the
 *  computed ratingDiff for display. Puzzle-side new glicko is also returned
 *  for callers that want to update the puzzle document (usually only the
 *  first per-solve call — subsequent per-theme updates should skip the
 *  puzzle-side write to avoid triple-counting).
 */
export function updatePuzzleRating(userPerf: Perf, puzzleGlicko: Glicko, win: boolean, theme?: string | null) {
  const uG: Glicko = { r: userPerf.gl.r, d: liveDeviation(userPerf), v: userPerf.gl.v || DEFAULT_VOLATILITY };
  const score = win ? 1 : 0;
  // Raw Glicko-2 outputs — the ENDPOINT of the weighted-average interp.
  const rawUser = computeGame(uG, puzzleGlicko, score);
  const rawPuzzle = computeGame(puzzleGlicko, uG, 1 - score);
  // Puzzle-side ±MAX_RATING_DELTA clamp (safety, matches Lichess).
  rawPuzzle.r = Math.max(puzzleGlicko.r - MAX_RATING_DELTA, Math.min(puzzleGlicko.r + MAX_RATING_DELTA, rawPuzzle.r));

  // Weight from theme classifier + provisional-puzzle modifier.
  // Pass the user's current rating so strong-player themes bump up.
  const baseWeight = themeWeight(theme, win, userPerf.gl.r);
  const puzzleProvisional = puzzleGlicko.d >= PROVISIONAL_DEVIATION;
  const provisionalMod = puzzleProvisional ? (win ? -0.2 : -0.7) : 0;
  const weight = Math.max(0.1, baseWeight + provisionalMod);

  // Weighted average between pre-solve and raw Glicko output.
  const newG = averageGlicko(uG, rawUser, weight);
  newG.r = Math.round(newG.r);
  newG.d = Math.round(newG.d);
  // Sanity + rating history (100-entry cap)
  if (!sanity(newG)) { newG.r = uG.r; newG.d = uG.d; newG.v = uG.v; }
  const recent = [newG.r, ...(userPerf.re || [])].slice(0, 100);

  return {
    userPerf: {
      gl: { r: newG.r, d: liveDeviation({ gl: newG, la: new Date() }, true), v: newG.v },
      nb: (userPerf.nb || 0) + 1,
      re: recent,
      la: new Date(),
    },
    puzzleGlicko: rawPuzzle,
    ratingDiff: newG.r - uG.r,
    weight,   // exposed for logging/debugging
  };
}
