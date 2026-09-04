import { Injectable } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { updatePuzzleRating, isProvisional, DEFAULT_VOLATILITY, DAILY_RATED_LIMIT, isDubiousSolve, isCrazyRatingDelta } from "../glicko/glicko";
import { fmtPuzzle, applyLastMove } from "../lib/puzzle-format";
import { recordAndCelebrate } from "./milestones";
import { PushService } from "../push/push.service";

// CL-9156c: "normal" = ~125 below the user's live rating (comfortable level the user
// solves most of); ladder steps from there. Offsets apply to the LIVE rating (CL-9156b).
const DIFF: Record<string, number> = { easiest: -600, easier: -300, normal: -125, harder: 300, hardest: 600 };
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
// Cap the exclusion set so $nin stays cheap even for very active accounts.
const MAX_PLAYED = 5000;

@Injectable()
export class PuzzlesService {
  constructor(
    @InjectConnection() private readonly conn: Connection,
    private readonly push: PushService,
  ) {}
  private col() { return this.conn.db!.collection("puzzles"); }

  /**
   * Puzzle IDs to KEEP OUT of this user's draw (spaced repetition):
   *   - SOLVED puzzles (w:true) are excluded forever — never repeat a solved one.
   *   - FAILED puzzles (w:false) are excluded only for REPEAT_FAILED_DAYS, then become
   *     eligible again so the user gets another crack at the ones they missed.
   * rounds._id is "userId:puzzleId"; range scan on the indexed _id, most-recent-first.
   */
  private async playedIds(userId: string): Promise<{ exclude: string[]; attempted: Set<string> }> {
    // ";" (0x3B) sorts immediately after ":" (0x3A), so [userId:, userId;) brackets exactly this user's rounds.
    const lo = `${userId}:`;
    const hi = `${userId};`;
    const REPEAT_FAILED_DAYS = 7;
    const cutoff = new Date(Date.now() - REPEAT_FAILED_DAYS * 86400000);
    const rows = await this.conn.db!
      .collection("rounds")
      .find({ _id: { $gte: lo, $lt: hi } as any }, { projection: { _id: 1, w: 1, d: 1 } })
      .sort({ d: -1 })
      .limit(MAX_PLAYED)
      .toArray();
    const out: string[] = [];
    const attempted = new Set<string>();
    for (const r of rows as any[]) {
      const id = String(r._id).slice(lo.length);
      attempted.add(id);
      if (r.w) out.push(id);                                          // solved -> never repeat
      else if (r.d && new Date(r.d) >= cutoff) out.push(id);          // failed recently -> hold off
      // failed long ago -> eligible to retry
    }
    return { exclude: out, attempted };
  }

