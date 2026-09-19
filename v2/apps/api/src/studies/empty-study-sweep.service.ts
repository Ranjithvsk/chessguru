// Empty-study sweeper (owner 2026-09-19: "clean the other users' empties too and fix the creation").
//
// Why: opening a book chapter, a puzzle or a game award creates a study + first chapter at
// once so the editor has somewhere to land. Most are never filled — 29 of 45 studies on
// 2026-09-19 had no moves at all. Together with create()'s de-duplication (an existing empty
// study with the same title and source is reused), this keeps "My studies" honest: once a day,
// studies older than 48 h whose every chapter is still blank move to studies_trash /
// studyChapters_trash (reversible, never a hard delete).
//
// Blank = no moves AND the standard start position AND no headers/tags. A puzzle saved as a
// position only (custom FEN) counts as content and is kept.
import { Injectable, OnModuleInit } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const GRACE_MS = 48 * 3600_000;
const TICK_MS = 24 * 3600_000;

export function chapterIsBlank(ch: any): boolean {
  if (Array.isArray(ch?.moves) && ch.moves.length > 0) return false;
  if (ch?.startingFen && ch.startingFen !== START_FEN) return false;
  if (ch?.headers && Object.keys(ch.headers).length > 0) return false;
  if (Array.isArray(ch?.tags) && ch.tags.length > 0) return false;
  return true;
}

@Injectable()
export class EmptyStudySweepService implements OnModuleInit {
  constructor(@InjectConnection() private readonly conn: Connection) {}
  onModuleInit() {
    setTimeout(() => { this.sweep().catch((e) => console.warn("[empty-study-sweep]", e?.message || e)); }, 5 * 60_000);
    setInterval(() => { this.sweep().catch((e) => console.warn("[empty-study-sweep]", e?.message || e)); }, TICK_MS);
  }

  async sweep(): Promise<{ scanned: number; trashed: number }> {
    const db = this.conn.db!;
    const cutoff = new Date(Date.now() - GRACE_MS);
    const studies = await db.collection("studies").find({ createdAt: { $lt: cutoff }, updatedAt: { $lt: cutoff }, deletedAt: { $exists: false } }).toArray();
    let trashed = 0;
    for (const s of studies as any[]) {
      const chapters = await db.collection("studyChapters").find({ studyId: String(s._id) }).toArray();
      if (!chapters.every(chapterIsBlank)) continue;
      const now = new Date();
      await db.collection("studies_trash").insertOne({ ...s, trashedAt: now, trashedBy: "empty-sweep" });
      if (chapters.length) await db.collection("studyChapters_trash").insertMany(chapters.map((c) => ({ ...c, trashedAt: now })));
      await db.collection("studyChapters").deleteMany({ studyId: String(s._id) });
      await db.collection("studies").deleteOne({ _id: s._id });
      trashed++;
    }
    console.log(`[empty-study-sweep] scanned ${studies.length} stud${studies.length === 1 ? "y" : "ies"} older than 48 h, trashed ${trashed}`);
    return { scanned: studies.length, trashed };
  }
}
