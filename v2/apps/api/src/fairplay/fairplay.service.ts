// Fair Play service — crowd baselines, trust scores, holds, owner notices,
// Monday digest. Single-process (setInterval on the API pod), like the digests.
//   collections: puzzleSolveStats {_id: puzzleId, medMs, n}   crowdBands {_id: band, medMs, n}
//               fairplay {_id: userId, academyId, score, band, components, evidence,
//                         windowStart, computedAt, hold, reviewSince, notifiedAt}
//               fairplayEvents {userId, academyId, kind, at, ...}
//               fairplayJobs {_id: "nightly"|"digest", lastRunAt}
import { Injectable, OnModuleInit } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { sendMail } from "../lib/mail";
import { scoreStudent, bandOf, withRetroFlags, DETECTOR_LIVE, type RoundLite, type ScoreResult, type ScoreExtras, type Band } from "./score";
import { train, handModel, modelScore as modelScoreOf, type Model, type LabelledExample } from "./model";
import { isDrill } from "../glicko/glicko";

export interface Decision { kind: "clear" | "hold" | "reset"; by: string; note: string; at: Date }

/** The live detector's rules, in the words a coach should read. */
export const RULES = [
  { rule: "fast_hard", label: "Fast on a hard puzzle", meaning: "a 2400+ puzzle won in under 4 s (2 s on a mate drill)" },
  { rule: "fast_above_level", label: "Fast far above level", meaning: "an 1800+ puzzle 300+ points above the player, won in under 4 s" },
  { rule: "metronome", label: "Engine rhythm", meaning: "a 2200+ puzzle under 8 s with every gap between moves 0.7–1.7 s — a line read off, not calculated" },
  { rule: "streak", label: "Run of fast hard wins", meaning: "a 2400+ puzzle under 6 s while 4 of the last 10 hard wins were also that fast" },
  { rule: "crowd_fast", label: "Faster than the crowd", meaning: "won in under 15% of the time everyone else needs on that puzzle" },
  { rule: "focus_loss", label: "Left the tab, moved on return", meaning: "the tab was hidden 3 s+ after the puzzle loaded and the first move came within 2 s of coming back" },
];
const ruleLabel = (r: string) => RULES.find((x) => x.rule === r)?.label ?? r;
const ruleMeaning = (r: string) => RULES.find((x) => x.rule === r)?.meaning ?? "";

/** Plain-words account of a score: what the engine saw, in the order it
 *  weighed it. Used by the detailed report (and reusable in mail). */
export function explainDetection(res: ScoreResult, reasons: Record<string, number>, focusLoss: number, peakDay: string | null, flaggedCount?: number): string[] {
  const c = res.components, e = res.evidence, out: string[] = [];
  const fmt = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  out.push(`Score ${peakDay ? `peaked at ${res.score} on ${fmt(peakDay)}` : `is ${res.score}`} — ${res.band === "review" ? "Review band (gains are held from here on)" : res.band === "watch" ? "Watch band (listed for a look, nothing withheld)" : "Clear"}.`);
  const rs = Object.entries(reasons).sort((a, b) => b[1] - a[1]);
  if (rs.length) out.push(`The detector flagged ${flaggedCount ?? res.evidence.flagged} solves (a solve can trip more than one rule): ${rs.map(([r, n]) => `${n} × ${ruleLabel(r)} (${ruleMeaning(r)})`).join("; ")}.${c.flags ? ` Worth ${c.flags} points — 8 per flagged solve beyond the first, capped at 40.` : ""}`);
  if (c.fastHard) out.push(`${e.hard.fast} wins on 2400+ puzzles took under 5 s — they won ${e.hard.winPct}% of ${e.hard.n} such puzzles with a median of ${e.hard.medianMs !== null ? (e.hard.medianMs / 1000).toFixed(1) : "?"} s; the academy's honest solvers take 25–50 s there. Worth ${c.fastHard} points.`);
  if (c.accuracy) out.push(`Accuracy went the wrong way: ${e.above.winPct ?? "—"}% on puzzles 200+ above their level (${e.above.n}) against ${e.atLevel.winPct ?? "—"}% at their level (${e.atLevel.n})${e.hard.winPct !== null && e.hard.winPct >= 85 ? `, and ${e.hard.winPct}% on 2400+` : ""}. Honest solving gets worse as puzzles get harder. Worth ${c.accuracy} points.`);
  if (c.crowd) out.push(`Their typical win took ${Math.round((e.crowdRatio ?? 0) * 100)}% of the time the rest of the academy needs on the same puzzles. Worth ${c.crowd} points.`);
  if (c.climb) out.push(`Rating climbed from ${e.ratingStart} to ${e.ratingEnd} in the window alongside the flags. Worth ${c.climb} points.`);
  if (c.themeFlat && e.themes) out.push(`Per-theme ratings sit within ±${e.themes.sd} across ${e.themes.n} themes — equally strong at everything, which honest players never are. Worth ${c.themeFlat} points.`);
  if (c.playGap && e.play) out.push(`Puzzle rating is ${e.play.gap} above their best live-game rating (${e.play.speed} ${e.play.r} over ${e.play.nb} games). Worth ${c.playGap} points.`);
  if (focusLoss) out.push(`On ${focusLoss} solves the tab left the trainer after the puzzle loaded${reasons.focus_loss ? `; ${reasons.focus_loss} of them had the move land within 2 s of coming back` : ""}.`);
  if (out.length === 1) out.push("No single rule fired hard; the listing came from several weak signals adding up.");
  return out;
}

const WINDOW_DAYS = 30;
const TICK_MS = 10 * 60 * 1000;
const NIGHTLY_UTC_HOUR = 21;      // 02:30 IST
const DIGEST_UTC_HOUR = 2;        // Monday 08:xx IST
const MONTHLY_UTC_HOUR = 3;       // 1st of the month, 08:30 IST
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || "https://chessguru.cc";
const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

@Injectable()
export class FairplayService implements OnModuleInit {
  private perPuzzle = new Map<string, { medMs: number; n: number }>();
  private perBand = new Map<number, number>();
  private statsLoadedAt = 0;
  private holdCache = new Map<string, { held: boolean; at: number }>();

  constructor(@InjectConnection() private readonly conn: Connection) {}

  onModuleInit(): void {
    setTimeout(() => { this.loadCrowdStats().catch(() => {}); }, 5_000);
    setInterval(() => { this.tick().catch((e) => console.warn("[fairplay] tick", e)); }, TICK_MS);
  }

  // ── crowd baselines ─────────────────────────────────────────────────────
  /** Typical (median) solve time per puzzle from every win with a time, plus a
   *  fallback per 100-point rating band. Cheap: rounds are tens of thousands. */
  async rebuildCrowdStats(): Promise<{ puzzles: number; bands: number }> {
    const db = this.conn.db!;
    const rows = await db.collection("rounds").aggregate([
      { $match: { w: true, ms: { $gt: 0, $lte: 1_800_000 }, pr: { $gt: 0 } } },
      { $project: { pid: { $arrayElemAt: [{ $split: ["$_id", ":"] }, 1] }, ms: 1, pr: 1 } },
      { $group: { _id: "$pid", medMs: { $median: { input: "$ms", method: "approximate" } }, n: { $sum: 1 }, pr: { $avg: "$pr" } } },
      { $match: { n: { $gte: 3 } } },
    ]).toArray();
    const stats = db.collection("puzzleSolveStats");
    if (rows.length) {
      await stats.deleteMany({});
      await stats.insertMany(rows.map((r) => ({ _id: r._id, medMs: Math.round(r.medMs), n: r.n, pr: Math.round(r.pr), updatedAt: new Date() })), { ordered: false });
    }
    const bands = await db.collection("rounds").aggregate([
      { $match: { w: true, ms: { $gt: 0, $lte: 1_800_000 }, pr: { $gt: 0 } } },
      { $project: { band: { $multiply: [{ $floor: { $divide: ["$pr", 100] } }, 100] }, ms: 1 } },
      { $group: { _id: "$band", medMs: { $median: { input: "$ms", method: "approximate" } }, n: { $sum: 1 } } },
      { $match: { n: { $gte: 20 } } },
    ]).toArray();
    const bc = db.collection("crowdBands");
    if (bands.length) {
      await bc.deleteMany({});
      await bc.insertMany(bands.map((b) => ({ _id: b._id, medMs: Math.round(b.medMs), n: b.n, updatedAt: new Date() })), { ordered: false });
    }
    await this.loadCrowdStats(true);
    return { puzzles: rows.length, bands: bands.length };
  }

