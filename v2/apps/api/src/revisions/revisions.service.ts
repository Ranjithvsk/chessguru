// Spaced-repetition revision queue — the "did the student REMEMBER what
// they studied?" loop. One doc per (user × revise-flagged position).
//
// A revision is spawned whenever a move node in a study chapter is marked
// isRevisePoint: true. We sync on chapter save (owner) and on explicit
// "add to my queue" (non-owner viewers of a shared study).
//
// Scheduling: SM-2 with 4 grades (again / hard / good / easy). Interval
// caps at 180d; ease clamped [1.3, 3.0]. Wrong resets streak + interval.
//
// Collection: `revisions` — index on (userId, dueAt) makes queue queries fast.

import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { Chess } from "chess.js";

type Grade = "again" | "hard" | "good" | "easy";

// Interval cap (days). Beyond ~6 months, the SR pattern doesn't help chess memory.
const MAX_INTERVAL_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RevisionDoc {
  _id: string;                  // `${userId}:${chapterId}:${nodeId}`
  userId: string;
  studyId: string;
  chapterId: string;
  nodeId: string;
  bookId?: string;              // if study.sourceBook.bookId
  bookChapterNumber?: number;
  studyTitle: string;           // denorm for queue display (avoid N+1)
  chapterTitle: string;
  fenBefore: string;            // position where the move is expected
  expectedUci: string;
  expectedSan: string;
  turnColor: "white" | "black";
  interval: number;             // days until next review after last correct
  ease: number;                 // SM-2 ease factor
  streak: number;               // consecutive correct
  reps: number;                 // total reviews
  lapses: number;               // total failures
  dueAt: Date;
  lastReviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class RevisionsService {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  private col() { return this.conn.db!.collection<RevisionDoc>("revisions"); }
  private studies() { return this.conn.db!.collection<any>("studies"); }
  private chapters() { return this.conn.db!.collection<any>("studyChapters"); }

  private ensureUser(session: any): string {
    const userId = session?.userId;
    if (!userId) throw new UnauthorizedException("sign in first");
    return String(userId);
  }

  /** Positions due for review — sorted by earliest due first. Caller can
   *  cap with ?limit; default 30 (5–10 min of drill). */
  async queue(session: any, limit = 30) {
    const userId = this.ensureUser(session);
    const now = new Date();
    const rows = await this.col()
      .find({ userId, dueAt: { $lte: now } })
      .sort({ dueAt: 1 })
      .limit(Math.min(Math.max(limit, 1), 100))
      .toArray();
    return { items: rows, now: now.toISOString() };
  }

  /** Dashboard summary — how many due right now + upcoming (next 24h) + streak. */
  async stats(session: any) {
    const userId = this.ensureUser(session);
    const now = new Date();
    const tomorrow = new Date(now.getTime() + DAY_MS);
    const [dueNow, dueTomorrow, total, best] = await Promise.all([
      this.col().countDocuments({ userId, dueAt: { $lte: now } }),
      this.col().countDocuments({ userId, dueAt: { $gt: now, $lte: tomorrow } }),
      this.col().countDocuments({ userId }),
      this.col().find({ userId }).sort({ streak: -1 }).limit(1).toArray(),
    ]);
    return {
      dueNow,
      dueNext24h: dueTomorrow,
      total,
      longestStreak: best[0]?.streak ?? 0,
    };
  }

  /** Grade a review + schedule next. Returns the updated row so the client
   *  can show "next review in 3 days" feedback. */
  async review(session: any, body: any) {
    const userId = this.ensureUser(session);
    const nodeId = String(body?.nodeId || "").trim();
    const chapterId = String(body?.chapterId || "").trim();
    const grade = String(body?.grade || "") as Grade;
    if (!["again", "hard", "good", "easy"].includes(grade)) {
      throw new BadRequestException("bad grade");
    }
    if (!nodeId || !chapterId) throw new BadRequestException("nodeId + chapterId required");
    const _id = `${userId}:${chapterId}:${nodeId}`;
    const cur = await this.col().findOne({ _id });
    if (!cur) throw new NotFoundException("no such revision — the position may have been unflagged");

    const next = this.applySm2(cur, grade);
    await this.col().updateOne({ _id }, { $set: next });
    return { ok: true, ...next };
  }

  /** SM-2-ish scheduler. Chess memory is more fragile than vocab, so we're
   *  a bit more punishing on ease adjustments. */
  private applySm2(cur: RevisionDoc, grade: Grade): Partial<RevisionDoc> {
    let { interval, ease, streak, reps, lapses } = cur;
    const now = new Date();
    reps += 1;

    if (grade === "again") {
      lapses += 1;
      streak = 0;
      ease = Math.max(1.3, ease - 0.2);
      interval = 1; // back tomorrow (24h)
    } else {
      streak += 1;
      // Ease adjustment
      if (grade === "hard") ease = Math.max(1.3, ease - 0.15);
      else if (grade === "easy") ease = Math.min(3.0, ease + 0.15);
      else /* good */ ease = Math.min(3.0, ease + 0.05);
      // Interval progression
      if (streak === 1) interval = 1;         // first correct → 1 day
      else if (streak === 2) interval = 3;    // second → 3 days
      else if (streak === 3) interval = 7;    // third → 1 week
      else {
        const factor = grade === "hard" ? 0.9 : grade === "easy" ? 1.3 : 1.0;
        interval = Math.round(interval * ease * factor);
      }
      interval = Math.min(MAX_INTERVAL_DAYS, Math.max(1, interval));
    }
    const dueAt = new Date(now.getTime() + interval * DAY_MS);
    return {
      interval, ease, streak, reps, lapses, dueAt,
      lastReviewedAt: now, updatedAt: now,
    };
  }

  /** After a chapter is saved, sync the revisions collection: create rows
   *  for newly-flagged nodes; delete rows for un-flagged ones. Called by
   *  StudiesService.saveChapter for the OWNER. */
  async syncFromChapter(userId: string, studyId: string, chapterId: string) {
    const study = await this.studies().findOne({ _id: studyId });
    if (!study) return;
    const chapter = await this.chapters().findOne({ _id: chapterId, studyId });
    if (!chapter) return;

    const flagged = (chapter.moves || []).filter((m: any) => m.isRevisePoint);
    const flaggedIds = new Set<string>(flagged.map((m: any) => m.id));

    // Delete existing revisions for THIS user + chapter whose node no longer flagged.
    const existing = await this.col().find({ userId, chapterId }).toArray();
    const existingIds = new Set(existing.map((r) => r.nodeId));
    const toDelete = existing.filter((r) => !flaggedIds.has(r.nodeId)).map((r) => r._id);
    if (toDelete.length) await this.col().deleteMany({ _id: { $in: toDelete } });

    // Insert new revisions for newly-flagged nodes.
    const byId = new Map<string, any>((chapter.moves || []).map((m: any) => [m.id, m]));
    const now = new Date();
    const upserts: any[] = [];
    for (const m of flagged) {
      if (existingIds.has(m.id)) continue; // already tracked — don't reset schedule
      const fenBefore = this.fenBeforeNode(m, byId, chapter.startingFen);
      if (!fenBefore) continue;
      const turnColor: "white" | "black" = new Chess(fenBefore).turn() === "w" ? "white" : "black";
      upserts.push({
        _id: `${userId}:${chapterId}:${m.id}`,
        userId,
        studyId,
        chapterId,
        nodeId: m.id,
        bookId: study.sourceBook?.bookId,
        bookChapterNumber: study.sourceBook?.chapterNumber,
        studyTitle: study.title,
        chapterTitle: chapter.title,
        fenBefore,
        expectedUci: m.uci,
        expectedSan: m.san,
        turnColor,
        interval: 1,
        ease: 2.5,
        streak: 0,
        reps: 0,
        lapses: 0,
        dueAt: now,          // due immediately on first sync so students see them today
        lastReviewedAt: null,
        createdAt: now,
        updatedAt: now,
      });
    }
    if (upserts.length) {
      await this.col().insertMany(upserts, { ordered: false }).catch(() => { /* dedupe races */ });
    }
  }

  /** For non-owners viewing a shared study: opt-in to add all flagged
   *  positions to MY queue. Idempotent (safe to re-click). */
  async addStudyToMyQueue(session: any, studyId: string) {
    const userId = this.ensureUser(session);
    const study = await this.studies().findOne({ _id: studyId });
    if (!study) throw new NotFoundException("no such study");
    const chapters = await this.chapters().find({ studyId }).toArray();
    let added = 0;
    for (const chapter of chapters) {
      const before = await this.col().countDocuments({ userId, chapterId: chapter._id });
      await this.syncFromChapter(userId, studyId, chapter._id);
      const after = await this.col().countDocuments({ userId, chapterId: chapter._id });
      added += Math.max(0, after - before);
    }
    return { ok: true, added };
  }

  /** Walk parent chain to compute the FEN of the position BEFORE this move.
   *  For root children, it's chapter.startingFen. */
  private fenBeforeNode(
    node: any,
    byId: Map<string, any>,
    startingFen: string,
  ): string | null {
    // Walk to root, collecting ancestors in order.
    const chain: any[] = [];
    let cur: any = node;
    while (cur?.parentId) {
      const parent = byId.get(cur.parentId);
      if (!parent) return null;
      chain.unshift(parent);
      cur = parent;
    }
    const g = new Chess(startingFen);
    for (const anc of chain) {
      const uci = anc.uci;
      const played = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined } as any);
      if (!played) return null;
    }
    return g.fen();
  }
}