  async random(theme: string, difficulty: string, rating: number, maxPc?: number, userId?: string | null, section?: string, player?: string, mode?: string, exactRating?: number) {
    // CL-9156b: use the user's CURRENT puzzle rating from userperfs as the base,
    // not the client-passed `rating` (which lags — frozen near page load — so as
    // the user climbs during a session, puzzles were served ~100-150 below).
    let baseRating = rating;
    if (userId) {
      // Blindfold is its own skill: its serving uses the BLINDFOLD rating and
      // blindfold theme ratings (themesBf), fully separate from regular puzzles.
      const bf = mode === "blindfold";
      const perfKey = bf ? "blindfold" : "puzzle";
      const up = await this.conn.db!.collection("userperfs").findOne({ _id: userId as any }, { projection: { [`${perfKey}.gl.r`]: 1 } });
      const liveR = (up as any)?.[perfKey]?.gl?.r;
      if (typeof liveR === "number" && liveR > 0) baseRating = liveR;
      // Picker now uses GLOBAL rating only (owner directive 2026-08-24) —
      // per-theme ratings are for DISPLAY + WEAKNESS DETECTION only. Prior
      // behaviour trusted per-theme when nb>=8 + d<=200, which caused the
      // srinithi disaster: her per-theme mateIn3 sat at 2112 while her real
      // skill (global) was 1481; picker served 2000+ puzzles she couldn't
      // solve → losses took huge Glicko hits, wins capped at +1 → net −347
      // rating despite 88% win rate. Ranjith the same day: global 2075,
      // per-theme mateIn3 grown to 2500+, picker served 2550 → unwinnable.
      // Since we now use Lichess weighted-average rating (theme adjusts
      // WEIGHT of the delta, not the picker band), we don't need per-theme
      // to also drive picker. One source of truth = the user's global.
    }
    // Curriculum step: caller-specified exact rating wins over both the
    // live-rating override AND the difficulty offset. Used by the weakness
    // curriculum's ratchet so each step lands on a known target rating.
    const rawTarget = typeof exactRating === "number" && exactRating > 0
      ? clamp(exactRating, 400, 3000)
      : clamp(baseRating + (DIFF[difficulty] ?? 0), 400, 3000);
    // Hard floor: never serve a puzzle more than 250 pts below baseRating,
    // regardless of difficulty tier. Owner report 2026-08-24: srinithi_sn
    // solved 217 puzzles over 48h with 188 wins but net rating went DOWN by
    // 347 — picker was serving her puzzles rated 400-800 (via FAST PATH pool
    // sampling + the old easiest-tier exemption) while her global 1481 and
    // per-theme 1900+ said she should be seeing 1600+ puzzles. Every easy
    // win got capped at +1 by the anti-inflation rule; every rare loss on a
    // 400-800 puzzle took a huge -50 Glicko hit (losing to a much-weaker
    // puzzle screams "you're overrated"). Floor now enforced UNIVERSALLY,
    // and the FAST PATH clamps target to floor before doing the band lookup
    // so a thin exact-band pool can never bleed into the 900-rated bucket.
    const easyFloor = Math.max(400, baseRating - 250);
    const target = Math.max(rawTarget, easyFloor);
    const { exclude: played, attempted } = userId ? await this.playedIds(userId) : { exclude: [] as string[], attempted: new Set<string>() };
    const playedSet = new Set(played);

    // ── MASTER GAMES section: GM/super-GM blunder puzzles (source:"broadcast").
    // Every puzzle's glicko.r = the loser's Elo, so they are uniformly hard; difficulty
    // just picks a sub-band of that Elo range (not tied to the child's low rating).
    if (section === "masters") {
      const BANDS: Record<string, [number, number]> = {
        easiest: [2200, 2450], easier: [2350, 2550], normal: [2400, 2650], harder: [2550, 2750], hardest: [2650, 3200],
      };
      const [lo, hi] = BANDS[difficulty] ?? [2200, 3200];
      const themeM = theme && theme !== "mix" ? { themes: theme } : {};
      const dedupM = played.length ? { _id: { $nin: played } } : {};
      // A specific big-player pick -> only their NAMED broadcast puzzles (so winner shows).
      // Otherwise blend our own broadcast GM puzzles with Lichess master-game tactics so the
      // section is full immediately (broadcast ones additionally carry player names + winner).
      const base: any = player
        ? { source: "broadcast", winnerName: player }
        : { $or: [{ source: "broadcast" }, { themes: "master" }] };
      const pick = async (m: any) => {
        const d = await this.col().aggregate([{ $match: m }, { $sample: { size: 1 } }]).toArray();
        return d.length ? applyLastMove(fmtPuzzle(d[0])) : null;
      };
      return (await pick({ ...base, "glicko.r": { $gte: lo, $lte: hi }, ...themeM, ...dedupM }))
          ?? (await pick({ ...base, ...themeM, ...dedupM }))
          ?? (await pick({ ...base, ...themeM }));
    }

    // ── FAST PATH: precomputed pools (`paths`) — sample an id, fetch by indexed _id. ──
    // paths: { _id:"theme|tier|RRRR", min, max, ids:[puzzleId] }; exactly one band path per rating.
    // Avoids the $sample-over-5.9M-docs scan (4–6s). pieceCount-filtered requests fall through.
    const flex = Math.round(100 + Math.abs(1500 - target) / 4);
    if (!maxPc || maxPc >= 32) {
      const key4 = (n: number) => String(clamp(Math.round(n), 0, 9999)).padStart(4, "0");
      // Widen to the same flex window the fallback uses, but never below the
      // easy-floor, so an exhausted band borrows from its neighbours instead of
      // bleeding into the 900-rated bucket.
      const loKey = key4(Math.max(easyFloor, target - flex));
      const hiKey = key4(target + flex);
      const esc = theme.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const paths = this.conn.db!.collection("paths");
      const dist = (p: any) => {
        const lo = Number(String(p.min).slice(-4));
        const hi = Number(String(p.max).slice(-4));
        return target < lo ? lo - target : target > hi ? target - hi : 0;
      };
      // Every pool overlapping the flex window, nearest band first. Until
      // 2026-09-04 this took ONLY the pool containing `target`; an active student
      // who had cleared it fell through to the $sample fallback and waited 26s.
      const poolCache = new Map<string, any[]>();
      const poolsFor = async (tier: string) => {
        let p = poolCache.get(tier);
        if (!p) {
          p = await paths.find({
            _id: { $regex: `^${esc}\\|${tier}\\|` } as any,
            min: { $lte: `${theme}|${tier}|${hiKey}` },
            max: { $gte: `${theme}|${tier}|${loKey}` },
          }).toArray();
          p.sort((a, b) => dist(a) - dist(b));
          poolCache.set(tier, p);
        }
        return p;
      };
      // freshOnly is the OUTER loop: a never-seen puzzle from a lower quality
      // tier beats re-serving one the student already met. A puzzle failed >7d
      // ago is deliberately back in the draw (spaced repetition), but it must
      // not outrank a puzzle she has never seen — with 50-id pools her whole
      // "available" set was old failures, so every draw was a repeat
      // (harinitharanjith: 10/10 already-attempted, 328 re-eligible failures).
      for (const freshOnly of [true, false]) {
        for (const tier of ["top", "good", "all"]) {
          for (const path of await poolsFor(tier)) {
            const ids: string[] = (path?.ids as string[]) || [];
            const avail = ids.filter((id) => !playedSet.has(id) && !(freshOnly && attempted.has(id)));
            if (!avail.length) continue;
            const pick = avail[Math.floor(Math.random() * avail.length)]!;
            const d = await this.col().findOne({ _id: pick as any });
            if (d) return applyLastMove(fmtPuzzle(d));
          }
        }
      }
    }

    // ── FALLBACK: indexed random seek (rare: piece-count filter, exotic theme, or missing pool). ──
    const themeQ = theme && theme !== "mix" ? { themes: theme } : {};
    const pcQ = maxPc && maxPc < 32 ? { pieceCount: { $lte: maxPc } } : {};
    const dedupQ = played.length ? { _id: { $nin: played } } : {};
    const srcExcl = { source: { $ne: "broadcast" } }; // keep GM section out of normal play
    // Enforce the easy-floor on every fallback query so a thin exact-band pool
    // never bleeds into serving 300+-below puzzles.
    const withFloor = (band: any) => ({ ...band, $gte: Math.max(band.$gte, easyFloor) });
    // $sample over a rating band is a scan of the whole band — measured at 25s
    // against the ~1M puzzles between 1021 and 1335 (2026-09-04), and the $nin
    // dedup was NOT the cost (24.1s with it, 24.7s without). Instead: seek the
    // {glicko.r:1} / {themes:1,glicko.r:1} index at a random rating inside the
    // band and take a small page from there — ~6ms.
    //
    // Both directions are tried because ascending alone only sees puzzles above
    // the seek point; the pair covers the whole band, so an empty result really
    // does mean "nothing unplayed matches" rather than "seeded too high".
    // Biases the draw toward rating-dense parts of the band, which a solver
    // cannot perceive.
    const sample = async (m: any) => {
      const band = (m["glicko.r"] ?? {}) as { $gte?: number; $lte?: number };
      const lo = typeof band.$gte === "number" ? band.$gte : 400;
      const hi = typeof band.$lte === "number" ? band.$lte : 3000;
      const seed = lo + Math.random() * Math.max(1, hi - lo);
      const first = Math.random() < 0.5;
      for (const asc of [first, !first]) {
        const q = { ...m, "glicko.r": asc ? { ...band, $gte: seed } : { ...band, $lte: seed } };
        const rows = await this.col().find(q).sort({ "glicko.r": asc ? 1 : -1 }).limit(20).toArray();
        if (rows.length) return applyLastMove(fmtPuzzle(rows[Math.floor(Math.random() * rows.length)]!));
      }
      return null;
    };
    const tiers: any[] = [
      { vote: { $gte: 0.75 }, plays: { $gte: 100 } },
      { vote: { $gte: 0.5 }, plays: { $gte: 20 } },
      {},
    ];
    for (const tier of tiers) {
      const pz = await sample({ "glicko.r": withFloor({ $gte: target - flex, $lte: target + flex }), ...tier, ...themeQ, ...pcQ, ...dedupQ, ...srcExcl });
      if (pz) return pz;
    }
    const wide = await sample({ "glicko.r": withFloor({ $gte: target - 400, $lte: target + 400 }), ...themeQ, ...pcQ, ...dedupQ, ...srcExcl });
    if (wide) return wide;
    if (played.length) {
      const any = await sample({ "glicko.r": withFloor({ $gte: target - 400, $lte: target + 400 }), ...themeQ, ...pcQ, ...srcExcl });
      if (any) return any;
    }
    return null;
  }
  /** Top winning players in the GM puzzle set (for the "big players" picker). */
  async masterPlayers() {
    const rows = await this.col().aggregate([
      { $match: { source: "broadcast", winnerName: { $nin: [null, ""] } } },
      { $group: { _id: "$winnerName", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 60 },
    ]).toArray();
    return rows.map((r: any) => ({ name: r._id, count: r.count }));
  }

  async byId(id: string) {
    const d = await this.col().findOne({ _id: id as any });
    return d ? applyLastMove(fmtPuzzle(d)) : null;
  }

  /** Phase 8d: last N days of daily puzzles + the caller's per-day result.
   *  Powers the 7-cell activity strip on the Daily page: a ✓/✗/– per day for
   *  the past week so users see their consistency at a glance and can jump
   *  back to review a specific day's puzzle. `null` daily means we hadn't
   *  chosen a puzzle for that date yet (very early days). */
  async dailyHistory(userId: string | null, days: number) {
    const n = Math.max(1, Math.min(30, days | 0));
    // Fetch the last `n` dailyPuzzles rows sorted desc by date (which is the _id).
    const rows = await this.conn.db!.collection("dailyPuzzles")
      .find({}, { projection: { _id: 1, puzzleId: 1 } as any })
      .sort({ _id: -1 })
      .limit(n)
      .toArray();
    if (rows.length === 0) return [];
    // Batch-fetch the caller's rounds for those puzzleIds in one $in query.
    let byPid = new Map<string, any>();
    if (userId) {
      const ids = rows.map((r) => `${userId}:${r.puzzleId}`);
      const rounds = await this.conn.db!.collection("rounds")
        .find({ _id: { $in: ids } as any }, { projection: { _id: 1, w: 1, ms: 1, d: 1 } as any })
        .toArray();
      for (const rd of rounds) {
        const pid = String(rd._id).split(":")[1];
        if (pid) byPid.set(pid, rd);
      }
    }
    return rows.map((r) => {
      const pid = String(r.puzzleId);
      const round = byPid.get(pid);
      return {
        date: String(r._id),
        puzzleId: pid,
        attempted: !!round,
        win: round ? !!round.w : null,
        ms: round?.ms ?? null,
      };
    }).reverse();   // oldest → newest for left-to-right strip rendering
  }

  /** Phase 8a: Puzzle of the Day. First caller each day rolls the dice; the
   *  chosen puzzle is stashed in `dailyPuzzles` keyed by ISO date so every
   *  subsequent caller gets the same one. Rating band 1400–1700 —
   *  approachable enough that most users can attempt, meaty enough that it
   *  actually tests something. Popular puzzles only (vote + plays), so a
   *  buggy or ambiguous one doesn't get everyone's shared attempt. */
  async daily(userId: string | null) {
    const today = new Date().toISOString().slice(0, 10);
    let doc: any = await this.conn.db!.collection("dailyPuzzles").findOne({ _id: today as any });
    if (!doc) {
      const picked = await this.col().aggregate([
        { $match: { "glicko.r": { $gte: 1400, $lte: 1700 }, vote: { $gte: 0.75 }, plays: { $gte: 100 }, source: { $ne: "broadcast" } } },
        { $sample: { size: 1 } },
      ]).toArray();
      if (picked.length) {
        try {
          await this.conn.db!.collection("dailyPuzzles").insertOne({ _id: today as any, puzzleId: picked[0]!._id, chosenAt: new Date() });
        } catch { /* concurrent caller won the race — re-read below picks up their pick */ }
      }
      doc = await this.conn.db!.collection("dailyPuzzles").findOne({ _id: today as any });
      if (!doc) return null;   // rating band had no candidates today — very unlikely
    }
    const puzzle = await this.col().findOne({ _id: doc.puzzleId });
    if (!puzzle) return null;
    let solvedByMe = false, myRound: any = null, streak: any = null;
    if (userId) {
      myRound = await this.conn.db!.collection("rounds").findOne({ _id: `${userId}:${doc.puzzleId}` as any });
      solvedByMe = !!myRound?.w;
      const u: any = await this.conn.db!.collection("users").findOne({ _id: userId as any }, { projection: { dailyPuzzleStreak: 1 } as any });
      const st = u?.dailyPuzzleStreak;
      // "Alive" = last-attended is today or yesterday. Older means the streak
      // has died; we still report longest for the personal-best line.
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      const alive = st?.lastDate === today || st?.lastDate === yesterday;
      streak = st ? { current: alive ? (st.current || 0) : 0, longest: st.longest || 0, lastDate: st.lastDate || null } : { current: 0, longest: 0, lastDate: null };
    }
    // Phase 8b: today-so-far stats. Scan today's rounds (few hundred rows
    // typically) and filter to this puzzleId suffix — the rounds _id is
    // "userId:puzzleId" so a straight range-by-day query catches everyone,
    // and we bucket by ID suffix client-side. Cap at 2000 in case a daily
    // ever goes viral.
    const dayStart = new Date(today + "T00:00:00.000Z");
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    const roundsToday: any[] = await this.conn.db!.collection("rounds").find(
      { d: { $gte: dayStart, $lt: dayEnd } },
      { projection: { _id: 1, w: 1, ms: 1 } as any },
    ).limit(2000).toArray();
    const pid = String(doc.puzzleId);
    const forThis = roundsToday.filter((r) => String(r._id).endsWith(":" + pid));
    const attempted = forThis.length;
    const solved = forThis.filter((r) => r.w).length;
    const solveMs = forThis.filter((r) => r.w && typeof r.ms === "number" && r.ms > 0).map((r) => r.ms).sort((a, b) => a - b);
    const medianMs = solveMs.length ? solveMs[Math.floor(solveMs.length / 2)] : null;
    return {
      date: today,
      puzzle: applyLastMove(fmtPuzzle(puzzle)),
      solvedByMe,
      myRound: myRound ? { win: !!myRound.w, ms: myRound.ms ?? null, ratingDiff: myRound.rd ?? null } : null,
      stats: { attempted, solved, medianMs },
      streak,
    };
  }

  // Tags that describe the puzzle, not a skill — they don't get their own rating.
  static readonly UNRATED = new Set(["oneMove", "short", "long", "veryLong", "equality", "advantage", "crushing", "mate", "master", "masterVsMaster", "superGM"]);

  async dashboard(userId: string | null) {
    if (!userId) return { loggedIn: false };
    const [perfs, rounds] = await Promise.all([
      this.conn.db!.collection("userperfs").findOne({ _id: userId as any }),
      this.conn.db!
        .collection("rounds")
        .find({ _id: { $gte: `${userId}:` as any, $lt: `${userId};` as any } }, { projection: { w: 1, d: 1, r: 1, k: 1, pr: 1, ms: 1 } })
        .sort({ d: -1 })
        .limit(2000)
        .toArray(),
    ]);
    const p: any = perfs || {};
    const mapThemes = (obj: any) => Object.entries(obj || {})
      .map(([theme, tp]: [string, any]) => ({
        theme,
        rating: Math.round(tp?.gl?.r ?? 1500),
        rd: Math.round(tp?.gl?.d ?? 500),
        games: tp?.nb ?? 0,
        last: tp?.la ?? null,
      }))
      .filter((t) => t.games > 0)
      .sort((a, b) => b.rating - a.rating);
    const themesBf = mapThemes(p.themesBf);
    const themes = Object.entries(p.themes || {})
      .map(([theme, tp]: [string, any]) => ({
        theme,
        rating: Math.round(tp?.gl?.r ?? 1500),
        rd: Math.round(tp?.gl?.d ?? 500),
        games: tp?.nb ?? 0,
        last: tp?.la ?? null,
      }))
      .filter((t) => t.games > 0)
      .sort((a, b) => b.rating - a.rating);
    const puzzleRounds = rounds.filter((r: any) => r.k !== "blindfold");
    const wins = puzzleRounds.filter((r: any) => r.w).length;
    // Daily series (last 120 days): solves + rating-after. 30d was enough for the
    // rating sparkline; 120d powers the 13-week heatmap and multi-week streak calc.
    const byDay = new Map<string, { n: number; wins: number; lastR: number }>();
    for (const r of puzzleRounds) {
      const day = r.d ? new Date(r.d).toISOString().slice(0, 10) : null;
      if (!day) continue;
      const e = byDay.get(day) || { n: 0, wins: 0, lastR: 0 };
      e.n++; if (r.w) e.wins++; if (!e.lastR) e.lastR = r.r || 0; // rounds sorted desc → first seen = last of day
      byDay.set(day, e);
    }
    const days = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-120)
      .map(([day, e]) => ({ day, solves: e.n, wins: e.wins, rating: e.lastR }));
    // Per-difficulty bands: bucket rated rounds by the PUZZLE's rating (r.pr) into 200-pt
    // bins. Rounds with no puzzle-rating stamped (older rows) fall into 'unrated' and
    // get excluded from the chart. Powers the "how you do at 1400 vs 1800" diagnostic.
    const bandMap = new Map<number, { attempted: number; solved: number }>();
    for (const r of puzzleRounds) {
      const pr = typeof r.pr === "number" ? r.pr : null;
      if (pr == null) continue;
      const lo = Math.floor(pr / 200) * 200;
      const b = bandMap.get(lo) || { attempted: 0, solved: 0 };
      b.attempted++; if (r.w) b.solved++;
      bandMap.set(lo, b);
    }
    const bands = [...bandMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([lo, b]) => ({ lo, hi: lo + 199, attempted: b.attempted, solved: b.solved,
                           accuracy: b.attempted ? Math.round((b.solved / b.attempted) * 100) : 0 }));

    // Personal bests — single-pass scan of rated puzzle rounds. Fastest solve is only
    // meaningful on WINS (a fast miss isn't an achievement) and only when we have ms.
    let bestRating = 0, bestRatingDate: string | null = null;
    let fastestMs = Infinity, fastestDate: string | null = null;
    for (const r of puzzleRounds) {
      const rating = typeof r.r === "number" ? r.r : 0;
      const day = r.d ? new Date(r.d).toISOString().slice(0, 10) : null;
      if (rating > bestRating) { bestRating = rating; bestRatingDate = day; }
      if (r.w && typeof r.ms === "number" && r.ms > 0 && r.ms < fastestMs) {
        fastestMs = r.ms; fastestDate = day;
      }
    }
    // Best day = day with most solves in the last 120d window. Biggest single-day
    // rating gain = max positive jump in end-of-day rating vs the previous ACTIVE day.
    // Sparse day-to-day (some days have 0 solves) matches how streak/heatmap treat it.
    let bestDaySolves = 0, bestDayDate: string | null = null;
    for (const d of days) {
      if (d.solves > bestDaySolves) { bestDaySolves = d.solves; bestDayDate = d.day; }
    }
    let biggestGain = 0, biggestGainDate: string | null = null;
    let prev: number | null = null;
    for (const d of days) {
      if (d.rating > 0) {
        if (prev != null && d.rating - prev > biggestGain) {
          biggestGain = d.rating - prev; biggestGainDate = d.day;
        }
        prev = d.rating;
      }
    }
    const personalBests = {
      bestRating: bestRating || null, bestRatingDate,
      bestDay: bestDaySolves || null, bestDayDate,
      biggestGain: biggestGain || null, biggestGainDate,
      fastestMs: isFinite(fastestMs) ? fastestMs : null, fastestDate,
    };
    // Per-theme solve-speed medians — only counts WINS with a real ms (misses
    // and legacy rows without ms are excluded so the "you crush X in 8s" read
    // is honest). Themes are pulled from each round's stored th[] array. Filter
    // to themes with >= 3 timed solves for stability; less than that reads as
    // noise. Sorted fastest first so the trainer's leaderboard mental model works.
    //
    // Trend classification: compare median of ms in the last 30 days vs median
    // of the previous 30 days. "faster"/"slower" require both windows to have
    // >= 3 samples so a single fast solve last week doesn't fake a trend.
    const now30 = Date.now() - 30 * 86_400_000;
    const now60 = Date.now() - 60 * 86_400_000;
    const speedByTheme = new Map<string, { recent: number[]; prior: number[]; all: number[] }>();
    for (const r of puzzleRounds as any[]) {
      if (!r.w) continue;
      if (typeof r.ms !== "number" || r.ms <= 0) continue;
      if (!Array.isArray(r.th)) continue;
      const d = r.d ? new Date(r.d).getTime() : 0;
      for (const t of r.th) {
        if (typeof t !== "string" || PuzzlesService.UNRATED.has(t)) continue;
        const b = speedByTheme.get(t) ?? { recent: [], prior: [], all: [] };
        b.all.push(r.ms);
        if (d >= now30)      b.recent.push(r.ms);
        else if (d >= now60) b.prior.push(r.ms);
        speedByTheme.set(t, b);
      }
    }
    const median = (arr: number[]): number => {
      const s = arr.slice().sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 === 1 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
    };
    const themeSpeeds = [...speedByTheme.entries()]
      .filter(([, b]) => b.all.length >= 3)
      .map(([theme, b]) => {
        const medianMs = median(b.all);
        let trend: "faster" | "slower" | "steady" | "new" = "steady";
        // "new" tag: no priors — the theme showed up only in the last 30 days.
        if (b.prior.length === 0 && b.recent.length >= 3) trend = "new";
        // Need enough in BOTH windows for a real comparison. 20% delta is the
        // "meaningful" bar — chess solves are noisy day-to-day.
        else if (b.recent.length >= 3 && b.prior.length >= 3) {
          const mRecent = median(b.recent);
          const mPrior  = median(b.prior);
          const delta = (mRecent - mPrior) / mPrior;
          if (delta <= -0.20) trend = "faster";
          else if (delta >= 0.20) trend = "slower";
        }
        return { theme, medianMs, n: b.all.length, trend };
      })
      .sort((a, b) => a.medianMs - b.medianMs);
    // Most-recent session. Walk rounds DESCENDING (newest first — matches how
    // Mongo returned them) and group into contiguous bursts separated by <=
    // SESSION_GAP_MS. The first such burst IS the last session. Cheap because
    // we stop as soon as the gap opens.
    const SESSION_GAP_MS = 30 * 60_000; // 30 min of silence starts a new session
    let lastSession: { count: number; wins: number; ratingDelta: number; startAt: string; endAt: string } | null = null;
    if (puzzleRounds.length > 0) {
      let count = 0, wins = 0, ratingDelta = 0;
      let startAt: Date | null = null, endAt: Date | null = null;
      let prevMs: number | null = null;
      for (const r of puzzleRounds as any[]) {
        const d = r.d ? new Date(r.d) : null;
        if (!d) continue;
        const dMs = d.getTime();
        // Rounds are newest-first: descending order in time. Once we see a
        // gap > threshold vs the PREVIOUSLY-STAMPED (newer) round, the current
        // session has ended and we bail.
        if (prevMs != null && (prevMs - dMs) > SESSION_GAP_MS) break;
        count++;
        if (r.w) wins++;
        if (typeof r.rd === "number") ratingDelta += r.rd;
        if (!endAt) endAt = d;   // first round we see = end of the last session
        startAt = d;             // keep walking; the OLDEST round in the session
        prevMs = dMs;
      }
      if (count > 0 && startAt && endAt) {
        lastSession = { count, wins, ratingDelta,
                        startAt: startAt.toISOString(), endAt: endAt.toISOString() };
      }
    }

    // Hour-of-day activity in the caller's local time. rounds.d is a UTC Date;
    // client-side we'd read local hour trivially, but bucketing on the server
    // saves 2000 rounds worth of round trip. Server clock's local hour is used
    // as a best-effort proxy — most users are in a single timezone, and any
    // mismatch is bounded to a ±12h rotation the eye smooths over.
    const byHour: Array<{ hour: number; n: number; wins: number; medianMs: number | null }> = [];
    const hourBuckets: Array<{ n: number; wins: number; ms: number[] }> =
      Array.from({ length: 24 }, () => ({ n: 0, wins: 0, ms: [] }));
    for (const r of puzzleRounds as any[]) {
      if (!r.d) continue;
      const h = new Date(r.d).getHours();
      const b = hourBuckets[h];
      if (!b) continue;
      b.n++;
      if (r.w) b.wins++;
      if (r.w && typeof r.ms === "number" && r.ms > 0) b.ms.push(r.ms);
    }
    for (let h = 0; h < 24; h++) {
      const b = hourBuckets[h]!;
      let medMs: number | null = null;
      if (b.ms.length >= 3) {
        const s = b.ms.slice().sort((a, b) => a - b);
        const mid = Math.floor(s.length / 2);
        medMs = s.length % 2 === 1 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
      }
      byHour.push({ hour: h, n: b.n, wins: b.wins, medianMs: medMs });
    }
    // Lifetime study-drill totals — sum of per-study `nb` counters kept under
    // userperfs.study.<type>.nb by StudyService.complete. Broken down by type
    // so the dashboard can show "Rule of the Square 42 · Queen Mate 18 · …"
    // when we want it later; grand total drives the headline stat card.
    // Added 2026-08-18 (owner: "total no of study solved" on My performance).
    const studyPerf: Record<string, any> = p.study || {};
    const studyByType = Object.entries(studyPerf)
      .map(([type, sp]: [string, any]) => ({ type, nb: sp?.nb ?? 0, rating: Math.round(sp?.gl?.r ?? 0) }))
      .filter((s) => s.nb > 0)
      .sort((a, b) => b.nb - a.nb);
    const studyTotal = studyByType.reduce((s, x) => s + x.nb, 0);

    return {
      loggedIn: true,
      global: { rating: Math.round(p.puzzle?.gl?.r ?? 1200), rd: Math.round(p.puzzle?.gl?.d ?? 500), games: p.puzzle?.nb ?? 0, provisional: p.puzzle ? isProvisional(p.puzzle) : true },
      blindfold: p.blindfold ? { rating: Math.round(p.blindfold.gl?.r ?? 800), games: p.blindfold.nb ?? 0, provisional: isProvisional(p.blindfold) } : null,
      totals: { attempted: puzzleRounds.length, wins, accuracy: puzzleRounds.length ? Math.round((wins / puzzleRounds.length) * 100) : 0 },
      study: { total: studyTotal, byType: studyByType },
      themes,
      themesBf,
      days,
      bands,
      personalBests,
      themeSpeeds,
      byHour,
      lastSession,
    };
  }

