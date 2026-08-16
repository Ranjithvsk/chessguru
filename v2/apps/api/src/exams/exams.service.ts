// Exams — coach-scheduled, timed, auto-graded tests built on top of the ⭐
// mechanic from Slice 1. A coach picks any study; every ⭐-flagged position
// in that study becomes an exam question. Students take the exam with a
// per-position timer; auto-graded on exact best-move match.
//
// Grading v1: exact expectedUci match. Slice 3 will add partial credit
// ("top-2 engine moves") once we have Stockfish server-side.
//
// Two Mongo collections:
//   `exams`         — one doc per exam (positions[] denormalized from studies)
//   `examAttempts`  — one doc per (student × exam × attempt#)

import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { randomBytes } from "crypto";
import { Chess } from "chess.js";

const MAX_TITLE = 200;
const MAX_DESC = 3000;
const MAX_POSITIONS = 100;
const MAX_ATTEMPTS_LIST = 500;

function shortId(bytes = 8): string { return randomBytes(bytes).toString("base64url"); }

export interface ExamPosition {
  id: string;
  studyId: string;
  chapterId: string;
  nodeId: string;
  fenBefore: string;
  expectedUci: string;
  expectedSan: string;
  turnColor: "white" | "black";
  comment?: string;
  bookId?: string;
  bookChapterNumber?: number;
  order: number;
}

export interface ExamDoc {
  _id: string;
  ownerId: string;
  academyId: string | null;
  title: string;
  description?: string;
  positions: ExamPosition[];
  timePerPosSec: number | null;   // null = untimed
  passMarkPct: number;            // 0..100
  retryable: boolean;
  assignedTo: string[];           // userIds; empty = "everyone in my academy"
  status: "draft" | "published" | "closed";
  dueAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Answer {
  positionId: string;
  playedUci: string | null;       // null = ran out of time / skipped
  playedSan: string | null;
  correct: boolean;
  timeSpentMs: number;
}

export interface AttemptDoc {
  _id: string;
  examId: string;
  userId: string;
  attemptNumber: number;
  startedAt: Date;
  submittedAt: Date | null;
  answers: Answer[];
  score: number;
  totalPositions: number;
  scorePct: number;
  passed: boolean;
}

@Injectable()
export class ExamsService {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  private exams() { return this.conn.db!.collection<ExamDoc>("exams"); }
  private attempts() { return this.conn.db!.collection<AttemptDoc>("examAttempts"); }
  private studies() { return this.conn.db!.collection<any>("studies"); }
  private chapters() { return this.conn.db!.collection<any>("studyChapters"); }
  private users() { return this.conn.db!.collection<any>("users"); }

  private ensureUser(session: any): { userId: string; academyId: string | null } {
    const userId = session?.userId;
    if (!userId) throw new UnauthorizedException("sign in first");
    return { userId: String(userId), academyId: session?.academyId ?? null };
  }

  /** Coach view: exams I own. Student view: exams assigned to me OR
   *  academy-wide (assignedTo empty) in my academy. */
  async listMine(session: any) {
    const { userId, academyId } = this.ensureUser(session);
    const owned = await this.exams().find({ ownerId: userId }).sort({ updatedAt: -1 }).limit(200).toArray();
    const assigned = await this.exams().find({
      ownerId: { $ne: userId },
      status: "published",
      $or: [
        { assignedTo: userId },
        { assignedTo: { $size: 0 }, academyId },
      ],
    }).sort({ dueAt: 1, updatedAt: -1 }).limit(200).toArray();

    // Attach my attempts summary so the list can show "not started / in progress / done: 8/10 (80%)"
    const examIds = [...owned.map((e) => e._id), ...assigned.map((e) => e._id)];
    const myAttempts = examIds.length
      ? await this.attempts().find({ examId: { $in: examIds }, userId }).toArray()
      : [];
    const byExam = new Map<string, AttemptDoc[]>();
    for (const a of myAttempts) {
      const arr = byExam.get(a.examId) ?? [];
      arr.push(a);
      byExam.set(a.examId, arr);
    }
    const decorate = (e: ExamDoc) => {
      const arr = byExam.get(e._id) ?? [];
      const done = arr.filter((a) => a.submittedAt);
      const inProgress = arr.find((a) => !a.submittedAt);
      const best = done.reduce((b, a) => a.scorePct > (b?.scorePct ?? -1) ? a : b, null as AttemptDoc | null);
      return {
        ...e,
        myStatus: inProgress ? "in_progress" : done.length ? "done" : "not_started",
        myBestScorePct: best?.scorePct ?? null,
        myAttempts: done.length,
      };
    };
    return {
      owned: owned.map(decorate),
      assigned: assigned.map(decorate),
    };
  }

