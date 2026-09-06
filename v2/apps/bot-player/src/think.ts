// Calibration round 2, 2026-09-06 (300 self-play games, ladder 800..2000, run with the
// exact argv engine.ts spawns): a nominal 1200-point SelfElo span plays out as 554, so
// SelfElo must not be set to the opponent's rating directly. Provisional inversion of
// that fit — the SLOPE is the measured part; the intercept is anchored by construction
// and still needs a human anchor, which is exactly why v1 games are unrated.
// See PROJECT_MASTER/plans/human-like-bot-opponent.md.
const FIT_SLOPE = 0.462;
const FIT_AT_800 = 1123;
const ELO_MIN = 700;
const ELO_MAX = 2400;

/** SelfElo that should *perform* near `rating`. Clamped to the measured ladder plus a
 *  small margin — extrapolating far outside it is unvalidated. */
export function selfEloFor(rating: number): number {
  const raw = 800 + (rating - FIT_AT_800) / FIT_SLOPE;
  return Math.round(Math.min(ELO_MAX, Math.max(ELO_MIN, raw)));
}

function gaussian(): number {
  const u = Math.random() || 1e-9;
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}

export interface ThinkTimeInput {
  ply: number;
  remainingMs: number;
  incrementMs: number;
  /** 0..1 from the policy resample; 1 means the move is essentially forced. */
  collision: number;
}

/** How long a human of this strength would plausibly sit on this move. */
export function thinkMs({ ply, remainingMs, incrementMs, collision }: ThinkTimeInput): number {
  const movesLeft = Math.max(15, 42 - ply / 2);
  let ms = 0.55 * (remainingMs / movesLeft + incrementMs * 0.7);

  // Forced moves come back instantly; genuinely open positions get the full budget.
  ms *= 0.3 + 1.25 * (1 - collision);

  // Openings are played from memory, not calculated.
  if (ply < 8) ms *= 0.22;
  else if (ply < 16) ms *= 0.6;

  ms *= Math.exp(gaussian() * 0.45);
  if (Math.random() < 0.04) ms *= 2.5; // the occasional long think

  // Time trouble: move fast when the flag is close.
  if (remainingMs < 30000) ms *= Math.max(0.12, remainingMs / 30000);

  const ceiling = Math.min(remainingMs * 0.18, 25000);
  return Math.round(Math.min(Math.max(ms, 350), Math.max(400, ceiling)));
}
