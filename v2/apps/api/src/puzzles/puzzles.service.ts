import { Injectable } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { updatePuzzleRating, DEFAULT_VOLATILITY } from "../glicko/glicko";
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
  private async playedIds(userId: string): Promise<string[]> {
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
    for (const r of rows as any[]) {
      const id = String(r._id).slice(lo.length);
      if (r.w) out.push(id);                                          // solved -> never repeat
      else if (r.d && new Date(r.d) >= cutoff) out.push(id);          // failed recently -> hold off
      // failed long ago -> eligible to retry
    }
    return out;
  }

  async random(theme: string, difficulty: string, rating: number, maxPc?: number, userId?: string | null, section?: string, player?: string, mode?: string) {
    // CL-9156b: use the user's CURRENT puzzle rating from userperfs as the base,
    // not the client-passed `rating` (which lags — frozen near page load — so as
    // the user climbs during a session, puzzles were served ~100-150 below).
    let baseRating = rating;
    if (userId) {
      // Blindfold is its own skill: its serving uses the BLINDFOLD rating and
      // blindfold theme ratings (themesBf), fully separate from regular puzzles.
      const bf = mode === "blindfold";
      const perfKey = bf ? "blindfold" : "puzzle";
      const themeNs = bf ? "themesBf" : "themes";
      const themed = theme && theme !== "mix" && /^[a-zA-Z0-9]+$/.test(theme);
      const proj: Record<string, number> = { [`${perfKey}.gl.r`]: 1 };
      if (themed) { proj[`${themeNs}.${theme}.gl.r`] = 1; proj[`${themeNs}.${theme}.nb`] = 1; }
      const up = await this.conn.db!.collection("userperfs").findOne({ _id: userId as any }, { projection: proj });
      const liveR = (up as any)?.[perfKey]?.gl?.r;
      if (typeof liveR === "number" && liveR > 0) baseRating = liveR;
      // Theme training uses the THEME rating once it has a little signal — a player
      // strong in forks but weak in endgames gets correctly-hard puzzles in each.
      const tp = themed ? (up as any)?.[themeNs]?.[theme] : null;
      if (tp && typeof tp.gl?.r === "number" && (tp.nb ?? 0) >= 3) baseRating = tp.gl.r;
    }
    const target = clamp(baseRating + (DIFF[difficulty] ?? 0), 400, 3000);
    const played = userId ? await this.playedIds(userId) : [];
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
    if (!maxPc || maxPc >= 32) {
      const band = String(Math.max(0, Math.round(target))).padStart(4, "0");
      const esc = theme.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const paths = this.conn.db!.collection("paths");
      for (const tier of ["top", "good", "all"]) {
        const key = `${theme}|${tier}|${band}`;
        const path = await paths.findOne({
          _id: { $regex: `^${esc}\\|${tier}\\|` } as any,
          min: { $lte: key },
          max: { $gte: key },
        });
        const ids: string[] = (path?.ids as string[]) || [];
        if (!ids.length) continue;
        const avail = ids.filter((id) => !playedSet.has(id));
        if (!avail.length) continue; // user cleared this pool -> next tier, then fresh $sample fallback
        const pick = avail[Math.floor(Math.random() * avail.length)]!;
        const d = await this.col().findOne({ _id: pick as any });
        if (d) return applyLastMove(fmtPuzzle(d));
      }
    }

    // ── FALLBACK: $match + $sample (rare: piece-count filter, exotic theme, or missing pool). ──
    const flex = Math.round(100 + Math.abs(1500 - target) / 4);
    const themeQ = theme && theme !== "mix" ? { themes: theme } : {};
    const pcQ = maxPc && maxPc < 32 ? { pieceCount: { $lte: maxPc } } : {};
    const dedupQ = played.length ? { _id: { $nin: played } } : {};
    const srcExcl = { source: { $ne: "broadcast" } }; // keep GM section out of normal play
    const sample = async (m: any) => {
      const d = await this.col().aggregate([{ $match: m }, { $sample: { size: 1 } }]).toArray();
      return d.length ? applyLastMove(fmtPuzzle(d[0])) : null;
    };
    const tiers: any[] = [
      { vote: { $gte: 0.75 }, plays: { $gte: 100 } },
      { vote: { $gte: 0.5 }, plays: { $gte: 20 } },
      {},
    ];
    for (const tier of tiers) {
      const pz = await sample({ "glicko.r": { $gte: target - flex, $lte: target + flex }, ...tier, ...themeQ, ...pcQ, ...dedupQ, ...srcExcl });
      if (pz) return pz;
    }
    const wide = await sample({ "glicko.r": { $gte: target - 400, $lte: target + 400 }, ...themeQ, ...pcQ, ...dedupQ, ...srcExcl });
    if (wide) return wide;
    if (played.length) {
      const any = await sample({ "glicko.r": { $gte: target - 400, $lte: target + 400 }, ...themeQ, ...pcQ, ...srcExcl });
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
    return {
      loggedIn: true,
      global: { rating: Math.round(p.puzzle?.gl?.r ?? 1500), rd: Math.round(p.puzzle?.gl?.d ?? 500), games: p.puzzle?.nb ?? 0 },
      blindfold: p.blindfold ? { rating: Math.round(p.blindfold.gl?.r ?? 800), games: p.blindfold.nb ?? 0 } : null,
      totals: { attempted: puzzleRounds.length, wins, accuracy: puzzleRounds.length ? Math.round((wins / puzzleRounds.length) * 100) : 0 },
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

  async complete(id: string, body: { win: boolean; userId?: string | null; hint?: boolean; mode?: string; rating?: number; deviation?: number; theme?: string; ms?: number; wrong?: string }) {
    const pz = await this.col().findOne({ _id: id as any });
    if (!pz) return null;
    await this.col().updateOne({ _id: id as any }, { $inc: { plays: 1 } });
    const puzzleGlicko = pz.glicko || { r: 1500, d: 500, v: DEFAULT_VOLATILITY };
    const { win, userId, hint, mode } = body;

    if (userId) {
      const perfsCol = this.conn.db!.collection("userperfs");
      const doc: any = (await perfsCol.findOne({ _id: userId as any })) || {};
      const key = mode === "blindfold" ? "blindfold" : "puzzle";
      const perf = doc[key] || { gl: { r: key === "blindfold" ? 800 : 1500, d: 500, v: DEFAULT_VOLATILITY }, nb: 0, re: [], la: null };
      if (hint) return { win, ratingDiff: 0, rating: Math.round(perf.gl.r), glicko: perf.gl };
      const upd = updatePuzzleRating(perf, puzzleGlicko, win);
      const sets: Record<string, any> = { [key]: upd.userPerf };
      // Per-theme Glicko ratings (owner 2026-07-08): every rated solve also rates the
      // puzzle's MEANINGFUL themes, so the dashboard shows real strengths/weaknesses
      // and theme training serves difficulty from the theme rating. Noise tags
      // (lengths, goals, origins) are not rated. Regular puzzle mode only.
      if (Array.isArray(pz.themes)) {
        const themeNs = key === "blindfold" ? "themesBf" : "themes"; // blindfold themes rated separately
        const startR = key === "blindfold" ? 800 : 1500;
        for (const t of pz.themes) {
          if (PuzzlesService.UNRATED.has(t) || typeof t !== "string" || !/^[a-zA-Z0-9]+$/.test(t)) continue;
          const tPerf = doc[themeNs]?.[t] || { gl: { r: startR, d: 500, v: DEFAULT_VOLATILITY }, nb: 0, re: [], la: null };
          const tUpd = updatePuzzleRating(tPerf, puzzleGlicko, win);
          sets[`${themeNs}.${t}`] = tUpd.userPerf;
        }
      }
      await perfsCol.updateOne({ _id: userId as any }, { $set: sets }, { upsert: true });
      // Solve time (ms): client-timed from puzzle-load to first submit. Sanity-clamp
      // to [0, 30min] to reject clock skew / tabbed-away sessions from polluting
      // theme-median stats later.
      const msRaw = typeof body.ms === "number" && isFinite(body.ms) ? Math.round(body.ms) : null;
      const ms = msRaw != null && msRaw >= 0 && msRaw <= 30 * 60 * 1000 ? msRaw : null;
      // Wrong move (UCI, e.g. "e2e4" / "e7e8q"). Only stored on losses; validated
      // to a 4-5 char UCI so we never persist arbitrary user input on the rounds row.
      const wrongRaw = typeof body.wrong === "string" ? body.wrong.trim().toLowerCase() : "";
      const wrong = !win && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(wrongRaw) ? wrongRaw : null;
      await this.conn.db!.collection("rounds").updateOne(
        { _id: `${userId}:${id}` as any },
        { $set: {
          w: win,
          d: new Date(),
          rd: upd.ratingDiff,                                 // rating change this solve
          r: Math.round(upd.userPerf.gl.r),                   // user rating after
          pr: Math.round(puzzleGlicko.r ?? 1500),             // puzzle rating
          th: Array.isArray(pz.themes) ? pz.themes : [],      // puzzle themes (for categorising)
          k: key,                                             // "puzzle" | "blindfold"
          sel: body.theme ?? null,                            // selected filter ("mix" = All themes)
          ...(ms != null ? { ms } : {}),                      // solve time in ms (missing on older rows)
          ...(wrong != null ? { wr: wrong } : {}),            // wrong-move UCI (misses only, missing on wins)
        } },
        { upsert: true },
      );
      // Phase 7n + 7o: milestone crossings on both rating AND solve-count.
      // Only for regular puzzle mode — blindfold's rating distribution is
      // different enough that the round-100 thresholds wouldn't feel meaningful.
      const beforeNb = perf.nb || 0;
      const afterNb  = upd.userPerf.nb || 0;
      const milestone = key === "puzzle"
        ? await recordAndCelebrate(this.conn, this.push, userId, perf.gl.r, upd.userPerf.gl.r, beforeNb, afterNb).catch(() => null)
        : null;
      return { win, ratingDiff: upd.ratingDiff, rating: upd.userPerf.gl.r, glicko: upd.userPerf.gl, milestone };
    }

    // guest — one-off, non-persisted
    const r = body.rating || 1500, dev = body.deviation || 500;
    if (hint) return { win, ratingDiff: 0, rating: r, glicko: { r, d: dev, v: DEFAULT_VOLATILITY } };
    const upd = updatePuzzleRating({ gl: { r, d: dev, v: DEFAULT_VOLATILITY }, nb: 0, re: [], la: null }, puzzleGlicko, win);
    return { win, ratingDiff: upd.ratingDiff, rating: upd.userPerf.gl.r, glicko: upd.userPerf.gl };
  }
}