  async loadCrowdStats(force = false): Promise<void> {
    if (!force && Date.now() - this.statsLoadedAt < 60 * 60 * 1000) return;
    const db = this.conn.db!;
    const per = await db.collection("puzzleSolveStats").find({}, { projection: { medMs: 1, n: 1 } as any }).toArray();
    this.perPuzzle = new Map(per.map((p: any) => [String(p._id), { medMs: p.medMs, n: p.n }]));
    const bands = await db.collection("crowdBands").find({}).toArray();
    this.perBand = new Map(bands.map((b: any) => [Number(b._id), b.medMs]));
    this.statsLoadedAt = Date.now();
  }

  /** Median ms the crowd needs on this puzzle (n ≥ 5), else on its rating band. */
  crowdMedianMs(pid: string, pr: number, bands: Map<number, number> = this.perBand): number | null {
    const p = this.perPuzzle.get(pid);
    if (p && p.n >= 5) return p.medMs;
    const band = Math.floor(pr / 100) * 100;
    return bands.get(band) ?? null;
  }

  /** Band medians with one student's own solves left out — a heavy solver
   *  would otherwise be a large share of "the crowd" on hard puzzles. Cached
   *  ten minutes per student. */
  private looCache = new Map<string, { bands: Map<number, number>; at: number }>();
  async bandsExcluding(userId: string): Promise<Map<number, number>> {
    const c = this.looCache.get(userId);
    if (c && Date.now() - c.at < 10 * 60 * 1000) return c.bands;
    const rows = await this.conn.db!.collection("rounds").aggregate([
      { $match: { w: true, ms: { $gt: 0, $lte: 1_800_000 }, pr: { $gt: 0 }, _id: { $not: { $regex: `^${esc(userId)}:` } } } },
      { $project: { band: { $multiply: [{ $floor: { $divide: ["$pr", 100] } }, 100] }, ms: 1 } },
      { $group: { _id: "$band", medMs: { $median: { input: "$ms", method: "approximate" } }, n: { $sum: 1 } } },
      { $match: { n: { $gte: 20 } } },
    ]).toArray();
    const bands = new Map<number, number>(rows.map((b: any) => [Number(b._id), Math.round(b.medMs)]));
    this.looCache.set(userId, { bands, at: Date.now() });
    return bands;
  }

  // ── scoring ─────────────────────────────────────────────────────────────
  async lastResetAt(userId: string): Promise<Date | null> {
    const r: any = await this.conn.db!.collection("ratingAdjustments").find({ userId }).sort({ at: -1 }).limit(1).next();
    return r?.at ? new Date(r.at) : null;
  }

  /** The window starts at the latest of 30 days ago, the last reset and the
   *  last Clear — a reset or a Clear is the review, so nothing before it
   *  counts again. */
  async roundsFor(userId: string, now = new Date()): Promise<{ rounds: RoundLite[]; windowStart: Date; lastReset: Date | null }> {
    const lastReset = await this.lastResetAt(userId);
    let windowStart = new Date(now.getTime() - WINDOW_DAYS * 86400000);
    if (lastReset && lastReset > windowStart) windowStart = lastReset;
    const fp: any = await this.conn.db!.collection("fairplay").findOne({ _id: userId as any }, { projection: { clearedAt: 1 } as any });
    if (fp?.clearedAt && new Date(fp.clearedAt) > windowStart) windowStart = new Date(fp.clearedAt);
    const rows = await this.conn.db!.collection("rounds")
      .find({ _id: { $regex: `^${esc(userId)}:` } as any, k: "puzzle", d: { $gte: windowStart, $lte: now } }, { projection: { d: 1, pr: 1, r: 1, w: 1, ms: 1, mv_ms: 1, dub: 1, dubr: 1, nc: 1, held: 1, th: 1, sel: 1 } as any })
      .sort({ d: 1 }).toArray();
    const rounds: RoundLite[] = rows
      .filter((x: any) => typeof x.pr === "number" && typeof x.r === "number")
      .map((x: any) => ({ pid: String(x._id).slice(userId.length + 1), d: new Date(x.d), pr: x.pr, r: x.r, w: !!x.w, ms: x.ms, mv_ms: x.mv_ms, dub: x.dub, dubr: x.dubr, nc: x.nc, held: x.held, th: x.th, sel: x.sel }));
    return { rounds, windowStart, lastReset };
  }

  /** Phase 2 signals from outside the solve list: per-theme rating spread
   *  and the best live-game rating. */
  async extrasFor(userId: string): Promise<ScoreExtras> {
    const up: any = await this.conn.db!.collection("userperfs").findOne({ _id: userId as any }, { projection: { "puzzle.gl.r": 1, themes: 1 } as any });
    const puzzleR = typeof up?.puzzle?.gl?.r === "number" ? Math.round(up.puzzle.gl.r) : null;
    let themes: ScoreExtras["themes"] = null;
    const rs: number[] = Object.values(up?.themes ?? {}).filter((v: any) => (v?.nb ?? 0) >= 20 && typeof v?.gl?.r === "number").map((v: any) => v.gl.r);
    if (rs.length) {
      const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
      const sd = Math.sqrt(rs.reduce((a, b) => a + (b - mean) ** 2, 0) / rs.length);
      themes = { n: rs.length, sd: Math.round(sd), min: Math.round(Math.min(...rs)), max: Math.round(Math.max(...rs)) };
    }
    let play: ScoreExtras["play"] = null;
    const lp: any = await this.conn.db!.collection("live_perfs").findOne({ _id: `u:${userId}` as any });
    if (lp && puzzleR !== null) {
      for (const [speed, v] of Object.entries(lp)) {
        const perf: any = v;
        if (speed === "_id" || !perf || typeof perf.gl?.r !== "number" || (perf.nb ?? 0) < 10) continue;
        if (!play || perf.gl.r > play.r) play = { speed, r: Math.round(perf.gl.r), nb: perf.nb, gap: puzzleR - Math.round(perf.gl.r) };
      }
    }
    return { themes, play, puzzleR };
  }

