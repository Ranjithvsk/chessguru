// Fair Play trust score — pure function over a student's solves in the window.
// See PROJECT_MASTER/plans/puzzle-anti-cheat.md. Components add up to 0–100:
//   flags        8 per detector-flagged solve beyond the first, cap 40 — one
//                stray flag a month is forgiven          (direct evidence)
//   fastHard     2 per 2400+ win under 5 s, cap 30         (speed floor)
//                (one-move puzzles and mate-theme drills never count here or
//                 in accuracy — the solver was told the pattern)
//   accuracy     15 if the win rate on puzzles 200+ above the player is at least
//                the win rate at the player's own level (n ≥ 10 each), or 85%+
//                on 10+ hard puzzles                        (inverted curve)
//   crowd        15 if the typical win takes < 25% of the crowd's time on the
//                same puzzles, 8 if < 40% (n ≥ 10)          (crowd baseline)
//   climb        10 for a 500+ climb, only alongside 3+ flags or 15+ fastHard
//   themeFlat    10 if per-theme ratings (8+ themes with 20+ solves, player
//                2000+) sit within sd < 40, 5 if < 60 — honest sd is ~100
//   playGap      10 if the puzzle rating is 800+ above the best live-game
//                rating (10+ games), 5 if 600+
// Bands: clear < 25, watch 25–59, review ≥ 60 (owner decision 2026-09-08).
import { assessSuspicion, isDrill } from "../glicko/glicko";

export interface RoundLite {
  pid: string; d: Date; pr: number; r: number; w: boolean;
  ms?: number; mv_ms?: number[]; dub?: boolean; dubr?: string[]; nc?: boolean; held?: boolean;
  th?: string[]; sel?: string;
}
export type Band = "clear" | "watch" | "review";
/** Signals that live outside the solve list (Phase 2). */
export interface ScoreExtras {
  /** Per-theme puzzle ratings with 20+ solves: everyone has weak themes, an
   *  engine is equally strong at everything. */
  themes?: { n: number; sd: number; min: number; max: number } | null;
  /** Best live-game rating with 10+ rated games, against the puzzle rating. */
  play?: { speed: string; r: number; nb: number; gap: number } | null;
  puzzleR?: number | null;
}
export interface ScoreResult {
  score: number;
  band: Band;
  components: { flags: number; fastHard: number; accuracy: number; crowd: number; climb: number; themeFlat: number; playGap: number };
  evidence: {
    solves: number; flagged: number; reasons: Record<string, number>;
    hard: { n: number; wins: number; winPct: number | null; medianMs: number | null; fast: number };
    atLevel: { n: number; winPct: number | null };
    above: { n: number; winPct: number | null };
    crowdRatio: number | null;
    ratingStart: number | null; ratingEnd: number | null; climb: number;
    fastest: { pid: string; pr: number; ms: number; mvMs: number[] | null; at: Date }[];
    sessions: { day: string; solves: number; wins: number }[];
    peakHour: { hour: string; solves: number } | null;
    themes: ScoreExtras["themes"];
    play: ScoreExtras["play"];
  };
}

/** The live detector stamps `dub`/`dubr` at solve time from 2026-09-08. For
 *  earlier solves (no `dub` field) the same pure detector is replayed over the
 *  stored timings so the score means the same thing across the boundary. */
const DETECTOR_LIVE = new Date("2026-09-08T00:00:00Z");
function withRetroFlags(rs: RoundLite[]): RoundLite[] {
  const out: RoundLite[] = [];
  const hardWins: number[] = [];   // ms of wins on 2400+ in order
  for (const x of rs) {
    let y = x;
    if (x.dub === undefined && x.d < DETECTOR_LIVE && typeof x.ms === "number") {
      const recent = hardWins.slice(-10).filter((m) => m < 6000).length;
      const { flags } = assessSuspicion({ userR: x.r, puzzleR: x.pr, ms: x.ms, mvMs: x.mv_ms, win: x.w, recentFastHardWins: recent, themes: x.th, sel: x.sel });
      if (flags.length) y = { ...x, dub: true, dubr: flags };
    }
    if (x.w && x.pr >= 2400 && typeof x.ms === "number" && !isDrill(x.th, x.sel)) hardWins.push(x.ms);
    out.push(y);
  }
  return out;
}

export const BAND_WATCH = 25;
export const BAND_REVIEW = 60;
export const bandOf = (score: number): Band => (score >= BAND_REVIEW ? "review" : score >= BAND_WATCH ? "watch" : "clear");

const median = (a: number[]): number | null => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]!; };
const pct = (wins: number, n: number): number | null => (n ? Math.round((wins / n) * 100) : null);

