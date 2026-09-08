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
import { scoreStudent, bandOf, type RoundLite, type ScoreResult, type ScoreExtras, type Band } from "./score";
import { train, handModel, modelScore as modelScoreOf, type Model, type LabelledExample } from "./model";

export interface Decision { kind: "clear" | "hold" | "reset"; by: string; note: string; at: Date }

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
  async fairnessReport(academyId: string, month: string) {
    const [y, mo] = month.split("-").map(Number);
    if (!y || !mo) throw new Error("bad month");
    const start = new Date(Date.UTC(y, mo - 1, 1)), end = new Date(Date.UTC(y, mo, 1));
    const db = this.conn.db!;
    const students = await db.collection("users").find({ academyId, role: "student" }, { projection: { _id: 1, username: 1, name: 1 } as any }).toArray();
    const ids = students.map((s: any) => String(s._id));
    const nm = new Map(students.map((s: any) => [String(s._id), s.name || s.username || String(s._id)]));
    const solvesAgg = await db.collection("rounds").aggregate([
      { $match: { k: "puzzle", d: { $gte: start, $lt: end } } },
      { $project: { uid: { $arrayElemAt: [{ $split: ["$_id", ":"] }, 0] }, dub: 1 } },
      { $match: { uid: { $in: ids } } },
      { $group: { _id: null, solves: { $sum: 1 }, flagged: { $sum: { $cond: ["$dub", 1, 0] } }, students: { $addToSet: "$uid" } } },
    ]).toArray();
    const solves = solvesAgg[0]?.solves ?? 0, flagged = solvesAgg[0]?.flagged ?? 0, activeStudents = solvesAgg[0]?.students?.length ?? 0;
    const events = await db.collection("fairplayEvents").find({ academyId, at: { $gte: start, $lt: end } }).sort({ at: 1 }).toArray();
    const listed = new Set(events.filter((e: any) => e.kind === "watch" || e.kind === "review").map((e: any) => String(e.userId)));
    const cleared = events.filter((e: any) => e.kind === "clear");
    const everListed = async (userId: string, before: Date) => !!(await db.collection("fairplayEvents").findOne({ userId, kind: { $in: ["watch", "review"] }, at: { $lt: before } }));
    const falseAlarmUsers = new Set<string>();
    for (const c of cleared as any[]) if (await everListed(String(c.userId), new Date(c.at))) falseAlarmUsers.add(String(c.userId));
    const catches = new Set(events.filter((e: any) => e.kind === "hold" || e.kind === "reset").map((e: any) => String(e.userId)));
    // Resets made before decisions were evented (ratingAdjustments is the audit of record).
    const adj = await db.collection("ratingAdjustments").find({ academyId, at: { $gte: start, $lt: end } }).toArray();
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
    const fpDocs = await db.collection("fairplay").find({ academyId, handScore: { $type: "number" }, modelScore: { $type: "number" } }, { projection: { handScore: 1, modelScore: 1 } as any }).toArray();
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