  /** Score one student, persist, and handle the transition into review. */
  async scoreUser(userId: string, academyId: string | null, opts: { notify?: boolean } = {}): Promise<ScoreResult & { hold: boolean; windowStart: Date; lastReset: Date | null; reviewSince: Date | null; decision: Decision | null; handScore: number; modelScore: number; modelActive: boolean }> {
    await this.loadCrowdStats();
    const now = new Date();
    const { rounds, windowStart, lastReset } = await this.roundsFor(userId, now);
    const loo = await this.bandsExcluding(userId);
    const extras = await this.extrasFor(userId);
    const hand = scoreStudent(rounds, (pid, pr) => this.crowdMedianMs(pid, pr, loo), extras);
    // Phase 3: the fitted model scores alongside (shadow) and, once active,
    // decides the band instead of the hand weights.
    const model = await this.currentModel();
    const mScore = modelScoreOf(model, hand.components);
    const score = model.active ? mScore : hand.score;
    const band: Band = model.active ? bandOf(mScore) : hand.band;
    const res: ScoreResult = { ...hand, score, band };
    const fp = this.conn.db!.collection("fairplay");
    const prev: any = await fp.findOne({ _id: userId as any });
    const wasReview = prev?.band === "review";
    const nowReview = res.band === "review";
    if (res.band === "watch" && prev?.band !== "watch" && prev?.band !== "review") {
      await this.conn.db!.collection("fairplayEvents").insertOne({ userId, academyId, kind: "watch", score: res.score, components: res.components, at: now });
    }
    // A hold is set on entering Review and lifts ONLY when the owner resets
    // (clearAfterReset) — a score that decays as the window slides never
    // releases it on its own. Owner decision 2026-09-08.
    const hold = !!prev?.hold || nowReview;
    const reviewSince: Date | null = nowReview ? (prev?.reviewSince ? new Date(prev.reviewSince) : now) : null;
    await fp.updateOne({ _id: userId as any }, { $set: { academyId, score: res.score, band: res.band, handScore: hand.score, modelScore: mScore, modelActive: model.active, components: res.components, evidence: res.evidence, windowStart, computedAt: now, hold, reviewSince, lastReset } }, { upsert: true });
    this.holdCache.set(userId, { held: hold, at: Date.now() });
    if (nowReview && !wasReview) {
      await this.conn.db!.collection("fairplayEvents").insertOne({ userId, academyId, kind: "review", score: res.score, components: res.components, at: now });
      if (opts.notify !== false) await this.notifyOwnerReview(userId, academyId, res).catch((e) => console.warn("[fairplay] notify", e?.message || e));
    }
    return { ...res, hold, windowStart, lastReset, reviewSince, decision: prev?.decision ?? null, handScore: hand.score, modelScore: mScore, modelActive: model.active };
  }

  // ── Phase 3: learn from decisions ───────────────────────────────────────
  private modelCache: { m: Model; at: number } | null = null;
  async currentModel(): Promise<Model> {
    if (this.modelCache && Date.now() - this.modelCache.at < 10 * 60 * 1000) return this.modelCache.m;
    const doc: any = await this.conn.db!.collection("fairplayModel").findOne({ _id: "current" as any });
    const m: Model = doc && Array.isArray(doc.weights) ? { weights: doc.weights, bias: doc.bias, trainedAt: new Date(doc.trainedAt), n: doc.n, cv: doc.cv, active: !!doc.active, reason: doc.reason } : handModel();
    this.modelCache = { m, at: Date.now() };
    return m;
  }

  /** Every coach/owner decision with the score components at the time, plus
   *  resets made before this service existed (their components replayed over
   *  the 30 days before the reset). */
  async labelledExamples(): Promise<LabelledExample[]> {
    const out: LabelledExample[] = [];
    const ev = await this.conn.db!.collection("fairplayEvents").find({ label: { $in: ["honest", "assisted"] }, components: { $type: "object" } }).sort({ at: 1 }).toArray();
    for (const e of ev as any[]) out.push({ userId: String(e.userId), label: e.label, components: e.components, source: `event:${e.kind}`, at: new Date(e.at) });
    const seen = new Set(out.filter((x) => x.label === "assisted").map((x) => x.userId + ":" + x.at.toISOString().slice(0, 10)));
    const resets = await this.conn.db!.collection("ratingAdjustments").find({}).sort({ at: 1 }).toArray();
    await this.loadCrowdStats();
    for (const r of resets as any[]) {
      const at = new Date(r.at); const userId = String(r.userId);
      if (seen.has(userId + ":" + at.toISOString().slice(0, 10))) continue;
      const rows = await this.conn.db!.collection("rounds")
        .find({ _id: { $regex: `^${esc(userId)}:` } as any, k: "puzzle", d: { $gte: new Date(at.getTime() - WINDOW_DAYS * 86400000), $lt: at } }, { projection: { d: 1, pr: 1, r: 1, w: 1, ms: 1, mv_ms: 1, dub: 1, dubr: 1, th: 1, sel: 1 } as any })
        .sort({ d: 1 }).toArray();
      const rounds: RoundLite[] = rows.filter((x: any) => typeof x.pr === "number" && typeof x.r === "number").map((x: any) => ({ pid: String(x._id).slice(userId.length + 1), d: new Date(x.d), pr: x.pr, r: x.r, w: !!x.w, ms: x.ms, mv_ms: x.mv_ms, dub: x.dub, dubr: x.dubr, th: x.th, sel: x.sel }));
      if (rounds.length < 20) continue;
      const loo = await this.bandsExcluding(userId);
      const res = scoreStudent(rounds, (pid, pr) => this.crowdMedianMs(pid, pr, loo));
      out.push({ userId, label: "assisted", components: res.components, source: "reset", at });
    }
    return out;
  }

  /** Refit from the labelled decisions; store; stays in shadow until the gate
   *  in model.ts passes. Nightly. */
  async refitModel(): Promise<Model> {
    const ex = await this.labelledExamples();
    const m = train(ex);
    await this.conn.db!.collection("fairplayModel").updateOne({ _id: "current" as any }, { $set: { ...m, examples: ex.length } }, { upsert: true });
    await this.conn.db!.collection("fairplayModelHistory").insertOne({ ...m, examples: ex.length });
    this.modelCache = { m, at: Date.now() };
    console.log(`[fairplay] model refit: ${ex.length} examples (${m.n.assisted} assisted / ${m.n.honest} honest), ${m.reason}`);
    return m;
  }