  /** Student list for the "assign to..." picker — same-academy students of the caller. */
  async pickableStudents(session: any) {
    const { userId, academyId } = this.ensureUser(session);
    if (!academyId) return { items: [] };
    const items = await this.users().find(
      { academyId, role: { $in: ["student", "coach"] }, _id: { $ne: userId } },
      { projection: { _id: 1, username: 1, name: 1, role: 1 } },
    ).limit(500).toArray();
    return { items };
  }

  async create(session: any, body: any) {
    const { userId, academyId } = this.ensureUser(session);
    const b: any = body ?? {};
    const title = String(b.title || "").trim().slice(0, MAX_TITLE) || "Untitled exam";
    const description = b.description ? String(b.description).slice(0, MAX_DESC) : undefined;
    const timePerPosSec = this.normTime(b.timePerPosSec);
    const passMarkPct = Math.max(0, Math.min(100, Number(b.passMarkPct) || 60));
    const retryable = !!b.retryable;

    const id = shortId(10);
    const now = new Date();
    await this.exams().insertOne({
      _id: id,
      ownerId: userId,
      academyId,
      title,
      description,
      positions: [],
      timePerPosSec,
      passMarkPct,
      retryable,
      assignedTo: [],
      status: "draft",
      dueAt: null,
      createdAt: now,
      updatedAt: now,
    });
    return { examId: id };
  }

  async get(session: any, examId: string) {
    const { userId, academyId } = this.ensureUser(session);
    const exam = await this.exams().findOne({ _id: examId });
    if (!exam) throw new NotFoundException("no such exam");
    const isOwner = exam.ownerId === userId;
    const isAssigned = exam.assignedTo.includes(userId) ||
      (exam.assignedTo.length === 0 && exam.academyId && exam.academyId === academyId);
    if (!isOwner && !(exam.status === "published" && isAssigned)) throw new ForbiddenException("no access");
    // Coach view: return everything. Student view: strip expected answers.
    if (isOwner) return { exam, role: "owner" as const };
    const safe = {
      ...exam,
      positions: exam.positions.map((p) => ({
        id: p.id,
        fenBefore: p.fenBefore,
        turnColor: p.turnColor,
        comment: p.comment, // students see coach's comment as context (not the answer)
        bookId: p.bookId,
        bookChapterNumber: p.bookChapterNumber,
        order: p.order,
        // expectedUci / expectedSan / nodeId / chapterId / studyId hidden
      })) as any,
    };
    return { exam: safe, role: "student" as const };
  }

  async updateMeta(session: any, examId: string, body: any) {
    const { userId } = this.ensureUser(session);
    const exam = await this.exams().findOne({ _id: examId });
    if (!exam) throw new NotFoundException("no such exam");
    if (exam.ownerId !== userId) throw new ForbiddenException("only the owner can edit");
    if (exam.status !== "draft") throw new ForbiddenException("published/closed exams are frozen");

    const b: any = body ?? {};
    const set: any = { updatedAt: new Date() };
    if (typeof b.title === "string") set.title = b.title.trim().slice(0, MAX_TITLE) || exam.title;
    if (typeof b.description === "string") set.description = b.description.slice(0, MAX_DESC);
    if ("timePerPosSec" in b) set.timePerPosSec = this.normTime(b.timePerPosSec);
    if ("passMarkPct" in b) set.passMarkPct = Math.max(0, Math.min(100, Number(b.passMarkPct) || 60));
    if ("retryable" in b) set.retryable = !!b.retryable;
    if (Array.isArray(b.assignedTo)) {
      set.assignedTo = b.assignedTo.filter((x: any) => typeof x === "string").slice(0, 500);
    }
    await this.exams().updateOne({ _id: examId }, { $set: set });
    return { ok: true };
  }

