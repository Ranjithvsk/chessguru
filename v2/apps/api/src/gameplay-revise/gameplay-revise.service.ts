import { Injectable } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { ChessdbService } from "../chessdb/chessdb.service";

/**
 * "Gameplay Revise" — coach picks a game (typically from chessdb search), sends
 * it to one or more students. Students walk through move-by-move, guessing each
 * move before the app reveals it (Anki-style spaced-repetition scoring).
 *
 * Data model (Mongo collections in `chessguru`):
 *
 *   gameplayReviseAssignments
 *     _id            ObjectId
 *     coachId        string (user _id)
 *     studentIds     string[]
 *     title          string
 *     sourceGameId   string | null   (chessdb _id if picked from corpus)
 *     pgn            string          (frozen at send-time; even if coach edits later, students still get updates via version bump)
 *     coachNotes     string          (optional annotation the coach adds)
 *     version        number          (bump on any edit → student view refreshes)
 *     createdAt      Date
 *     updatedAt      Date
 *
 *   gameplayReviseProgress
 *     _id            `${assignmentId}:${studentId}`
 *     assignmentId   ObjectId
 *     studentId      string
 *     lastPly        number          (furthest ply student reached)
 *     scoresByPly    Record<ply, {correct: boolean, tries: number, ts: number}>
 *     completedAt    Date | null
 *     lastVersion    number          (last version student consumed → if assignment.version > this, show "Coach updated" badge)
 */
@Injectable()
export class GameplayReviseService {
  constructor(
    @InjectConnection() private readonly conn: Connection,
    private readonly chessdb: ChessdbService,
  ) {}

  private assignments() { return this.conn.db!.collection("gameplayReviseAssignments"); }
  private progress() { return this.conn.db!.collection("gameplayReviseProgress"); }

  // ----- COACH SIDE -----

  async create(coachId: string, opts: { title: string; studentIds: string[]; sourceGameId?: string | null; pgn?: string; coachNotes?: string }) {
    let pgn = opts.pgn || "";
    // If a chessdb game id is provided, pull the game text
    if (!pgn && opts.sourceGameId) {
      const g = (await this.chessdb.game(opts.sourceGameId)) as any;
      if (g) pgn = String(g.moves || "");
    }
    const now = new Date();
    const doc = {
      coachId, studentIds: opts.studentIds || [],
      title: opts.title || "Untitled game",
      sourceGameId: opts.sourceGameId || null,
      pgn,
      coachNotes: opts.coachNotes || "",
      version: 1,
      createdAt: now, updatedAt: now,
    };
    const r = await this.assignments().insertOne(doc as any);
    return { _id: r.insertedId, ...doc };
  }

  async update(assignmentId: string, coachId: string, patch: Partial<{ title: string; studentIds: string[]; pgn: string; coachNotes: string }>) {
    const _id = (await import("mongodb")).ObjectId.createFromHexString(assignmentId);
    const set: any = { updatedAt: new Date() };
    if (patch.title !== undefined) set.title = patch.title;
    if (patch.studentIds !== undefined) set.studentIds = patch.studentIds;
    if (patch.pgn !== undefined) set.pgn = patch.pgn;
    if (patch.coachNotes !== undefined) set.coachNotes = patch.coachNotes;
    const r = await this.assignments().findOneAndUpdate(
      { _id, coachId } as any,
      { $set: set, $inc: { version: 1 } },
      { returnDocument: "after" },
    );
    return r;
  }

  async listByCoach(coachId: string) {
    return await this.assignments().find({ coachId }).sort({ updatedAt: -1 }).limit(100).toArray();
  }

  async delete(assignmentId: string, coachId: string) {
    const _id = (await import("mongodb")).ObjectId.createFromHexString(assignmentId);
    const r = await this.assignments().deleteOne({ _id, coachId } as any);
    // Also cascade progress records
    await this.progress().deleteMany({ assignmentId: _id } as any);
    return { deleted: r.deletedCount };
  }

  // ----- STUDENT SIDE -----

  async listByStudent(studentId: string) {
    return await this.assignments().find({ studentIds: studentId }).sort({ updatedAt: -1 }).toArray();
  }

  async getForStudent(assignmentId: string, studentId: string) {
    const _id = (await import("mongodb")).ObjectId.createFromHexString(assignmentId);
    const assignment = await this.assignments().findOne({ _id, studentIds: studentId } as any);
    if (!assignment) return null;
    const prog = await this.progress().findOne({ _id: `${assignmentId}:${studentId}` } as any);
    return {
      assignment,
      progress: prog || { lastPly: 0, scoresByPly: {}, completedAt: null, lastVersion: 0 },
      updated: prog ? (assignment as any).version > (prog as any).lastVersion : true,
    };
  }

  async recordProgress(assignmentId: string, studentId: string, opts: { ply: number; correct: boolean; tries: number; version: number; completed?: boolean }) {
    const key = `${assignmentId}:${studentId}`;
    const now = Date.now();
    const set: any = {
      assignmentId: (await import("mongodb")).ObjectId.createFromHexString(assignmentId),
      studentId,
      lastPly: opts.ply,
      lastVersion: opts.version,
    };
    if (opts.completed) set.completedAt = new Date();
    const update: any = {
      $set: set,
      $max: { lastPly: opts.ply },
    };
    // Store per-ply score
    update.$set[`scoresByPly.${opts.ply}`] = { correct: opts.correct, tries: opts.tries, ts: now };
    await this.progress().updateOne({ _id: key } as any, update, { upsert: true });
    return { ok: true };
  }
}