  /** Monthly fairness report for one academy: false alarms per 500 solves,
   *  catches, time to Review, model status. `month` = "YYYY-MM". */
  async fairnessReport(academyId: string, month: string, roster: string[] | null = null) {
    const [y, mo] = month.split("-").map(Number);
    if (!y || !mo) throw new Error("bad month");
    const start = new Date(Date.UTC(y, mo - 1, 1)), end = new Date(Date.UTC(y, mo, 1));
    const db = this.conn.db!;
    const sq: any = { academyId, role: "student" };
    if (roster) sq._id = { $in: roster };
    const students = await db.collection("users").find(sq, { projection: { _id: 1, username: 1, name: 1 } as any }).toArray();
    const ids = students.map((s: any) => String(s._id));
    const nm = new Map(students.map((s: any) => [String(s._id), s.name || s.username || String(s._id)]));
    const solvesAgg = await db.collection("rounds").aggregate([
      { $match: { k: "puzzle", d: { $gte: start, $lt: end } } },
      { $project: { uid: { $arrayElemAt: [{ $split: ["$_id", ":"] }, 0] }, dub: 1 } },
      { $match: { uid: { $in: ids } } },
      { $group: { _id: null, solves: { $sum: 1 }, flagged: { $sum: { $cond: ["$dub", 1, 0] } }, students: { $addToSet: "$uid" } } },
    ]).toArray();
    const solves = solvesAgg[0]?.solves ?? 0, flagged = solvesAgg[0]?.flagged ?? 0, activeStudents = solvesAgg[0]?.students?.length ?? 0;
    const events = await db.collection("fairplayEvents").find({ academyId, userId: { $in: ids }, at: { $gte: start, $lt: end } }).sort({ at: 1 }).toArray();
    const listed = new Set(events.filter((e: any) => e.kind === "watch" || e.kind === "review").map((e: any) => String(e.userId)));
    const cleared = events.filter((e: any) => e.kind === "clear");
    const everListed = async (userId: string, before: Date) => !!(await db.collection("fairplayEvents").findOne({ userId, kind: { $in: ["watch", "review"] }, at: { $lt: before } }));
    const falseAlarmUsers = new Set<string>();
    for (const c of cleared as any[]) if (await everListed(String(c.userId), new Date(c.at))) falseAlarmUsers.add(String(c.userId));
    const catches = new Set(events.filter((e: any) => e.kind === "hold" || e.kind === "reset").map((e: any) => String(e.userId)));
    // Resets made before decisions were evented (ratingAdjustments is the audit of record).
    const adj = await db.collection("ratingAdjustments").find({ academyId, userId: { $in: ids }, at: { $gte: start, $lt: end } }).toArray();
    const resetDays = new Set(events.filter((e: any) => e.kind === "reset").map((e: any) => `${e.userId}:${new Date(e.at).toISOString().slice(0, 10)}`));
    let extraResets = 0;
    for (const a of adj as any[]) { const k = `${a.userId}:${new Date(a.at).toISOString().slice(0, 10)}`; if (!resetDays.has(k)) { extraResets++; catches.add(String(a.userId)); } }
    const ttd: number[] = [];
    for (const e of events.filter((x: any) => x.kind === "review") as any[]) {
      const first: any = await db.collection("rounds").find({ _id: { $regex: `^${esc(String(e.userId))}:` } as any, dub: true, d: { $gte: new Date(new Date(e.at).getTime() - WINDOW_DAYS * 86400000), $lte: new Date(e.at) } }).sort({ d: 1 }).limit(1).next();
      if (first?.d) ttd.push((new Date(e.at).getTime() - new Date(first.d).getTime()) / 3600000);
    }
    const med = (a: number[]) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return Math.round(s[Math.floor(s.length / 2)]! * 10) / 10; };
    const model = await this.currentModel();
    const fpDocs = await db.collection("fairplay").find({ _id: { $in: ids as any }, handScore: { $type: "number" }, modelScore: { $type: "number" } }, { projection: { handScore: 1, modelScore: 1 } as any }).toArray();
    const agree = fpDocs.filter((d: any) => bandOf(d.handScore) === bandOf(d.modelScore)).length;
    const per500 = solves ? Math.round((falseAlarmUsers.size / (solves / 500)) * 100) / 100 : null;
    return {
      academyId, month, from: start, to: end,
      solves, flagged, activeStudents, students: students.length,
      listed: Array.from(listed).map((u) => ({ userId: u, name: nm.get(u) || u })),
      falseAlarms: Array.from(falseAlarmUsers).map((u) => ({ userId: u, name: nm.get(u) || u })),
      falseAlarmsPer500: per500,
      catches: Array.from(catches).map((u) => ({ userId: u, name: nm.get(u) || u })),
      reviews: events.filter((e: any) => e.kind === "review").length,
      timeToReviewHours: { median: med(ttd), n: ttd.length, all: ttd.map((h) => Math.round(h * 10) / 10) },
      decisions: { clear: cleared.length, hold: events.filter((e: any) => e.kind === "hold").length, reset: events.filter((e: any) => e.kind === "reset").length + extraResets },
      model: { active: model.active, reason: model.reason, n: model.n, cv: model.cv, trainedAt: model.trainedAt, agreement: { agree, total: fpDocs.length } },
      acceptance: { falseAlarms: per500 === null ? null : per500 < 1, timeToReview: ttd.length ? (med(ttd) as number) < 24 : null },
    };
  }

  private async roundsBetween(userId: string, from: Date, to: Date): Promise<(RoundLite & { fx?: any })[]> {
    const rows = await this.conn.db!.collection("rounds")
      .find({ _id: { $regex: `^${esc(userId)}:` } as any, k: "puzzle", d: { $gte: from, $lt: to } }, { projection: { d: 1, pr: 1, r: 1, w: 1, ms: 1, mv_ms: 1, dub: 1, dubr: 1, nc: 1, held: 1, th: 1, sel: 1, fx: 1 } as any })
      .sort({ d: 1 }).toArray();
    return rows.filter((x: any) => typeof x.pr === "number" && typeof x.r === "number")
      .map((x: any) => ({ pid: String(x._id).slice(userId.length + 1), d: new Date(x.d), pr: x.pr, r: x.r, w: !!x.w, ms: x.ms, mv_ms: x.mv_ms, dub: x.dub, dubr: x.dubr, nc: x.nc, held: x.held, th: x.th, sel: x.sel, fx: x.fx }));
  }

  /** The detailed monthly report for coaches: one incident per student the
   *  engine or a coach acted on, with the timeline, the daily score, the
   *  evidence and a plain-words account of how it was detected; then what
   *  the engine did across the roster, exam/homework proctoring, and the
   *  health of the signals. */
  async fairnessReportDetail(academyId: string, month: string, roster: string[] | null = null) {
    const summary = await this.fairnessReport(academyId, month, roster);
    const { from: start, to: end } = summary;
    const db = this.conn.db!;
    const now = new Date();
    const ids = summary.listed ? await this.rosterIds(academyId, roster) : [];
    const nm = new Map<string, string>();
    for (const u of await db.collection("users").find({ _id: { $in: ids as any } }, { projection: { username: 1, name: 1 } as any }).toArray()) nm.set(String(u._id), (u as any).name || (u as any).username || String(u._id));
    const academy: any = await db.collection("academies").findOne({ _id: academyId as any }, { projection: { name: 1 } as any });
    const events = await db.collection("fairplayEvents").find({ academyId, userId: { $in: ids }, at: { $gte: start, $lt: end } }).sort({ at: 1 }).toArray();
    const adj = await db.collection("ratingAdjustments").find({ academyId, userId: { $in: ids }, at: { $gte: start, $lt: end } }).toArray();
    const fpNow = await db.collection("fairplay").find({ _id: { $in: ids as any }, $or: [{ band: { $ne: "clear" } }, { hold: true }] }).toArray();
    const incidentIds = Array.from(new Set([...events.map((e: any) => String(e.userId)), ...adj.map((a: any) => String(a.userId)), ...fpNow.map((f: any) => String(f._id))]));
    const byName = new Map<string, string>();
    for (const u of await db.collection("users").find({ _id: { $in: Array.from(new Set(events.map((e: any) => e.by).filter(Boolean))) as any } }, { projection: { username: 1, name: 1 } as any }).toArray()) byName.set(String(u._id), (u as any).name || (u as any).username || String(u._id));
    await this.loadCrowdStats();
    const exams = await db.collection("exams").find({ academyId }, { projection: { title: 1, proctored: 1 } as any }).toArray();
    const examTitle = new Map(exams.map((e: any) => [String(e._id), { title: e.title, proctored: e.proctored !== false }]));
    const attempts = await db.collection("examAttempts").find({ userId: { $in: ids }, submittedAt: { $gte: start, $lt: end } }, { projection: { examId: 1, userId: 1, submittedAt: 1, scorePct: 1, proctor: 1 } as any }).toArray();

    const incidents: any[] = [];
    for (const userId of incidentIds.slice(0, 40)) {
      const name = nm.get(userId) || userId;
      const fp: any = await db.collection("fairplay").findOne({ _id: userId as any });
      const perf: any = await db.collection("userperfs").findOne({ _id: userId as any }, { projection: { "puzzle.gl.r": 1 } as any });
      const rounds = await this.roundsBetween(userId, new Date(start.getTime() - WINDOW_DAYS * 86400000), end);
      const loo = await this.bandsExcluding(userId);
      const crowd = (pid: string, pr: number) => this.crowdMedianMs(pid, pr, loo);
      const inMonth = rounds.filter((x) => x.d >= start && x.d < end);
      // Daily trailing-30-day score across the month (up to today).
      const daily: { day: string; score: number; band: Band }[] = [];
      const lastDay = new Date(Math.min(end.getTime(), now.getTime()));
      let peak: { day: string; res: ScoreResult } | null = null;
      for (let t = start.getTime(); t < lastDay.getTime(); t += 86400000) {
        const dayEnd = new Date(t + 86400000);
        const win = rounds.filter((x) => x.d >= new Date(dayEnd.getTime() - WINDOW_DAYS * 86400000) && x.d < dayEnd);
        const res = scoreStudent(win, crowd);
        const day = new Date(t).toISOString().slice(0, 10);
        daily.push({ day, score: res.score, band: res.band });
        if (!peak || res.score > peak.res.score) peak = { day, res };
      }
      // Flags as the score sees them: stored by the live detector, or replayed
      // over solves from before it went live (8 Sep 2026) — those DID move
      // rating at the time, and the report says so.
      const replayed = withRetroFlags(inMonth as RoundLite[]);
      const flaggedRounds = replayed.filter((x) => x.dub).map((x) => ({ ...x, replayedFlag: x.d < DETECTOR_LIVE && !inMonth.find((o) => o.pid === x.pid)?.dub }));
      const storedFlagged = inMonth.filter((x) => x.dub).length;
      const reasons: Record<string, number> = {};
      for (const x of flaggedRounds) for (const f of (Array.isArray(x.dubr) && x.dubr.length ? x.dubr : ["fast_above_level"])) reasons[f] = (reasons[f] || 0) + 1;
      const heldRounds = inMonth.filter((x) => x.held);
      const focusRounds = inMonth.filter((x) => x.fx && x.fx.hiddenCount > 0);
      const myEvents = events.filter((e: any) => String(e.userId) === userId);
      const myAdj = adj.filter((a: any) => String(a.userId) === userId);
      const firstFlag = flaggedRounds[0] ?? null;
      const timeline: { at: Date; kind: string; label: string; detail?: string }[] = [];
      if (firstFlag) timeline.push({ at: firstFlag.d, kind: "first_flag", label: firstFlag.replayedFlag ? "First flagged solve (replayed — before the live detector)" : "First flagged solve", detail: `${Math.round(firstFlag.pr)}-rated puzzle in ${((firstFlag.ms ?? 0) / 1000).toFixed(1)} s · ${(firstFlag.dubr ?? []).join(", ")}` });
      if (peak && peak.res.score >= 25) timeline.push({ at: new Date(peak.day + "T23:59:59Z"), kind: "peak", label: `Score peaked at ${peak.res.score} — ${peak.res.band === "review" ? "Review band" : "Watch band"}`, detail: `flags ${peak.res.components.flags} · fast hard ${peak.res.components.fastHard} · accuracy ${peak.res.components.accuracy} · crowd ${peak.res.components.crowd} · climb ${peak.res.components.climb}` });
      for (const e of myEvents as any[]) {
        const who = e.by ? byName.get(String(e.by)) || String(e.by) : null;
        if (e.kind === "watch") timeline.push({ at: new Date(e.at), kind: "watch", label: "Put on Watch", detail: `score ${e.score}` });
        else if (e.kind === "review") timeline.push({ at: new Date(e.at), kind: "review", label: "Entered Review — rated gains held", detail: `score ${e.score}` });
        else if (e.kind === "hold") timeline.push({ at: new Date(e.at), kind: "hold", label: `Held by ${who}`, detail: e.note || undefined });
        else if (e.kind === "clear") timeline.push({ at: new Date(e.at), kind: "clear", label: `Cleared by ${who}`, detail: e.note || undefined });
        else if (e.kind === "reset") timeline.push({ at: new Date(e.at), kind: "reset", label: `Rating reset by ${who}`, detail: e.note || undefined });
      }
      const evResetDays = new Set(myEvents.filter((e: any) => e.kind === "reset").map((e: any) => new Date(e.at).toISOString().slice(0, 10)));
      for (const a of myAdj as any[]) if (!evResetDays.has(new Date(a.at).toISOString().slice(0, 10))) timeline.push({ at: new Date(a.at), kind: "reset", label: `Rating reset ${a.before?.r ? Math.round(a.before.r) : "?"} → ${a.after?.r ?? "?"}` });
      if (fp?.notifiedAt && new Date(fp.notifiedAt) >= start && new Date(fp.notifiedAt) < end) timeline.push({ at: new Date(fp.notifiedAt), kind: "notified", label: fp.notifyOk === false ? "Owner email failed" : "Owner emailed" });
      timeline.sort((a, b) => a.at.getTime() - b.at.getTime());
      const reviewEv = myEvents.find((e: any) => e.kind === "review");
      const ttr = reviewEv && firstFlag ? Math.round(((new Date((reviewEv as any).at).getTime() - firstFlag.d.getTime()) / 3600000) * 10) / 10 : null;
      const decisionEv = [...myEvents].reverse().find((e: any) => ["clear", "hold", "reset"].includes(e.kind)) as any;
      const lastAdj = myAdj.length ? (myAdj as any[]).reduce((a, b) => (new Date(a.at) > new Date(b.at) ? a : b)) : null;
      const decision = decisionEv
        ? { kind: decisionEv.kind, by: String(decisionEv.by), byName: byName.get(String(decisionEv.by)) || String(decisionEv.by), note: decisionEv.note || "", at: decisionEv.at }
        : lastAdj ? { kind: "reset", by: String(lastAdj.by || "owner"), byName: byName.get(String(lastAdj.by)) || String(lastAdj.by || "owner"), note: `${lastAdj.reason || ""}${lastAdj.before?.r ? ` (${Math.round(lastAdj.before.r)} → ${lastAdj.after?.r})` : ""}`.trim(), at: lastAdj.at }
        : (fp?.decision ?? null);
      const myAttempts = attempts.filter((a: any) => String(a.userId) === userId && a.proctor && (a.proctor.hiddenCount > 0 || a.proctor.fsExits > 0));
      const peakRes = peak?.res ?? scoreStudent(inMonth, crowd);
      const howDetected = explainDetection(peakRes, reasons, focusRounds.length, peak?.day ?? null, flaggedRounds.length);
      const whatEngineDid: string[] = [];
      const liveFlaggedWins = flaggedRounds.filter((x) => x.w && !x.replayedFlag).length;
      const replayedWins = flaggedRounds.filter((x) => x.w && x.replayedFlag).length;
      if (liveFlaggedWins) whatEngineDid.push(`${liveFlaggedWins} flagged win${liveFlaggedWins === 1 ? "" : "s"} recorded with no rating change and no per-theme update.`);
      if (replayedWins) whatEngineDid.push(`${replayedWins} win${replayedWins === 1 ? "" : "s"} happened before the live detector (8 Sep 2026) and did move rating at the time; the replay flags them now and they count in the score.`);
      if (heldRounds.length) whatEngineDid.push(`${heldRounds.length} win${heldRounds.length === 1 ? "" : "s"} held while in Review — the student saw nothing.`);
      if (reviewEv) whatEngineDid.push(`Review entered on ${new Date((reviewEv as any).at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}${ttr !== null ? `, ${ttr} h after the first flagged solve` : ""}; rated gains held from then on.`);
      if (fp?.notifiedAt && new Date(fp.notifiedAt) >= start && new Date(fp.notifiedAt) < end) whatEngineDid.push(`Owner emailed the same day${fp.notifyOk === false ? " (send failed — see the panel)" : ""}.`);
      if (decision) whatEngineDid.push(decision.kind === "clear" ? `Cleared by ${decision.byName || decision.by}: window restarted, hold lifted.` : decision.kind === "hold" ? `Held by ${decision.byName || decision.by}: gains stopped until the owner resets or clears.` : `Rating reset by ${decision.byName || decision.by}: per-theme ratings clamped, hold lifted, window restarted.`);
      if (!whatEngineDid.length) whatEngineDid.push("Listed for a look; no rating was withheld.");
      incidents.push({
        userId, name, bandNow: fp?.band ?? "clear", scoreNow: fp?.score ?? 0, hold: !!fp?.hold, ratingNow: perf?.puzzle?.gl?.r ? Math.round(perf.puzzle.gl.r) : null,
        timeline, daily, peak: peak ? { day: peak.day, score: peak.res.score, band: peak.res.band, components: peak.res.components, hard: peak.res.evidence.hard, atLevel: peak.res.evidence.atLevel, above: peak.res.evidence.above, crowdRatio: peak.res.evidence.crowdRatio, ratingStart: peak.res.evidence.ratingStart, ratingEnd: peak.res.evidence.ratingEnd, fastest: peak.res.evidence.fastest.slice(0, 5) } : null,
        flagged: { count: flaggedRounds.length, stored: storedFlagged, wins: liveFlaggedWins + replayedWins, reasons, samples: flaggedRounds.slice(0, 8).map((x) => ({ pid: x.pid, pr: Math.round(x.pr), ms: x.ms ?? null, mvMs: x.mv_ms ?? null, dubr: x.dubr ?? [], at: x.d, w: x.w, replayed: !!x.replayedFlag })) },
        held: heldRounds.length, focusLoss: focusRounds.length, solves: inMonth.length,
        exams: myAttempts.map((a: any) => ({ examId: a.examId, title: examTitle.get(String(a.examId))?.title ?? a.examId, at: a.submittedAt, hiddenCount: a.proctor.hiddenCount, hiddenMs: a.proctor.hiddenMs, fsExits: a.proctor.fsExits, scorePct: a.scorePct })),
        howDetected, whatEngineDid, decision, timeToReviewHours: ttr,
      });
    }
    incidents.sort((a, b) => (b.peak?.score ?? 0) - (a.peak?.score ?? 0));

    // What the engine did across the roster this month.
    const monthRounds = await db.collection("rounds").aggregate([
      { $match: { k: "puzzle", d: { $gte: start, $lt: end } } },
      { $project: { uid: { $arrayElemAt: [{ $split: ["$_id", ":"] }, 0] }, dub: 1, dubr: 1, held: 1, fx: 1, w: 1, ms: 1, pr: 1, th: 1, sel: 1 } },
      { $match: { uid: { $in: ids } } },
    ]).toArray();
    const ruleSolves: Record<string, { solves: number; users: Set<string> }> = {};
    let flaggedSolves = 0, heldWins = 0, focusLossSolves = 0, drillsExcused = 0, fastSolves = 0;
    for (const r of monthRounds as any[]) {
      if (r.dub) { flaggedSolves++; for (const f of (Array.isArray(r.dubr) && r.dubr.length ? r.dubr : ["fast_above_level"])) { (ruleSolves[f] ||= { solves: 0, users: new Set() }); ruleSolves[f].solves++; ruleSolves[f].users.add(r.uid); } }
      if (r.held) heldWins++;
      if (r.fx && r.fx.hiddenCount > 0) focusLossSolves++;
      if (r.w && typeof r.ms === "number" && r.ms < 4000 && r.pr >= 2000) { fastSolves++; if (!r.dub && isDrill(r.th, r.sel)) drillsExcused++; }
    }
    const rules = RULES.map((m) => ({ ...m, solves: ruleSolves[m.rule]?.solves ?? 0, students: ruleSolves[m.rule]?.users.size ?? 0 }));

    // Exams and homework proctoring across the roster.
    const proctoredAttempts = attempts.filter((a: any) => examTitle.get(String(a.examId))?.proctored !== false && a.proctor);
    const left = proctoredAttempts.filter((a: any) => a.proctor.hiddenCount > 0 || a.proctor.fsExits > 0);
    const examIncidents = left.map((a: any) => ({ userId: String(a.userId), name: nm.get(String(a.userId)) || String(a.userId), title: examTitle.get(String(a.examId))?.title ?? a.examId, at: a.submittedAt, hiddenCount: a.proctor.hiddenCount, hiddenMs: a.proctor.hiddenMs, fsExits: a.proctor.fsExits, scorePct: a.scorePct }));
    const hwAgg = await db.collection("rounds").aggregate([
      { $match: { k: "puzzle", d: { $gte: start, $lt: end }, hw: { $exists: true } } },
      { $project: { uid: { $arrayElemAt: [{ $split: ["$_id", ":"] }, 0] }, fx: 1 } },
      { $match: { uid: { $in: ids } } },
      { $group: { _id: "$uid", solves: { $sum: 1 }, focusLoss: { $sum: { $cond: [{ $gt: ["$fx.hiddenCount", 0] }, 1, 0] } }, hiddenMs: { $sum: { $ifNull: ["$fx.hiddenMs", 0] } } } },
      { $sort: { focusLoss: -1 } },
    ]).toArray();
    const homework = hwAgg.map((h: any) => ({ userId: String(h._id), name: nm.get(String(h._id)) || String(h._id), solves: h.solves, focusLoss: h.focusLoss, hiddenMs: h.hiddenMs }));

    // Signal health.
    const pids: string[] = Array.from(new Set(monthRounds.map((r: any) => String(r._id).split(":")[1] ?? "")));
    let covered = 0; for (const pid of pids) { const p = this.perPuzzle.get(pid); if (p && p.n >= 5) covered++; }
    const bands = Array.from(this.perBand.entries()).filter(([b]) => b >= 1200 && b <= 3000).sort((a, b) => a[0] - b[0]).map(([band, medMs]) => ({ band, medMs }));
    const model = await this.currentModel();
    const fpAll = await db.collection("fairplay").find({ _id: { $in: ids as any }, handScore: { $type: "number" }, modelScore: { $type: "number" } }, { projection: { handScore: 1, modelScore: 1 } as any }).toArray();
    const disagreements = fpAll.filter((d: any) => bandOf(d.handScore) !== bandOf(d.modelScore)).map((d: any) => ({ userId: String(d._id), name: nm.get(String(d._id)) || String(d._id), hand: d.handScore, model: d.modelScore }));

    return {
      ...summary, academyName: academy?.name || academyId, scope: roster ? "roster" : "academy", generatedAt: now,
      incidents,
      detection: { rules, flaggedSolves, heldWins, focusLossSolves, drillsExcused, fastSolves },
      exams: { proctoredAttempts: proctoredAttempts.length, clean: proctoredAttempts.length - left.length, left: left.length, incidents: examIncidents },
      homework,
      health: { crowd: { puzzlesWithStats: this.perPuzzle.size, monthPuzzles: pids.length, coveredPct: pids.length ? Math.round((covered / pids.length) * 100) : null, bands }, model: { active: model.active, reason: model.reason, n: model.n, cv: model.cv, trainedAt: model.trainedAt }, disagreements },
    };
  }

  private async rosterIds(academyId: string, roster: string[] | null): Promise<string[]> {
    const q: any = { academyId, role: "student" };
    if (roster) q._id = { $in: roster };
    return (await this.conn.db!.collection("users").find(q, { projection: { _id: 1 } as any }).toArray()).map((u: any) => String(u._id));
  }

  /** 1st of the month: last month's fairness report to each academy owner. */
  async runMonthly(): Promise<number> {
    const now = new Date();
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const month = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;
    const academies = await this.conn.db!.collection("academies").find({}, { projection: { _id: 1, name: 1 } as any }).toArray();
    let sent = 0;
    for (const a of academies as any[]) {
      const owner = await this.ownerOf(String(a._id));
      if (!owner?.email) continue;
      const r = await this.fairnessReport(String(a._id), month);
      if (!r.solves) continue;
      const row = (k: string, v: string) => `<tr><td style="padding:4px 10px 4px 0;color:#666">${k}</td><td style="padding:4px 0"><b>${v}</b></td></tr>`;
      const html = `<h2 style="margin:0 0 12px">Fair play — ${a.name || a._id}, ${month}</h2><table style="font:14px/1.5 system-ui;border-collapse:collapse">` +
        row("Solves", `${r.solves} by ${r.activeStudents} students · ${r.flagged} flagged`) +
        row("Put on the list", `${r.listed.length}${r.listed.length ? " — " + r.listed.map((x) => x.name).join(", ") : ""}`) +
        row("False alarms", `${r.falseAlarms.length} (${r.falseAlarmsPer500 ?? "—"} per 500 solves${r.acceptance.falseAlarms === false ? " — above target" : ""})`) +
        row("Catches (held or reset)", `${r.catches.length}${r.catches.length ? " — " + r.catches.map((x) => x.name).join(", ") : ""}`) +
        row("Time to Review", r.timeToReviewHours.median === null ? "no Review this month" : `median ${r.timeToReviewHours.median} h over ${r.timeToReviewHours.n}${r.acceptance.timeToReview === false ? " — above the 24 h target" : ""}`) +
        row("Decisions", `${r.decisions.clear} cleared · ${r.decisions.hold} held · ${r.decisions.reset} reset`) +
        row("Model", `${r.model.reason}; agrees with the hand score on ${r.model.agreement.agree} of ${r.model.agreement.total} students`) +
        `</table><p style="font:13px system-ui;color:#666">Panel: <a href="${PUBLIC_ORIGIN}/academy/performance">${PUBLIC_ORIGIN}/academy/performance</a></p>`;
      const text = `Fair play — ${a.name || a._id}, ${month}
Solves ${r.solves} (${r.flagged} flagged) · listed ${r.listed.length} · false alarms ${r.falseAlarms.length} (${r.falseAlarmsPer500 ?? "—"}/500) · catches ${r.catches.length} · time to Review median ${r.timeToReviewHours.median ?? "—"} h
Model: ${r.model.reason}`;
      const res = await sendMail({ to: owner.email, subject: `[ChessGuru] Fair play report — ${a.name || a._id}, ${month}`, html, text });
      if (res.ok) sent++;
    }
    console.log(`[fairplay] monthly report sent to ${sent} owner(s)`);
    return sent;
  }

  /** Called after an owner reset: the window restarts, the hold lifts. */
  async clearAfterReset(userId: string, academyId: string | null, by: string, note = ""): Promise<void> {
    const now = new Date();
    const prev: any = await this.conn.db!.collection("fairplay").findOne({ _id: userId as any });
    const decision: Decision = { kind: "reset", by, note: note.slice(0, 500), at: now };
    await this.conn.db!.collection("fairplay").updateOne({ _id: userId as any }, { $set: { academyId, score: 0, band: "clear", components: null, evidence: null, windowStart: now, computedAt: now, hold: false, reviewSince: null, lastReset: now, decision } }, { upsert: true });
    this.holdCache.set(userId, { held: false, at: Date.now() });
    // Labelled example for Phase 3: a reset says "this was assisted".
    await this.conn.db!.collection("fairplayEvents").insertOne({ userId, academyId, kind: "reset", by, note: decision.note, at: now, label: "assisted", score: prev?.score ?? null, components: prev?.components ?? null });
  }

  /** Coach/owner decision on a listed student. `clear` restarts the window
   *  with a note (the student drops off the list); only the owner's Clear
   *  lifts a hold. `hold` stops rated gains until the owner resets or clears.
   *  Both are audited as labelled examples. */
  async decide(userId: string, academyId: string | null, by: { userId: string; role: string }, kind: "clear" | "hold", noteRaw: unknown): Promise<{ ok: boolean; error?: string }> {
    const note = typeof noteRaw === "string" ? noteRaw.trim().slice(0, 500) : "";
    const now = new Date();
    const fp = this.conn.db!.collection("fairplay");
    const prev: any = await fp.findOne({ _id: userId as any });
    const decision: Decision = { kind, by: by.userId, note, at: now };
    if (kind === "clear") {
      if (prev?.hold && by.role !== "academy_owner") return { ok: false, error: "This student's gains are on hold — only the owner can clear or reset a hold." };
      await fp.updateOne({ _id: userId as any }, { $set: { academyId, score: 0, band: "clear", components: null, evidence: null, windowStart: now, computedAt: now, hold: false, reviewSince: null, clearedAt: now, decision } }, { upsert: true });
      this.holdCache.set(userId, { held: false, at: Date.now() });
      await this.conn.db!.collection("fairplayEvents").insertOne({ userId, academyId, kind: "clear", by: by.userId, note, at: now, label: "honest", score: prev?.score ?? null, components: prev?.components ?? null });
      return { ok: true };
    }
    await fp.updateOne({ _id: userId as any }, { $set: { academyId, hold: true, heldBy: by.userId, heldAt: now, decision }, $setOnInsert: { score: 0, band: "clear", windowStart: now, computedAt: now } }, { upsert: true });
    this.holdCache.set(userId, { held: true, at: Date.now() });
    await this.conn.db!.collection("fairplayEvents").insertOne({ userId, academyId, kind: "hold", by: by.userId, note, at: now, label: "assisted", score: prev?.score ?? null, components: prev?.components ?? null });
    return { ok: true };
  }

  /** Last decisions in an academy (optionally limited to a roster) for the
   *  panel's "Recent decisions" strip. */
  async recentDecisions(academyId: string | null, userIds: string[] | null, limit = 12): Promise<any[]> {
    const q: any = { academyId, kind: { $in: ["clear", "hold", "reset", "review"] } };
    if (userIds) q.userId = { $in: userIds };
    const ev = await this.conn.db!.collection("fairplayEvents").find(q).sort({ at: -1 }).limit(limit).toArray();
    const ids = Array.from(new Set(ev.flatMap((e: any) => [String(e.userId), e.by ? String(e.by) : null]).filter(Boolean) as string[]));
    const users = ids.length ? await this.conn.db!.collection("users").find({ _id: { $in: ids as any } }, { projection: { username: 1, name: 1 } as any }).toArray() : [];
    const nm = new Map(users.map((u: any) => [String(u._id), u.name || u.username || String(u._id)]));
    return ev.map((e: any) => ({ userId: String(e.userId), name: nm.get(String(e.userId)) || String(e.userId), kind: e.kind, by: e.by ? String(e.by) : null, byName: e.by ? (nm.get(String(e.by)) || String(e.by)) : null, note: e.note || "", score: e.score ?? null, at: e.at }));
  }

  /** Are this student's rated gains on hold? Cached a minute — read on every solve. */
  async isHeld(userId: string): Promise<boolean> {
    const c = this.holdCache.get(userId);
    if (c && Date.now() - c.at < 60_000) return c.held;
    const doc: any = await this.conn.db!.collection("fairplay").findOne({ _id: userId as any }, { projection: { hold: 1 } as any });
    const held = !!doc?.hold;
    this.holdCache.set(userId, { held, at: Date.now() });
    return held;
  }

  // ── notices ─────────────────────────────────────────────────────────────
  private async ownerOf(academyId: string | null): Promise<{ userId: string; email: string | null; academyName: string } | null> {
    if (!academyId) return null;
    const a: any = await this.conn.db!.collection("academies").findOne({ _id: academyId as any }, { projection: { ownerId: 1, name: 1 } as any });
    if (!a?.ownerId) return null;
    const u: any = await this.conn.db!.collection("users").findOne({ _id: a.ownerId as any }, { projection: { email: 1 } as any });
    return { userId: String(a.ownerId), email: typeof u?.email === "string" ? u.email : null, academyName: a.name || academyId };
  }

  private async notifyOwnerReview(userId: string, academyId: string | null, res: ScoreResult): Promise<void> {
    const owner = await this.ownerOf(academyId);
    if (!owner?.email) return;
    const u: any = await this.conn.db!.collection("users").findOne({ _id: userId as any }, { projection: { username: 1, name: 1 } as any });
    const name = u?.name || u?.username || userId;
    const e = res.evidence;
    const url = `${PUBLIC_ORIGIN}/academy/performance`;
    const lines = [
      `${name} moved into Review (fair-play score ${res.score}/100). Rated gains are on hold until you reset the rating from the Suspicious solving panel.`,
      e.hard.n ? `On 2400+ puzzles: ${e.hard.winPct}% of ${e.hard.n}, median ${e.hard.medianMs !== null ? (e.hard.medianMs / 1000).toFixed(1) : "?"} s, ${e.hard.fast} under 5 s.` : "",
      e.flagged ? `${e.flagged} flagged solves (${Object.entries(e.reasons).map(([k, n]) => `${k} × ${n}`).join(", ")}).` : "",
      e.crowdRatio !== null ? `Typical win takes ${Math.round(e.crowdRatio * 100)}% of the time the crowd needs on the same puzzles.` : "",
      e.climb ? `Rating ${e.ratingStart} → ${e.ratingEnd} in this window.` : "",
    ].filter(Boolean);
    const r = await sendMail({
      to: owner.email,
      subject: `[ChessGuru] Fair play: ${name} needs review`,
      html: `<h2 style="margin:0 0 12px">Fair play review</h2>` + lines.map((l) => `<p style="font:14px/1.5 system-ui;margin:0 0 8px">${l}</p>`).join("") + `<p style="font:13px system-ui;color:#666">Open the panel: <a href="${url}">${url}</a>. Nothing has been said to the student.</p>`,
      text: lines.join("\n") + `\n\n${url}`,
    });
    await this.conn.db!.collection("fairplay").updateOne({ _id: userId as any }, { $set: { notifiedAt: new Date(), notifyOk: r.ok } });
  }

  // ── schedule ────────────────────────────────────────────────────────────
  private async ranWithin(job: string, ms: number): Promise<boolean> {
    const j: any = await this.conn.db!.collection("fairplayJobs").findOne({ _id: job as any });
    return !!j?.lastRunAt && Date.now() - new Date(j.lastRunAt).getTime() < ms;
  }
  private async markRan(job: string): Promise<void> {
    await this.conn.db!.collection("fairplayJobs").updateOne({ _id: job as any }, { $set: { lastRunAt: new Date() } }, { upsert: true });
  }

  async tick(): Promise<void> {
    const now = new Date();
    if (now.getUTCHours() === NIGHTLY_UTC_HOUR && !(await this.ranWithin("nightly", 20 * 3600 * 1000))) {
      await this.markRan("nightly");
      await this.runNightly();
    }
    if (now.getUTCDay() === 1 && now.getUTCHours() === DIGEST_UTC_HOUR && !(await this.ranWithin("digest", 6 * 86400 * 1000))) {
      await this.markRan("digest");
      await this.runDigest();
    }
    if (now.getUTCDate() === 1 && now.getUTCHours() === MONTHLY_UTC_HOUR && !(await this.ranWithin("monthly", 25 * 86400 * 1000))) {
      await this.markRan("monthly");
      await this.runMonthly();
    }
  }

  /** Rebuild crowd baselines, score every academy student, notify new reviews. */
  async runNightly(): Promise<{ scored: number; review: number; watch: number }> {
    const t0 = Date.now();
    await this.rebuildCrowdStats();
    await this.refitModel().catch((e) => console.warn("[fairplay] refit failed", (e as Error).message));
    const students = await this.conn.db!.collection("users").find({ role: "student", academyId: { $type: "string" } }, { projection: { _id: 1, academyId: 1 } as any }).toArray();
    let review = 0, watch = 0;
    for (const s of students as any[]) {
      try {
        const r = await this.scoreUser(String(s._id), s.academyId);
        if (r.band === "review") review++; else if (r.band === "watch") watch++;
      } catch (e) { console.warn("[fairplay] score failed", s._id, (e as Error).message); }
    }
    console.log(`[fairplay] nightly: ${students.length} scored, ${review} review, ${watch} watch, ${Date.now() - t0} ms`);
    return { scored: students.length, review, watch };
  }

  /** Monday email to each academy owner: who entered Watch/Review this week,
   *  who is on hold, what was reset. Silent when there is nothing to say. */
  async runDigest(): Promise<number> {
    const since = new Date(Date.now() - 7 * 86400000);
    const academies = await this.conn.db!.collection("academies").find({}, { projection: { _id: 1, name: 1, ownerId: 1 } as any }).toArray();
    let sent = 0;
    for (const a of academies as any[]) {
      const owner = await this.ownerOf(String(a._id));
      if (!owner?.email) continue;
      const fp = await this.conn.db!.collection("fairplay").find({ academyId: String(a._id), band: { $in: ["watch", "review"] } }).toArray();
      const events = await this.conn.db!.collection("fairplayEvents").find({ academyId: String(a._id), at: { $gte: since } }).sort({ at: -1 }).toArray();
      const resets = await this.conn.db!.collection("ratingAdjustments").find({ academyId: String(a._id), at: { $gte: since } }).toArray();
      if (!fp.length && !events.length && !resets.length) continue;
      const names = new Map<string, string>();
      const ids = Array.from(new Set([...fp.map((x: any) => String(x._id)), ...events.map((x: any) => String(x.userId)), ...resets.map((x: any) => String(x.userId))]));
      for (const u of await this.conn.db!.collection("users").find({ _id: { $in: ids as any } }, { projection: { username: 1, name: 1 } as any }).toArray()) names.set(String(u._id), (u as any).name || (u as any).username || String(u._id));
      const nm = (id: string) => names.get(id) || id;
      const li = (s: string) => `<li style="margin:0 0 6px">${s}</li>`;
      const reviewNow = fp.filter((x: any) => x.band === "review");
      const watchNow = fp.filter((x: any) => x.band === "watch");
      const entered = events.filter((x: any) => x.kind === "review");
      const html =
        `<h2 style="margin:0 0 12px">Fair play — ${a.name || a._id}, week to ${new Date().toLocaleDateString("en-IN")}</h2>` +
        `<p style="font:14px/1.5 system-ui"><b>${reviewNow.length}</b> in Review (rated gains on hold), <b>${watchNow.length}</b> in Watch.</p>` +
        (entered.length ? `<p style="font:14px/1.5 system-ui;margin:12px 0 4px"><b>Entered Review this week</b></p><ul style="font:14px/1.5 system-ui;padding-left:18px">${entered.map((x: any) => li(`${nm(String(x.userId))} — score ${x.score}`)).join("")}</ul>` : "") +
        (reviewNow.length ? `<p style="font:14px/1.5 system-ui;margin:12px 0 4px"><b>On hold now</b></p><ul style="font:14px/1.5 system-ui;padding-left:18px">${reviewNow.map((x: any) => li(`${nm(String(x._id))} — score ${x.score}, since ${x.reviewSince ? new Date(x.reviewSince).toLocaleDateString("en-IN") : "?"}`)).join("")}</ul>` : "") +
        (watchNow.length ? `<p style="font:14px/1.5 system-ui;margin:12px 0 4px"><b>Watch</b></p><ul style="font:14px/1.5 system-ui;padding-left:18px">${watchNow.map((x: any) => li(`${nm(String(x._id))} — score ${x.score}`)).join("")}</ul>` : "") +
        (resets.length ? `<p style="font:14px/1.5 system-ui;margin:12px 0 4px"><b>Resets this week</b></p><ul style="font:14px/1.5 system-ui;padding-left:18px">${resets.map((x: any) => li(`${nm(String(x.userId))}: ${x.before?.r ?? "?"} → ${x.after?.r ?? "?"}`)).join("")}</ul>` : "") +
        `<p style="font:13px system-ui;color:#666">Panel: <a href="${PUBLIC_ORIGIN}/academy/performance">${PUBLIC_ORIGIN}/academy/performance</a></p>`;
      const text = `Fair play — ${a.name || a._id}\n${reviewNow.length} in Review (on hold), ${watchNow.length} in Watch.\n` + reviewNow.map((x: any) => `Review: ${nm(String(x._id))} (${x.score})`).join("\n") + "\n" + watchNow.map((x: any) => `Watch: ${nm(String(x._id))} (${x.score})`).join("\n");
      const r = await sendMail({ to: owner.email, subject: `[ChessGuru] Fair play weekly — ${a.name || a._id}`, html, text });
      if (r.ok) sent++;
    }
    console.log(`[fairplay] digest sent to ${sent} owner(s)`);
    return sent;
  }
}
