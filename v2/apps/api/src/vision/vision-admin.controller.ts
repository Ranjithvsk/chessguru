// Super-admin window into the vision engines (owner request, 2026-09-10).
//
// Why this exists: the owner asked how to take board recognition from ~95% to 100%, and the
// honest answer was that nobody could see the loop that gets you there. The classifier retrains
// every night, but its training set had not received a new sample since 11 August; the
// "95%" was two test diagrams measured on the 11th; and corrections the model was CONFIDENT
// about are stored with approved=false and never trained on. None of that was visible anywhere.
//
// This page makes the loop visible and closes it: what the engines are, when their weights last
// changed, how many scans came in, how many corrections came back, what the nightly retrain did,
// and a review queue where a human approves the confidently-wrong corrections so they enter the
// next training set. That queue is the mechanism the 100% goal actually depends on.
//
// Read-mostly. The only writes are approve / reject on a correction, admin-gated like the rest.
import { Controller, ForbiddenException, Get, Param, Post, Query, Req } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection, Types } from "mongoose";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { isAdmin } from "../admin/admins";

const VISION_SERVICE = process.env.VISION_SERVICE_URL ?? "http://127.0.0.1:5100";
const VISION_LOG_DIR = process.env.VISION_LOG_DIR ?? "/var/lib/chessguru/vision-log";
const RETRAIN_LOG = process.env.VISION_RETRAIN_LOG ?? "/home/dreamworld/logs/chess-vision-retrain.log";

// Every weight file that can change what the shop sees. Two engines live in the Python service
// (board extractor + piece classifier, both YOLO); one lives in this API (the DINOv2 classifier
// ONNX the nightly retrain replaces). `.prev` is the retrain's own rollback copy.
const MODEL_FILES: Array<{ key: string; label: string; path: string; engine: string }> = [
  { key: "board-seg", label: "Board extractor (YOLOv8n-seg)", path: "/opt/chessguru-vision/mit-weights/chessguru-board-seg.pt", engine: "ultra service :5100" },
  { key: "cls", label: "Piece classifier (YOLO)", path: "/opt/chessguru-vision/mit-weights/chessguru-cls.pt", engine: "ultra service :5100" },
  { key: "dinov2", label: "DINOv2 nightly (ONNX)", path: "/opt/chessguru-vision/mit-weights/dinov2-base-nightly.onnx", engine: "ultra service :5100" },
  { key: "api-onnx", label: "API classifier (ONNX)", path: "/home/ubuntu/chessguru/v2/apps/api/models/chess-classifier.onnx", engine: "this API" },
  { key: "api-onnx-prev", label: "API classifier — previous", path: "/home/ubuntu/chessguru/v2/apps/api/models/chess-classifier.onnx.prev", engine: "rollback copy" },
];

type DayCount = Record<string, number>;
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const lastNDays = (n: number): string[] => {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(dayOf(new Date(Date.now() - i * 86_400_000)));
  return out;
};

@Controller()
export class VisionAdminController {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  private guard(req: any) {
    if (!isAdmin(req.session?.userId)) throw new ForbiddenException("admin only");
  }
  private refs() { return this.conn.db!.collection<any>("visionRefs"); }

  @Get("admin/vision/status")
  async status(@Req() req: any) {
    this.guard(req);
    const days = lastNDays(14);
    const [service, models, scans, corrections, cornerLabels, retrain, trainingSet, pending] = await Promise.all([
      this.serviceHealth(),
      Promise.resolve(this.modelFiles()),
      Promise.resolve(this.scansByDay(days)),
      this.correctionsByDay(days),
      this.cornerLabelsByDay(days),
      Promise.resolve(this.retrainHistory()),
      this.trainingSet(),
      this.refs().countDocuments({ source: "correction", approved: false, rejected: { $ne: true } }),
    ]);
    return { at: new Date().toISOString(), days, service, models, scans, corrections, cornerLabels, retrain, trainingSet, pendingReview: pending };
  }

