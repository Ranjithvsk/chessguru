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
import { scoreStudent, type RoundLite, type ScoreResult, type Band } from "./score";

const WINDOW_DAYS = 30;
const TICK_MS = 10 * 60 * 1000;
const NIGHTLY_UTC_HOUR = 21;      // 02:30 IST
const DIGEST_UTC_HOUR = 2;        // Monday 08:xx IST
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

  /** The window starts at the later of 30 days ago and the last reset — a
   *  reset is the owner's review, so nothing before it counts again. */
  async roundsFor(userId: string, now = new Date()): Promise<{ rounds: RoundLite[]; windowStart: Date; lastReset: Date | null }> {
    const lastReset = await this.lastResetAt(userId);
    let windowStart = new Date(now.getTime() - WINDOW_DAYS * 86400000);
    if (lastReset && lastReset > windowStart) windowStart = lastReset;
    const rows = await this.conn.db!.collection("rounds")
      .find({ _id: { $regex: `^${esc(userId)}:` } as any, k: "puzzle", d: { $gte: windowStart, $lte: now } }, { projection: { d: 1, pr: 1, r: 1, w: 1, ms: 1, mv_ms: 1, dub: 1, dubr: 1, nc: 1, held: 1, th: 1, sel: 1 } as any })
      .sort({ d: 1 }).toArray();
    const rounds: RoundLite[] = rows
      .filter((x: any) => typeof x.pr === "number" && typeof x.r === "number")
      .map((x: any) => ({ pid: String(x._id).slice(userId.length + 1), d: new Date(x.d), pr: x.pr, r: x.r, w: !!x.w, ms: x.ms, mv_ms: x.mv_ms, dub: x.dub, dubr: x.dubr, nc: x.nc, held: x.held, th: x.th, sel: x.sel }));
    return { rounds, windowStart, lastReset };
  }

  /** Score one student, persist, and handle the transition into review. */
  async scoreUser(userId: string, academyId: string | null, opts: { notify?: boolean } = {}): Promise<ScoreResult & { hold: boolean; windowStart: Date; lastReset: Date | null; reviewSince: Date | null }> {
    await this.loadCrowdStats();
    const now = new Date();
    const { rounds, windowStart, lastReset } = await this.roundsFor(userId, now);
    const loo = await this.bandsExcluding(userId);
    const res = scoreStudent(rounds, (pid, pr) => this.crowdMedianMs(pid, pr, loo));
    const fp = this.conn.db!.collection("fairplay");
    const prev: any = await fp.findOne({ _id: userId as any });
    const wasReview = prev?.band === "review";
    const nowReview = res.band === "review";
    // A hold is set on entering Review and lifts ONLY when the owner resets
    // (clearAfterReset) — a score that decays as the window slides never
    // releases it on its own. Owner decision 2026-09-08.
    const hold = !!prev?.hold || nowReview;
    const reviewSince: Date | null = nowReview ? (prev?.reviewSince ? new Date(prev.reviewSince) : now) : null;
    await fp.updateOne({ _id: userId as any }, { $set: { academyId, score: res.score, band: res.band, components: res.components, evidence: res.evidence, windowStart, computedAt: now, hold, reviewSince, lastReset } }, { upsert: true });
    this.holdCache.set(userId, { held: hold, at: Date.now() });
    if (nowReview && !wasReview) {
      await this.conn.db!.collection("fairplayEvents").insertOne({ userId, academyId, kind: "review", score: res.score, components: res.components, at: now });
      if (opts.notify !== false) await this.notifyOwnerReview(userId, academyId, res).catch((e) => console.warn("[fairplay] notify", e?.message || e));
    }
    return { ...res, hold, windowStart, lastReset, reviewSince };
  }

  /** Called after an owner reset: the window restarts, the hold lifts. */
  async clearAfterReset(userId: string, academyId: string | null, by: string): Promise<void> {
    const now = new Date();
    await this.conn.db!.collection("fairplay").updateOne({ _id: userId as any }, { $set: { academyId, score: 0, band: "clear", components: null, evidence: null, windowStart: now, computedAt: now, hold: false, reviewSince: null, lastReset: now } }, { upsert: true });
    this.holdCache.set(userId, { held: false, at: Date.now() });
    await this.conn.db!.collection("fairplayEvents").insertOne({ userId, academyId, kind: "reset", by, at: now });
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
  }

  /** Rebuild crowd baselines, score every academy student, notify new reviews. */
  async runNightly(): Promise<{ scored: number; review: number; watch: number }> {
    const t0 = Date.now();
    await this.rebuildCrowdStats();
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