  /** Curated "Suggested for you" theme list — a MIX of weaknesses (biggest
   *  rating gap below global), strengths (build confidence), and untried
   *  themes (variety). Powers the smart-suggestion chips on the Puzzles
   *  page. Owner ask 2026-08-18: "make theme suggestion smarter based on
   *  my weaknesses and not always tough topics; easy and tough should be
   *  there".
   *
   *  Design (see the /puzzles page for user-facing explanation):
   *   - Guests: fixed starter mix (mate patterns + basic tactics).
   *   - Signed-in users with < 20 solves: same starter mix + no per-theme
   *     data yet.
   *   - Established users: rank themes by (a) weakness = biggest negative
   *     delta from your global rating that has ≥5 solves, (b) strength =
   *     biggest positive delta with ≥5 solves, (c) new = never-played
   *     themes to keep variety. Interleave so the strip mixes easy and
   *     tough rather than piling on the worst ones. */
  async suggestedThemes(userId: string | null): Promise<{
    global: number;
    globalProvisional: boolean;
    items: Array<{ theme: string; yourRating: number | null; delta: number | null; solves: number; provisional: boolean; reason: "weakness" | "strength" | "new" | "starter" }>;
  }> {
    // Themes worth suggesting — meta/length/level tags are filtered so we
    // never suggest "long" or "master". This mirrors the front-end trainer's
    // classifier categories.
    const CANDIDATE_THEMES = [
      // Endgames
      "pawnEndgame", "rookEndgame", "bishopEndgame", "knightEndgame", "queenEndgame", "queenRookEndgame",
      // Mate patterns
      "mateIn1", "mateIn2", "mateIn3", "mateIn4", "mateIn5", "backRankMate", "smotheredMate",
      "anastasiaMate", "arabianMate", "bodenMate", "hookMate", "operaMate",
      // Tactics
      "pin", "fork", "skewer", "discoveredAttack", "discoveredCheck", "doubleCheck",
      "deflection", "attraction", "clearance", "interference", "intermezzo",
      "sacrifice", "xRayAttack", "trappedPiece", "capturingDefender", "quietMove", "zugzwang",
      // Attacks
      "attackingF2F7", "kingsideAttack", "queensideAttack", "exposedKing", "hangingPiece", "defensiveMove",
      // Pawn play
      "advancedPawn", "promotion", "underPromotion", "enPassant", "castling",
    ];

    // Guests / very-new users get the starter mix — beginner-friendly tactics
    // plus mate-in-1/2 for early wins.
    const STARTER = ["mateIn1", "mateIn2", "fork", "pin", "hangingPiece", "skewer", "backRankMate"];

    if (!userId) {
      return {
        global: 1500,
        globalProvisional: true,
        items: STARTER.map((theme) => ({ theme, yourRating: null, delta: null, solves: 0, provisional: true, reason: "starter" as const })),
      };
    }
    const perf: any = await this.conn.db!.collection("userperfs").findOne({ _id: userId as any });
    const globalR = Math.round(perf?.puzzle?.gl?.r ?? 1200);
    const totalSolves = perf?.puzzle?.nb ?? 0;
    const themes = perf?.themes ?? {};
    const globalProvisional = perf?.puzzle ? isProvisional(perf.puzzle) : true;

    if (totalSolves < 20) {
      // Not enough data to trust per-theme numbers. Mix STARTER with any few
      // themes they've already played (so the strip feels personal even at 5
      // solves) but tag them all as "starter".
      const seen = Object.keys(themes).filter((t) => (themes[t]?.nb ?? 0) > 0).slice(0, 3);
      const merged = [...new Set([...seen, ...STARTER])].slice(0, 7);
      return {
        global: globalR,
        globalProvisional,
        items: merged.map((theme) => {
          const tp = themes[theme];
          const nb = tp?.nb ?? 0;
          return {
            theme,
            yourRating: tp ? Math.round(tp.gl?.r ?? globalR) : null,
            delta: tp ? Math.round((tp.gl?.r ?? globalR) - globalR) : null,
            solves: nb,
            provisional: true,  // everything is provisional for very-new users
            reason: "starter" as const,
          };
        }),
      };
    }

    // Established-user path: classify each candidate theme by our per-theme
    // rating delta. Only themes with enough SOLVES *and* low RD (<=200) are
    // trusted for strength/weakness classification — provisional ratings on
    // few-play themes routinely inflate to +200-300 from the fresh-1500 start
    // (Mageswaran mateIn5 = 3042 on 9 solves, 234 above global 2809, was being
    // suggested as a "strength" and served 3000+-rated puzzles). Provisional
    // themes still show in "new" if the user has touched them, but the UI can
    // render them with a "provisional — few solves" badge.
    const MIN_SOLVES_TRUSTED = 15;
    const MAX_RD_TRUSTED = 200;
    type Row = { theme: string; yourRating: number | null; delta: number | null; solves: number; provisional: boolean; reason: "weakness" | "strength" | "new" | "starter" };
    const rows: Row[] = CANDIDATE_THEMES.map((theme) => {
      const tp = themes[theme];
      const nb = tp?.nb ?? 0;
      const rd = tp?.gl?.d ?? 500;
      const trusted = nb >= MIN_SOLVES_TRUSTED && rd <= MAX_RD_TRUSTED;
      if (trusted) {
        const r = Math.round(tp.gl?.r ?? globalR);
        const d = r - globalR;
        return { theme, yourRating: r, delta: d, solves: nb, provisional: false,
                 reason: d <= -50 ? "weakness" : d >= 50 ? "strength" : "starter" as const };
      }
      return { theme,
               yourRating: nb > 0 ? Math.round(tp.gl?.r ?? globalR) : null,
               delta: null,
               solves: nb,
               provisional: nb > 0,   // played but not trusted → provisional
               reason: "new" as const };
    });

    // Pick 3 biggest weaknesses (most negative delta), 2 strengths (biggest
    // positive delta — build confidence), 2 untried themes (variety), then
    // interleave to mix easy + tough. Cap total at 7 so the chip strip fits
    // in one line on desktop. If a bucket is short, other buckets grow to
    // keep the total.
    const weaknesses = rows.filter((r) => r.reason === "weakness").sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0)).slice(0, 3);
    const strengths = rows.filter((r) => r.reason === "strength").sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0)).slice(0, 2);
    const untried = rows.filter((r) => r.reason === "new").sort(() => Math.random() - 0.5).slice(0, 2);
    // Interleave: weakness1, strength1, new1, weakness2, ..., so the chip
    // strip alternates rather than piling weaknesses first.
    const zipped: Row[] = [];
    for (let i = 0; i < Math.max(weaknesses.length, strengths.length, untried.length); i++) {
      if (weaknesses[i]) zipped.push(weaknesses[i]!);
      if (strengths[i]) zipped.push(strengths[i]!);
      if (untried[i]) zipped.push(untried[i]!);
    }
    // Guarantee at least 5 items even if the user has few weaknesses/strengths
    // by padding from the starter mix (dedup'd).
    const seen = new Set(zipped.map((r) => r.theme));
    for (const t of STARTER) {
      if (zipped.length >= 7) break;
      if (seen.has(t)) continue;
      const tp = themes[t];
      const nb = tp?.nb ?? 0;
      const rd = tp?.gl?.d ?? 500;
      zipped.push({
        theme: t,
        yourRating: nb > 0 ? Math.round(tp.gl?.r ?? globalR) : null,
        delta: nb > 0 ? Math.round((tp.gl?.r ?? globalR) - globalR) : null,
        solves: nb,
        provisional: !(nb >= MIN_SOLVES_TRUSTED && rd <= MAX_RD_TRUSTED),
        reason: "starter",
      });
      seen.add(t);
    }
    return { global: globalR, globalProvisional, items: zipped.slice(0, 7) };
  }

  /** Phase 8c: bump the user's daily-puzzle attendance streak if this solve
   *  really was TODAY's daily puzzle. Server-verified against dailyPuzzles so
   *  a client-side `daily: true` hint can't pad someone's streak with random
   *  puzzles. Streak rules: today = no-op (idempotent), yesterday = +1, gap
   *  = reset to 1. Attempting counts — win or loss — because the value of
   *  the daily is showing up, not being right. */
  private async bumpDailyStreak(userId: string, puzzleId: string): Promise<{ current: number; longest: number } | null> {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const daily = await this.conn.db!.collection("dailyPuzzles").findOne({ _id: today as any });
    if (!daily || String(daily.puzzleId) !== String(puzzleId)) return null;   // hint didn't match
    const users = this.conn.db!.collection("users");
    const u: any = await users.findOne({ _id: userId as any }, { projection: { dailyPuzzleStreak: 1 } as any });
    const prev = u?.dailyPuzzleStreak ?? { current: 0, longest: 0, lastDate: null };
    if (prev.lastDate === today) return { current: prev.current, longest: prev.longest };
    const current = prev.lastDate === yesterday ? (prev.current || 0) + 1 : 1;
    const longest = Math.max(prev.longest || 0, current);
    await users.updateOne(
      { _id: userId as any },
      { $set: { dailyPuzzleStreak: { current, longest, lastDate: today } } },
    );
    return { current, longest };
  }

  /** Bump the student's active homework tasks whose puzzle_pack theme matches
   *  any theme on the just-solved puzzle. One solve can credit multiple
   *  tasks across multiple coaches (e.g. a `promotion` solve credits both
   *  Raagul's advancedPawn/promotion task AND Gunachess's promotion task).
   *  Clamped at target; only bumps if current < target so we never overshoot.
   *  Silent on any error — homework credit is a nice-to-have; a Mongo hiccup
   *  must never break the puzzle-complete flow. Owner ask 2026-08-25. */
  private async autoCreditHomework(userId: string, puzzleThemes: string[]): Promise<void> {
    const themeSet = new Set(puzzleThemes.filter((t) => typeof t === "string"));
    if (themeSet.size === 0) return;
    const hwCol = this.conn.db!.collection("homework");
    // Only pending ("assigned" or "in_progress") — completed homework is not
    // touched. Sorted by assignedAt so the oldest coach's assignment gets
    // credited first when multiple homeworks share the same theme (fair
    // to the coach who assigned first).
    const active: any[] = await hwCol.find(
      { studentId: userId, status: { $in: ["assigned", "in_progress"] } },
      { projection: { tasks: 1, progress: 1, status: 1 } },
    ).sort({ assignedAt: 1 }).limit(20).toArray();
    if (!active.length) return;
    for (const hw of active) {
      const tasks = Array.isArray(hw.tasks) ? hw.tasks : [];
      const oldProgress: Record<string, number> = { ...(hw.progress || {}) };
      let mutated = false;
      for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        if (!t || t.kind !== "puzzle_pack" || !t.theme || !themeSet.has(t.theme)) continue;
        const cur = Number(oldProgress[String(i)] ?? 0);
        const target = Number(t.targetCount ?? 5);
        if (cur >= target) continue;
        oldProgress[String(i)] = cur + 1;
        mutated = true;
      }
      if (!mutated) continue;
      // Recompute status like homework.service.ts::advance does.
      const allDone = tasks.every((t: any, i: number) => {
        const c = Number(oldProgress[String(i)] ?? 0);
        const tgt = t?.kind === "puzzle_pack" ? Number(t.targetCount ?? 5) : 1;
        return c >= tgt;
      });
      const set: any = { progress: oldProgress };
      if (allDone) { set.status = "completed"; set.completedAt = new Date(); }
      else if (hw.status === "assigned") set.status = "in_progress";
      await hwCol.updateOne({ _id: hw._id }, { $set: set });
    }
  }

  async complete(id: string, body: { win: boolean; userId?: string | null; hint?: boolean; mode?: string; rating?: number; deviation?: number; theme?: string; difficulty?: string; ms?: number; moves_ms?: number[]; wrong?: string; daily?: boolean }) {
    const pz = await this.col().findOne({ _id: id as any });
    if (!pz) return null;
    await this.col().updateOne({ _id: id as any }, { $inc: { plays: 1 } });
    const puzzleGlicko = pz.glicko || { r: 1500, d: 500, v: DEFAULT_VOLATILITY };
    const { win, userId, hint, mode } = body;

    if (userId) {
      const perfsCol = this.conn.db!.collection("userperfs");
      const doc: any = (await perfsCol.findOne({ _id: userId as any })) || {};
      const key = mode === "blindfold" ? "blindfold" : "puzzle";
      // Fresh puzzle seed for a first-time solver: use 1200 for regular
      // puzzles, 800 for blindfold. Regular starts at 1200 (owner directive
      // 2026-08-23) — mid-way between the Lichess default of 1500 and a
      // beginner floor of 800. Below 1500 means kids aren't crushed on
      // their first solves; above 800 means adult beginners aren't
      // patronized by trivial puzzles. Strong players still climb quickly
      // via Glicko convergence with d=500 initially.
      const perf = doc[key] || { gl: { r: (key === "blindfold" ? 800 : 1200), d: 500, v: DEFAULT_VOLATILITY }, nb: 0, re: [], la: null };
      if (hint) return { win, ratingDiff: 0, rating: Math.round(perf.gl.r), glicko: perf.gl };

      // Has this user already played this exact puzzle? Drives SAFEGUARD 5 below.
      const alreadyPlayed = !!(await this.conn.db!.collection("rounds")
        .findOne({ _id: `${userId}:${id}` as any }, { projection: { _id: 1 } as any }));

      // ── SAFEGUARD 1: DAILY_RATED_LIMIT (Lichess canUpdatePuzzleRating) ──
      // Cap RATING UPDATES at 300/day/user. The solve still counts as a
      // played round, they see the correct move — they just don't move
      // their rating any more today. Kills marathon farming. Cheap check:
      // one countDocuments on the indexed rounds prefix range.
      let overDailyLimit = false;
      {
        const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
        const uidRe2 = { $regex: `^${userId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:` } as any;
        const todayRatedRounds = await this.conn.db!.collection("rounds").countDocuments({
          _id: uidRe2,
          k: mode === "blindfold" ? "blindfold" : "puzzle",
          d: { $gte: startOfDay },
          // rd:0 rows are already un-rated (hint/limit-hit) — don't count them
          // against the ceiling or a spam of failed hint-plays could lock a
          // legit user out. Only actual rating movements accumulate.
          rd: { $ne: 0 },
        });
        overDailyLimit = todayRatedRounds >= DAILY_RATED_LIMIT;
      }
      if (overDailyLimit) {
        return { win, ratingDiff: 0, rating: Math.round(perf.gl.r), glicko: perf.gl, dailyLimit: true };
      }
      // Rating update — Lichess weighted-average model (owner 2026-08-24).
      // Theme decides how much of the raw Glicko delta gets kept:
      //   mix (no filter)                       → 100% of Glicko
      //   neutral (endgame/master/opening)      → 70% win / 80% loss
      //   hinting (fork/pin/skewer/sacrifice)   → 20% win / 70% loss
      //   obvious (mateIn1, all *Mates)         → 10% win / 40% loss
      // Losses always heavier than wins → naturally anti-inflation.
      const selectedTheme = body.theme || null;

      // Session fatigue (owner 2026-08-24, extended to losses 2026-08-31):
      // dampens SAME-THEME grinding — SYMMETRIC on wins and losses.
      // Formula:
      //   themeFatigue = 1 / (1 + sameThemeSolves30min / 15)
      //   → 1st=1.00, 15th=0.50, 30th=0.33, 60th=0.20
      //
      // Rules:
      // - Fires ONLY when user picks a specific theme AND has repeated it.
      // - Mix mode → NO fatigue (mix is inherently varied; each solve is a
      //   different theme, so it's healthy practice, not grinding). Owner
      //   check 2026-08-24: deepakcharanv's 39 mix-mode solves were
      //   incorrectly zeroed by earlier volume-fatigue design.
      // - Rotating between different themes → NO fatigue (theme-fatigue
      //   counts only same-theme solves).
      // - Losses now ALSO dampened (owner 2026-08-31, akshayprathab report):
      //   under wins-only fatigue, kid grinds 30 mateIn1s → gains ~+40 total
      //   (dampened to 33% weight) → one fumble at full weight cost him −12
      //   → net-negative even at 90%+ win rate. Under symmetric fatigue, if
      //   the win signal is noisy (grind = pattern memorization not skill),
      //   the loss signal is equally noisy in the same session — dampen both.
      //   Mix and fresh-theme losses stay at full weight (still meaningful).
      //
      // Reference: deepakcharanv Aug 22 grinded 143 mateIn1s → +525 rating
      // under old model. Under this design mateIn1 gain drops to ~+124.
      // A kid who switches themes or plays mix gets full rewards.
      let fatigueMul = 1;
      if (selectedTheme && selectedTheme !== "mix") {
        const t30m = new Date(Date.now() - 30 * 60_000);
        const uidRe = { $regex: `^${userId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:` } as any;
        const themeCount = await this.conn.db!.collection("rounds").countDocuments({
          _id: uidRe, k: "puzzle", sel: selectedTheme, d: { $gte: t30m },
        });
        // Difficulty-aware fatigue divisor (2026-08-31, deepakcharanv report):
        // hardest/harder mode serves puzzles rated +300/+600 above the user,
        // so raw Glicko deltas are ~3-4× larger. Fatigue applied at the same
        // rate leaves grinders net-positive even at deep grind (46 hardest
        // mateIn2 in one day → +99 pts under n/15 formula). Steeper divisor
        // on higher tiers so the fatigue curve keeps up with the bigger raw
        // gains. Normal/easier stays at 15 (existing behavior unchanged).
        const div = body.difficulty === "hardest" ? 8
                  : body.difficulty === "harder"  ? 10
                  : 15;
        if (themeCount > 0) fatigueMul = 1 / (1 + themeCount / div);
      }

      const upd = updatePuzzleRating(perf, puzzleGlicko, win, selectedTheme);
      // Apply fatigue by scaling the delta toward zero (never past it).
      // Works for both wins (positive delta shrinks) and losses (negative delta
      // shrinks in magnitude — a −12 loss becomes −4 at fatigueMul=0.33).
      if (fatigueMul < 1 && upd.ratingDiff !== 0) {
        const oldR = perf.gl.r;
        const dampenedDelta = Math.round(upd.ratingDiff * fatigueMul);
        upd.userPerf.gl.r = oldR + dampenedDelta;
        upd.ratingDiff = dampenedDelta;
      }

      // ── SAFEGUARD 5: one RATED attempt per puzzle (Lichess rule) ──
      // A repeat attempt at a puzzle this user has already played is unrated.
      // The picker excludes played ids, so a repeat only reaches here via
      // review / daily / a page reload mid-puzzle — and a reload after a wrong
      // move was charging the SAME miss twice (Harinita report 2026-09-04).
      // The round row + homework credit below still run; only the rating and
      // the solve counter are frozen.
      if (alreadyPlayed) {
        upd.userPerf = perf;
        upd.ratingDiff = 0;
      }

      // ── SAFEGUARD 4: nb-inflation on same-theme grinds (2026-08-30) ──
      // Owner report: mageswaran grinded 200/200 smotheredMate solves in a
      // single session — pattern-matches a 1-move mate in ~1.7s and his
      // roster card shows a fake "721 puzzles solved" activity score.
      // Rule: when a WIN is heavily fatigued (fatigueMul < 0.5, i.e. the
      // student has already solved 15+ of THIS theme in the past 30 min),
      // don't increment nb. The rounds row still upserts so the puzzle
      // isn't re-served, and the rating still moves by the dampened amount —
      // we just stop the solve counter from being farmable.
      //
      // Losses ALWAYS count in nb (legit misses even during a grind mean
      // the student is actually engaged; ignoring them would hide poor
      // performance the coach needs to see).
      //
      // "mix" mode is exempt (fatigueMul is always 1 there — mix rotates
      // through themes so each solve is genuinely different).
      if (win && fatigueMul < 0.5) {
        upd.userPerf.nb = perf.nb || 0;   // roll back the +1 bump from updatePuzzleRating
      }

      // ── SAFEGUARD 2: dubiousSolve — implausibly fast win on a much-
      // harder puzzle. Records a flag on the round for later inspection;
      // does not block the rating update (Lichess uses the flag to only
      // gate PUZZLE-side glicko, which we don't currently write anyway).
      // False positives are non-punitive here — just a paper trail so we
      // can spot chronic offenders across many rounds.
      const solveMs = typeof body.ms === "number" && isFinite(body.ms) ? body.ms : undefined;
      const dubious = isDubiousSolve(perf.gl.r, puzzleGlicko.r, solveMs, win);

      // ── SAFEGUARD 3: crazyGlicko — huge rating swing on an established
      // user. Post-weight/fatigue, an established player (nb≥30, d≤110)
      // shouldn't move ±150 in a single puzzle. Log-only (visible in
      // pm2 logs) so we can trace outliers without shipping a metric
      // pipeline.
      if (isCrazyRatingDelta(perf, upd.ratingDiff)) {
        console.warn(`[crazyGlicko] user=${userId} puzzle=${id} sel=${selectedTheme ?? "mix"} preR=${perf.gl.r} preD=${perf.gl.d} nb=${perf.nb ?? 0} rd=${upd.ratingDiff} pr=${puzzleGlicko.r} win=${win} fatigue=${fatigueMul} dubious=${dubious}`);
      }
      const sets: Record<string, any> = { [key]: upd.userPerf };

      // Per-theme ratings — updated with the SAME weighted-average model.
      // Each theme on the puzzle gets its own Glicko track. NOT used by the
      // picker anymore (which uses global only) — kept for display + weakness
      // detection. Clamped to global ± 300 on write to prevent drift.
      if (Array.isArray(pz.themes)) {
        const themeNs = key === "blindfold" ? "themesBf" : "themes";
        const globalR = upd.userPerf.gl.r;
        const startR = key === "blindfold" ? 800 : 1500;
        for (const t of pz.themes) {
          if (PuzzlesService.UNRATED.has(t) || typeof t !== "string" || !/^[a-zA-Z0-9]+$/.test(t)) continue;
          const tPerf = doc[themeNs]?.[t] || { gl: { r: startR, d: 500, v: DEFAULT_VOLATILITY }, nb: 0, re: [], la: null };
          // Same weighted-average model, but pass the theme name (not the
          // user's selected filter) so weight matches the puzzle's actual
          // theme. Result: fork puzzle updates fork per-theme with 20% weight
          // even if user picked "mix" mode.
          const tUpd = updatePuzzleRating(tPerf, puzzleGlicko, win, t);
          const tOut = tUpd.userPerf;
          // Clamp per-theme to global ± 300 so drift can't accumulate
          // (root cause of srinithi's -347 disaster). This is our safety
          // net; in practice the weighted-average dampening rarely lets
          // per-theme drift this far anyway.
          const clamped = Math.max(globalR - 300, Math.min(globalR + 300, tOut.gl.r));
          if (clamped !== tOut.gl.r) tOut.gl.r = clamped;
          sets[`${themeNs}.${t}`] = tOut;
        }
      }
      if (!alreadyPlayed) await perfsCol.updateOne({ _id: userId as any }, { $set: sets }, { upsert: true });
      // Solve time (ms): client-timed from puzzle-load to first submit. Sanity-clamp
      // to [0, 30min] to reject clock skew / tabbed-away sessions from polluting
      // theme-median stats later.
      const msRaw = typeof body.ms === "number" && isFinite(body.ms) ? Math.round(body.ms) : null;
      const ms = msRaw != null && msRaw >= 0 && msRaw <= 30 * 60 * 1000 ? msRaw : null;
      // Per-move deltas from the client. Sanity-clamp each entry to
      // [0, 30min] to reject clock skew / tabbed-away sessions; cap the
      // array at 32 entries (deepest puzzle line we serve is well under
      // that). Owner ask 2026-08-27: needed for cheat detection —
      // engine users show flat inter-move gaps regardless of position.
      const mvRaw = Array.isArray(body.moves_ms) ? body.moves_ms : null;
      const mv_ms = mvRaw
        ? mvRaw
            .slice(0, 32)
            .map((n) => (typeof n === "number" && isFinite(n) ? Math.round(n) : -1))
            .filter((n) => n >= 0 && n <= 30 * 60 * 1000)
        : null;
      // Wrong move (UCI, e.g. "e2e4" / "e7e8q"). Only stored on losses; validated
      // to a 4-5 char UCI so we never persist arbitrary user input on the rounds row.
      const wrongRaw = typeof body.wrong === "string" ? body.wrong.trim().toLowerCase() : "";
      const wrong = !win && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(wrongRaw) ? wrongRaw : null;
      // nc = "not counted". Set when the solve was heavily fatigued
      // (SAFEGUARD 4). Both the leaderboard aggregation and the roster
      // puzzleSolves7d rollup filter these out so grind farming can't
      // inflate visible activity numbers. Losses NEVER get flagged.
      const notCounted = win && fatigueMul < 0.5;
      const roundPatch: Record<string, any> = {
        w: win,
        d: new Date(),
        rd: upd.ratingDiff,                                 // rating change this solve
        r: Math.round(upd.userPerf.gl.r),                   // user rating after
        pr: Math.round(puzzleGlicko.r ?? 1500),             // puzzle rating
        th: Array.isArray(pz.themes) ? pz.themes : [],      // puzzle themes (for categorising)
        k: key,                                             // "puzzle" | "blindfold"
        sel: body.theme ?? null,                            // selected filter ("mix" = All themes)
        ...(ms != null ? { ms } : {}),                      // solve time in ms (missing on older rows)
        ...(mv_ms && mv_ms.length ? { mv_ms } : {}),        // per-move deltas — [t1, t2-t1, ...]
        ...(wrong != null ? { wr: wrong } : {}),            // wrong-move UCI (misses only, missing on wins)
        ...(dubious ? { dub: true } : {}),                  // flagged suspicious solve (fast win on >+300 pr)
        // Difficulty the user was on when they solved this — stored so
        // history tiles can show it (Easier/Easiest are practice-mode
        // hints so kids can spot why their rating moved less).
        ...(typeof body.difficulty === "string" && ["easiest","easier","normal","harder","hardest"].includes(body.difficulty) ? { df: body.difficulty } : {}),
      };
      const roundUpd: Record<string, any> = { $set: roundPatch };
      // On WIN + heavy fatigue, mark nc:true. On WIN + no fatigue, unset any
      // stale flag from a previous re-solve of the same puzzle (someone
      // re-took a puzzle they earlier fatigue-grinded and this time did it
      // normally — reward them). On loss, leave nc alone.
      if (win) {
        if (notCounted) roundPatch.nc = true;
        else roundUpd.$unset = { nc: "" };
      }
      await this.conn.db!.collection("rounds").updateOne(
        { _id: `${userId}:${id}` as any },
        roundUpd,
        { upsert: true },
      );
      // Auto-credit homework. Owner ask 2026-08-25: Harini solved puzzles
      // that matched Raagul's assigned themes, but Raagul saw progress:{}
      // because the advance bump only fires on the `?hw=<id>` deep-link path.
      // Students naturally practise from the general trainer without ever
      // clicking through the homework page, so their coach's homework never
      // moved. Now: on every WIN in `puzzle` mode by a signed-in student,
      // look up their pending homework tasks and bump any puzzle_pack whose
      // theme is in the just-solved puzzle's themes. Clamped at target,
      // deduped (updateOne with $inc), status auto-promoted to in_progress
      // or completed. Losses do NOT count — same anti-farming rule as the
      // rating fatigue system.
      if (win && key === "puzzle" && Array.isArray(pz.themes) && pz.themes.length > 0) {
        void this.autoCreditHomework(userId, pz.themes as string[]).catch(() => { /* silent */ });
      }
      // Phase 7n + 7o: milestone crossings on both rating AND solve-count.
      // Only for regular puzzle mode — blindfold's rating distribution is
      // different enough that the round-100 thresholds wouldn't feel meaningful.
      const beforeNb = perf.nb || 0;
      const afterNb  = upd.userPerf.nb || 0;
      const milestone = key === "puzzle"
        ? await recordAndCelebrate(this.conn, this.push, userId, perf.gl.r, upd.userPerf.gl.r, beforeNb, afterNb).catch(() => null)
        : null;
      // Phase 8c: daily-puzzle attendance streak. `body.daily` is a client
      // hint; bumpDailyStreak verifies against today's dailyPuzzles doc so
      // it can't be gamed.
      const dailyStreak = body.daily
        ? await this.bumpDailyStreak(userId, id).catch(() => null)
        : null;
      return { win, ratingDiff: upd.ratingDiff, rating: upd.userPerf.gl.r, glicko: upd.userPerf.gl, provisional: isProvisional(upd.userPerf), milestone, dailyStreak, dubious: dubious || undefined };
    }

    // guest — one-off, non-persisted
    const r = body.rating || 1500, dev = body.deviation || 500;
    if (hint) return { win, ratingDiff: 0, rating: r, glicko: { r, d: dev, v: DEFAULT_VOLATILITY } };
    const upd = updatePuzzleRating({ gl: { r, d: dev, v: DEFAULT_VOLATILITY }, nb: 0, re: [], la: null }, puzzleGlicko, win, body.theme || null);
    return { win, ratingDiff: upd.ratingDiff, rating: upd.userPerf.gl.r, glicko: upd.userPerf.gl };
  }
}