  /** Confidently-wrong corrections waiting for a human. Thumbnails ride along so the reviewer
   *  sees the actual pixels, not a row of ids. Capped: this is a queue, not an archive. */
  @Get("admin/vision/review")
  async review(@Req() req: any, @Query("limit") limitRaw?: string) {
    this.guard(req);
    const limit = Math.min(200, Math.max(1, parseInt(String(limitRaw ?? "60"), 10) || 60));
    const rows = await this.refs().find(
      { source: "correction", approved: false, rejected: { $ne: true } },
      { projection: { piece: 1, color: 1, modelConf: 1, modelPiece: 1, modelColor: 1, createdBy: 1, createdAt: 1, rawCropPng: 1, silhouettePng: 1, setName: 1 } },
    ).sort({ createdAt: -1 }).limit(limit).toArray();
    return {
      rows: rows.map((r) => ({
        id: String(r._id), piece: r.piece, color: r.color, setName: r.setName ?? null,
        modelConf: typeof r.modelConf === "number" ? r.modelConf : null,
        modelPiece: r.modelPiece ?? null, modelColor: r.modelColor ?? null,
        by: r.createdBy ?? null, at: r.createdAt ?? null,
        // rawCropPng is stored without the data-URL prefix; the page needs one to render it.
        thumb: r.rawCropPng ? `data:image/png;base64,${r.rawCropPng}` : (r.silhouettePng ?? null),
      })),
    };
  }

  @Post("admin/vision/review/:id/approve")
  async approve(@Req() req: any, @Param("id") id: string) {
    this.guard(req);
    const r = await this.refs().updateOne({ _id: new Types.ObjectId(id) }, { $set: { approved: true, reviewedBy: req.session.userId, reviewedAt: new Date() }, $unset: { rejected: "" } });
    return { ok: r.matchedCount === 1 };
  }

  @Post("admin/vision/review/:id/reject")
  async reject(@Req() req: any, @Param("id") id: string) {
    this.guard(req);
    // Rejected stays in the collection (it is evidence of what coaches do) but leaves the queue
    // and, because approved stays false, never reaches the training set.
    const r = await this.refs().updateOne({ _id: new Types.ObjectId(id) }, { $set: { rejected: true, approved: false, reviewedBy: req.session.userId, reviewedAt: new Date() } });
    return { ok: r.matchedCount === 1 };
  }

  /** The numbers the owner asked for: positions scanned, how many came back correct, how many were
   *  edited, and the book library. Scan-level truth starts on 2026-09-10, when scans began writing
   *  their own record; anything earlier is disk images and one seeding session, and is labelled so. */
  @Get("admin/vision/analytics")
  async analytics(@Req() req: any) {
    this.guard(req);
    const scans = this.conn.db!.collection<any>("visionScans");
    const now = Date.now();
    const win = async (days: number | null) => {
      const q: any = days ? { at: { $gte: new Date(now - days * 86_400_000) } } : {};
      const [total, edited, agg] = await Promise.all([
        scans.countDocuments(q),
        scans.countDocuments({ ...q, corrections: { $gt: 0 } }),
        scans.aggregate([{ $match: q }, { $group: { _id: null, corrections: { $sum: "$corrections" }, avgConf: { $avg: "$avgConf" }, lowSq: { $avg: "$lowConfSquares" }, users: { $addToSet: "$userId" } } }]).toArray(),
      ]);
      const a = agg[0] ?? { corrections: 0, avgConf: null, lowSq: null, users: [] };
      return {
        scanned: total, edited, acceptedAsRead: total - edited,
        correctPct: total ? Math.round(((total - edited) / total) * 1000) / 10 : null,
        squaresCorrected: a.corrections,
        squareAccuracyPct: total ? Math.round((1 - a.corrections / (64 * total)) * 1000) / 10 : null,
        avgConfPct: a.avgConf == null ? null : Math.round(a.avgConf * 1000) / 10,
        weakSquaresPerScan: a.lowSq == null ? null : Math.round(a.lowSq * 10) / 10,
        scanners: (a.users ?? []).filter(Boolean).length,
      };
    };
    const [all, d30, d7, first] = await Promise.all([win(null), win(30), win(7), scans.find({}, { projection: { at: 1 } }).sort({ at: 1 }).limit(1).toArray()]);

    // What the model gets wrong, as a confusion list: what it said -> what the coach said.
    const confusion = await this.refs().aggregate([
      { $match: { source: "correction", modelPiece: { $exists: true } } },
      { $group: { _id: { from: "$modelPiece", to: { $cond: ["$isEmpty", "empty", "$piece"] } }, n: { $sum: 1 } } },
      { $sort: { n: -1 } }, { $limit: 12 },
    ]).toArray();

    // Books: the library lives on the book host (a laptop behind a tunnel), so it can be away.
    let books: any = { reachable: false };
    try {
      const r = await fetch("http://127.0.0.1:8791/books", { signal: AbortSignal.timeout(6000) });
      const j = await r.json() as { books?: Array<{ pages?: string | number; done?: string | number; diagrams?: string | number; state?: string }> };
      const list = Array.isArray(j?.books) ? j.books : [];
      const num = (v: unknown) => Number(v) || 0;
      books = {
        reachable: true, total: list.length,
        done: list.filter((b) => b.state === "done").length,
        inProgress: list.filter((b) => b.state && b.state !== "done").length,
        pages: list.reduce((a, b) => a + num(b.pages), 0),
        pagesDone: list.reduce((a, b) => a + num(b.done), 0),
        diagrams: list.reduce((a, b) => a + num(b.diagrams), 0),
      };
    } catch (e) { books = { reachable: false, error: (e as Error).message }; }

    // Reader corrections on book diagrams live next to each locally served book.
    const readerFixes = this.bookDiagramCorrections();

    // Pre-instrumentation history, labelled as what it is.
    const legacy = {
      seedingCorrections: await this.refs().countDocuments({ source: "correction", scanId: { $exists: false } }),
      scanImagesOnDisk: this.scansByDay(lastNDays(1)).totalFiles,
      note: "Before 2026-09-10 no scan wrote a record of itself. The 128 corrections from 11 August were one seeding session by one person, not coach activity.",
    };
    return { since: first[0]?.at ?? null, all, last30: d30, last7: d7, confusion: confusion.map((c) => ({ modelSaid: c._id.from, coachSaid: c._id.to, n: c.n })), books, readerFixes, legacy };
  }