export function scoreStudent(rounds: RoundLite[], crowdMedianMs: (pid: string, pr: number) => number | null, extras: ScoreExtras = {}): ScoreResult {
  const rs = withRetroFlags(rounds.slice().sort((a, b) => a.d.getTime() - b.d.getTime()));
  const flagged = rs.filter((x) => x.dub);
  const reasons: Record<string, number> = {};
  for (const x of flagged) for (const f of (Array.isArray(x.dubr) && x.dubr.length ? x.dubr : ["fast_above_level"])) reasons[f] = (reasons[f] || 0) + 1;

  // Speed and accuracy are judged on real solving only: one-move puzzles and
  // mate-theme drills (the solver was told the pattern) are left out.
  const real = rs.filter((x) => !isDrill(x.th, x.sel));
  const timed = real.filter((x) => typeof x.ms === "number" && x.ms > 0);
  const hard = timed.filter((x) => x.pr >= 2400);
  const hardWins = hard.filter((x) => x.w);
  const fastHardWins = hardWins.filter((x) => x.ms! < 5000);

  const atLevel = real.filter((x) => Math.abs(x.pr - x.r) <= 100);
  const above = real.filter((x) => x.pr - x.r >= 200);
  const atLevelPct = pct(atLevel.filter((x) => x.w).length, atLevel.length);
  const abovePct = pct(above.filter((x) => x.w).length, above.length);

  const ratios: number[] = [];
  for (const x of timed) {
    if (!x.w || x.pr < 1800) continue;
    const med = crowdMedianMs(x.pid, x.pr);
    if (med && med >= 5000) ratios.push(x.ms! / med);
  }
  const crowdRatio = ratios.length >= 10 ? median(ratios) : null;

  const first = rs[0]?.r ?? null, last = rs[rs.length - 1]?.r ?? null;
  const climb = first !== null && last !== null ? Math.round(last - first) : 0;

  const c = {
    flags: Math.min(40, Math.max(0, flagged.length - 1) * 8),
    fastHard: Math.min(30, fastHardWins.length * 2),
    accuracy: 0,
    crowd: 0,
    climb: 0,
    themeFlat: 0,
    playGap: 0,
  };
  const th = extras.themes;
  if (th && th.n >= 8 && (extras.puzzleR ?? 0) >= 2000) c.themeFlat = th.sd < 40 ? 10 : th.sd < 60 ? 5 : 0;
  const pl = extras.play;
  if (pl && pl.nb >= 10) c.playGap = pl.gap >= 800 ? 10 : pl.gap >= 600 ? 5 : 0;
  const hardPct = pct(hardWins.length, hard.length);
  if ((above.length >= 10 && atLevel.length >= 10 && abovePct !== null && atLevelPct !== null && abovePct >= atLevelPct) || (hard.length >= 10 && hardPct !== null && hardPct >= 85)) c.accuracy = 15;
  if (crowdRatio !== null) c.crowd = crowdRatio < 0.25 ? 15 : crowdRatio < 0.4 ? 8 : 0;
  if (climb >= 500 && (flagged.length >= 3 || c.fastHard >= 15)) c.climb = 10;
  const score = Math.min(100, c.flags + c.fastHard + c.accuracy + c.crowd + c.climb + c.themeFlat + c.playGap);

  const byDay = new Map<string, { solves: number; wins: number }>();
  const byHour = new Map<string, number>();
  for (const x of rs) {
    const day = x.d.toISOString().slice(0, 10);
    const e = byDay.get(day) ?? { solves: 0, wins: 0 };
    e.solves++; if (x.w) e.wins++;
    byDay.set(day, e);
    const h = x.d.toISOString().slice(0, 13);
    byHour.set(h, (byHour.get(h) ?? 0) + 1);
  }
  let peakHour: { hour: string; solves: number } | null = null;
  for (const [hour, solves] of byHour) if (!peakHour || solves > peakHour.solves) peakHour = { hour, solves };

  return {
    score,
    band: bandOf(score),
    components: c,
    evidence: {
      solves: rs.length, flagged: flagged.length, reasons,
      hard: { n: hard.length, wins: hardWins.length, winPct: hardPct, medianMs: median(hardWins.map((x) => x.ms!)), fast: fastHardWins.length },
      atLevel: { n: atLevel.length, winPct: atLevelPct },
      above: { n: above.length, winPct: abovePct },
      crowdRatio: crowdRatio === null ? null : Math.round(crowdRatio * 100) / 100,
      ratingStart: first, ratingEnd: last, climb,
      fastest: hardWins.slice().sort((a, b) => a.ms! - b.ms!).slice(0, 5).map((x) => ({ pid: x.pid, pr: x.pr, ms: x.ms!, mvMs: Array.isArray(x.mv_ms) ? x.mv_ms : null, at: x.d })),
      sessions: Array.from(byDay, ([day, v]) => ({ day, ...v })),
      peakHour,
      themes: th ?? null,
      play: pl ?? null,
    },
  };
}