  /** Bulk-add all ⭐ positions from a study as exam questions. Coach's most
   *  common flow — the ⭐ flag already means "worth testing." */
  async addFromStudy(session: any, examId: string, studyId: string) {
    const { userId } = this.ensureUser(session);
    const exam = await this.exams().findOne({ _id: examId });
    if (!exam) throw new NotFoundException("no such exam");
    if (exam.ownerId !== userId) throw new ForbiddenException("only the owner can edit");
    if (exam.status !== "draft") throw new ForbiddenException("published/closed exams are frozen");

    const study = await this.studies().findOne({ _id: studyId, ownerId: userId });
    if (!study) throw new NotFoundException("study not found (or not yours)");
    const chapters = await this.chapters().find({ studyId }).sort({ order: 1 }).toArray();

    const newPositions: ExamPosition[] = [];
    let orderStart = exam.positions.length;
    for (const chapter of chapters) {
      const byId = new Map<string, any>((chapter.moves || []).map((m: any) => [m.id, m]));
      const flagged = (chapter.moves || []).filter((m: any) => m.isRevisePoint);
      for (const m of flagged) {
        if (exam.positions.length + newPositions.length >= MAX_POSITIONS) break;
        const fenBefore = this.fenBeforeNode(m, byId, chapter.startingFen);
        if (!fenBefore) continue;
        const turnColor: "white" | "black" = new Chess(fenBefore).turn() === "w" ? "white" : "black";
        newPositions.push({
          id: shortId(6),
          studyId,
          chapterId: chapter._id,
          nodeId: m.id,
          fenBefore,
          expectedUci: m.uci,
          expectedSan: m.san,
          turnColor,
          comment: m.comment,
          bookId: study.sourceBook?.bookId,
          bookChapterNumber: study.sourceBook?.chapterNumber,
          order: orderStart++,
        });
      }
    }
    if (!newPositions.length) return { ok: true, added: 0 };
    await this.exams().updateOne(
      { _id: examId },
      { $push: { positions: { $each: newPositions } as any }, $set: { updatedAt: new Date() } },
    );
    return { ok: true, added: newPositions.length };
  }

  async removePosition(session: any, examId: string, positionId: string) {
    const { userId } = this.ensureUser(session);
    const exam = await this.exams().findOne({ _id: examId });
    if (!exam) throw new NotFoundException("no such exam");
    if (exam.ownerId !== userId) throw new ForbiddenException("only the owner can edit");
    if (exam.status !== "draft") throw new ForbiddenException("published/closed exams are frozen");
    await this.exams().updateOne(
      { _id: examId },
      { $pull: { positions: { id: positionId } as any }, $set: { updatedAt: new Date() } },
    );
    return { ok: true };
  }

  async publish(session: any, examId: string, body: any) {
    const { userId } = this.ensureUser(session);
    const exam = await this.exams().findOne({ _id: examId });
    if (!exam) throw new NotFoundException("no such exam");
    if (exam.ownerId !== userId) throw new ForbiddenException("only the owner can publish");
    if (exam.status !== "draft") throw new BadRequestException("already published");
    if (exam.positions.length === 0) throw new BadRequestException("exam needs at least one position");

    const dueAt = body?.dueAt ? new Date(body.dueAt) : null;
    await this.exams().updateOne(
      { _id: examId },
      { $set: { status: "published", dueAt, updatedAt: new Date() } },
    );
    return { ok: true };
  }

  async close(session: any, examId: string) {
    const { userId } = this.ensureUser(session);
    const exam = await this.exams().findOne({ _id: examId });
    if (!exam) throw new NotFoundException("no such exam");
    if (exam.ownerId !== userId) throw new ForbiddenException("only the owner can close");
    await this.exams().updateOne(
      { _id: examId },
      { $set: { status: "closed", updatedAt: new Date() } },
    );
    return { ok: true };
  }

  async remove(session: any, examId: string) {
    const { userId } = this.ensureUser(session);
    const exam = await this.exams().findOne({ _id: examId });
    if (!exam) throw new NotFoundException("no such exam");
    if (exam.ownerId !== userId) throw new ForbiddenException("only the owner can delete");
    if (exam.status === "published") throw new BadRequestException("close the exam first");
    await this.exams().deleteOne({ _id: examId });
    await this.attempts().deleteMany({ examId });
    return { ok: true };
  }

  /* ── attempts ───────────────────────────────────────────────────────── */

  async startAttempt(session: any, examId: string) {
    const { userId, academyId } = this.ensureUser(session);
    const exam = await this.exams().findOne({ _id: examId });
    if (!exam) throw new NotFoundException("no such exam");
    if (exam.status !== "published") throw new BadRequestException("exam not open");
    const isAssigned = exam.assignedTo.includes(userId) ||
      (exam.assignedTo.length === 0 && exam.academyId && exam.academyId === academyId);
    if (!isAssigned) throw new ForbiddenException("not assigned to this exam");

    // If there's an unfinished attempt, resume it.
    const open = await this.attempts().findOne({ examId, userId, submittedAt: null });
    if (open) return { attemptId: open._id, attemptNumber: open.attemptNumber, resumed: true };

    // Otherwise: check retry rules.
    const finished = await this.attempts().find({ examId, userId, submittedAt: { $ne: null } }).toArray();
    if (finished.length && !exam.retryable) throw new BadRequestException("you've already taken this exam");

    const attemptNumber = finished.length + 1;
    const attemptId = shortId(10);
    await this.attempts().insertOne({
      _id: attemptId,
      examId,
      userId,
      attemptNumber,
      startedAt: new Date(),
      submittedAt: null,
      answers: [],
      score: 0,
      totalPositions: exam.positions.length,
      scorePct: 0,
      passed: false,
    });
    return { attemptId, attemptNumber, resumed: false };
  }