  private bookDiagramCorrections() {
    const STORE = "/var/lib/chessguru/user-books";
    let books = 0, diagrams = 0, corrected = 0, disputed = 0, events = 0;
    try {
      for (const id of readdirSync(STORE)) {
        try {
          const d = JSON.parse(readFileSync(`${STORE}/${id}/diagrams.json`, "utf8")) as Array<{ corrected?: boolean; disputed?: boolean }>;
          books++; diagrams += d.length; corrected += d.filter((x) => x.corrected).length; disputed += d.filter((x) => x.disputed).length;
        } catch { /* not a book dir */ }
        try { events += readFileSync(`${STORE}/${id}/corrections.jsonl`, "utf8").split("\n").filter(Boolean).length; } catch { /* none */ }
      }
    } catch { /* store absent */ }
    return { books, diagrams, corrected, disputed, events };
  }

  // ---- pieces ---------------------------------------------------------------------------------

  private async serviceHealth() {
    const t0 = Date.now();
    try {
      const r = await fetch(`${VISION_SERVICE}/health`, { signal: AbortSignal.timeout(4000) });
      const body = await r.json().catch(() => ({}));
      return { ok: r.ok, ms: Date.now() - t0, ...body };
    } catch (e) {
      return { ok: false, ms: Date.now() - t0, error: (e as Error).message };
    }
  }

  private modelFiles() {
    const out = MODEL_FILES.map((m) => {
      try {
        const s = statSync(m.path);
        return { ...m, present: true, bytes: s.size, mtime: s.mtime.toISOString() };
      } catch {
        return { ...m, present: false, bytes: 0, mtime: null as string | null };
      }
    });
    // Did the nightly retrain actually change the served model? Size+mtime is enough to tell a
    // real replacement from a copy; hashing 344 MB on every page load is not worth it.
    const cur = out.find((m) => m.key === "api-onnx"), prev = out.find((m) => m.key === "api-onnx-prev");
    const changedByLastRetrain = !!(cur?.present && prev?.present && (cur.bytes !== prev.bytes || cur.mtime !== prev.mtime));
    return { files: out, changedByLastRetrain };
  }

  /** The API writes one PNG per scan step into VISION_LOG_DIR, named <iso>-<tag>.png. The tags
   *  distinguish a raw upload from the warped board from a correction crop, so "scans" here is
   *  the raw-upload tags only, which is what a coach experiences as one scan. */
  private scansByDay(days: string[]) {
    const byDay: DayCount = Object.fromEntries(days.map((d) => [d, 0]));
    const byTag: Record<string, number> = {};
    let total = 0;
    try {
      for (const name of readdirSync(VISION_LOG_DIR)) {
        const m = name.match(/^(\d{4}-\d{2}-\d{2})T[\d-]+Z-(.+)\.png$/);
        if (!m) continue;
        const day = m[1] as string, tag = m[2] as string;
        byTag[tag] = (byTag[tag] ?? 0) + 1;
        total++;
        if (/raw|upload/.test(tag) && day in byDay) byDay[day] = (byDay[day] ?? 0) + 1;
      }
      return { ok: true, byDay, byTag, totalFiles: total };
    } catch (e) {
      return { ok: false, byDay, byTag, totalFiles: 0, error: (e as Error).message };
    }
  }

  private async correctionsByDay(days: string[]) {
    const since = new Date(days[0] + "T00:00:00Z");
    const rows = await this.refs().aggregate([
      { $match: { source: "correction", createdAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, n: { $sum: 1 },
                  autoApproved: { $sum: { $cond: [{ $eq: ["$approved", true] }, 1, 0] } } } },
    ]).toArray();
    const byDay: DayCount = Object.fromEntries(days.map((d) => [d, 0]));
    const autoApprovedByDay: DayCount = Object.fromEntries(days.map((d) => [d, 0]));
    for (const r of rows) { if (r._id in byDay) { byDay[r._id] = r.n; autoApprovedByDay[r._id] = r.autoApproved; } }
    const last = await this.refs().find({ source: "correction" }, { projection: { createdAt: 1 } }).sort({ createdAt: -1 }).limit(1).toArray();
    const total = await this.refs().countDocuments({ source: "correction" });
    return { byDay, autoApprovedByDay, total, lastAt: last[0]?.createdAt ?? null };
  }

  private async cornerLabelsByDay(days: string[]) {
    const col = this.conn.db!.collection<any>("visionCornerLabels");
    const since = new Date(days[0] + "T00:00:00Z");
    const rows = await col.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, n: { $sum: 1 } } },
    ]).toArray();
    const byDay: DayCount = Object.fromEntries(days.map((d) => [d, 0]));
    for (const r of rows) if (r._id in byDay) byDay[r._id] = r.n;
    const last = await col.find({}, { projection: { createdAt: 1 } }).sort({ createdAt: -1 }).limit(1).toArray();
    return { byDay, total: await col.estimatedDocumentCount(), lastAt: last[0]?.createdAt ?? null };
  }

  /** The nightly log is append-only and carries no date on its lines, so runs are recovered
   *  from the "best val_acc" markers in order. Dates come from the model file, not the log. */
  private retrainHistory() {
    try {
      const text = readFileSync(RETRAIN_LOG, "utf8");
      const lines = text.split("\n");
      const runs: Array<{ valAcc: number | null; note: string }> = [];
      for (const l of lines) {
        const m = l.match(/best val_acc=([\d.]+)%/);
        if (m) runs.push({ valAcc: Number(m[1]), note: l.replace(/^\[[\d:]+\]\s*/, "").slice(0, 120) });
        else if (/refus|FAIL|error/i.test(l)) runs.push({ valAcc: null, note: l.slice(0, 120) });
      }
      const counts: Record<string, number> = {};
      for (const l of lines) { const m = l.match(/^\s*([A-Za-z]{2})\s+train=\s*(\d+)\s+val=\s*(\d+)/); if (m) counts[m[1] as string] = Number(m[2]) + Number(m[3]); }
      return { ok: true, runs: runs.slice(-30), lastLines: lines.filter(Boolean).slice(-8), lastClassCounts: counts };
    } catch (e) {
      return { ok: false, runs: [], lastLines: [], lastClassCounts: {}, error: (e as Error).message };
    }
  }

  /** What the next retrain will actually train on: approved refs, by piece and colour, and where
   *  they came from. A class with a dozen samples is the reason a "95%" plateaus. */
  private async trainingSet() {
    const rows = await this.refs().aggregate([
      { $match: { approved: true } },
      { $group: { _id: { piece: "$piece", color: "$color", source: "$source" }, n: { $sum: 1 } } },
    ]).toArray();
    const byClass: Record<string, { correction: number; seed: number }> = {};
    for (const r of rows) {
      const k = `${r._id.color}${r._id.piece}`;
      byClass[k] ??= { correction: 0, seed: 0 };
      if (r._id.source === "seed") byClass[k].seed += r.n; else byClass[k].correction += r.n;
    }
    const total = await this.refs().countDocuments({ approved: true });
    const unapproved = await this.refs().countDocuments({ approved: false });
    return { byClass, total, unapproved };
  }
}