  async submitAnswer(session: any, examId: string, attemptId: string, body: any) {
    const { userId } = this.ensureUser(session);
    const attempt = await this.attempts().findOne({ _id: attemptId, examId, userId });
    if (!attempt) throw new NotFoundException("no such attempt");
    if (attempt.submittedAt) throw new BadRequestException("attempt already submitted");

    const exam = await this.exams().findOne({ _id: examId });
    if (!exam) throw new NotFoundException("no such exam");

    const positionId = String(body?.positionId || "");
    const pos = exam.positions.find((p) => p.id === positionId);
    if (!pos) throw new NotFoundException("no such position");

    // Reject duplicate answers (client should skip if already answered).
    if (attempt.answers.some((a) => a.positionId === positionId)) {
      return { ok: true, alreadyAnswered: true };
    }

    const playedUci = body?.playedUci ? String(body.playedUci) : null;
    const playedSan = body?.playedSan ? String(body.playedSan).slice(0, 20) : null;
    const timeSpentMs = Math.max(0, Math.min(24 * 60 * 60 * 1000, Number(body?.timeSpentMs) || 0));
    // Grading: exact UCI match for now. (Slice 3 adds top-2 engine match.)
    const correct = !!(playedUci && playedUci === pos.expectedUci);

    await this.attempts().updateOne(
      { _id: attemptId },
      {
        $push: {
          answers: { positionId, playedUci, playedSan, correct, timeSpentMs } as any,
        },
      },
    );
    return { ok: true, correct, expectedSan: pos.expectedSan, expectedUci: pos.expectedUci };
  }

  async finishAttempt(session: any, examId: string, attemptId: string) {
    const { userId } = this.ensureUser(session);
    const attempt = await this.attempts().findOne({ _id: attemptId, examId, userId });
    if (!attempt) throw new NotFoundException("no such attempt");
    if (attempt.submittedAt) return { ok: true, alreadySubmitted: true };

    const exam = await this.exams().findOne({ _id: examId });
    if (!exam) throw new NotFoundException("no such exam");

    const score = attempt.answers.filter((a) => a.correct).length;
    const total = exam.positions.length;
    const scorePct = total > 0 ? Math.round((score / total) * 100) : 0;
    const passed = scorePct >= exam.passMarkPct;

    const now = new Date();
    await this.attempts().updateOne(
      { _id: attemptId },
      { $set: { submittedAt: now, score, totalPositions: total, scorePct, passed } },
    );
    return { ok: true, score, total, scorePct, passed };
  }

  /** Coach: all attempts for their exam. Student: their own attempts on this exam. */
  async results(session: any, examId: string) {
    const { userId } = this.ensureUser(session);
    const exam = await this.exams().findOne({ _id: examId });
    if (!exam) throw new NotFoundException("no such exam");
    const isOwner = exam.ownerId === userId;
    const filter: any = isOwner ? { examId } : { examId, userId };
    const attempts = await this.attempts().find(filter).sort({ submittedAt: -1 }).limit(MAX_ATTEMPTS_LIST).toArray();

    if (isOwner) {
      // Enrich with student names for the coach dashboard.
      const uids = Array.from(new Set(attempts.map((a) => a.userId)));
      const users = uids.length
        ? await this.users().find({ _id: { $in: uids as any } }, { projection: { _id: 1, username: 1, name: 1 } }).toArray()
        : [];
      const uByI = new Map(users.map((u) => [String(u._id), u]));
      // Per-position miss rate — helps coach spot class-wide weakness.
      const missCount = new Map<string, number>();
      for (const a of attempts) {
        if (!a.submittedAt) continue;
        for (const ans of a.answers) if (!ans.correct) missCount.set(ans.positionId, (missCount.get(ans.positionId) ?? 0) + 1);
      }
      const perPosition = exam.positions.map((p) => ({
        id: p.id,
        expectedSan: p.expectedSan,
        chapterId: p.chapterId,
        studyId: p.studyId,
        missCount: missCount.get(p.id) ?? 0,
      }));
      return {
        role: "owner" as const,
        exam,
        attempts: attempts.map((a) => ({
          ...a,
          user: uByI.get(a.userId),
        })),
        perPosition,
      };
    }
    return { role: "student" as const, exam, attempts };
  }

  /* ── helpers ───────────────────────────────────────────────────────── */

  private normTime(v: any): number | null {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.min(600, Math.max(5, Math.round(n)));
  }

  private fenBeforeNode(node: any, byId: Map<string, any>, startingFen: string): string | null {
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
      const played = g.move({ from: anc.uci.slice(0, 2), to: anc.uci.slice(2, 4), promotion: anc.uci.slice(4) || undefined } as any);
      if (!played) return null;
    }
    return g.fen();
  }
}
