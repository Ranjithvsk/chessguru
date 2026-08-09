// Phase 4b: class scheduling.
//
// Persists planned classes so students can see a "what's next" list and join at
// the scheduled time. Ad-hoc classes (the existing "Start a class" button, minting
// a random room id on the fly) still work — those simply never touch this
// collection.
//
// Model (Mongo classSchedules): { _id: roomId, title, coach, startAt, durationMin,
//                                 notes, createdAt }. Room id is a short random
// string that doubles as the join URL (same charset the class-ws bus accepts).
//
// Auth: no user gate. Same trust model as the rest of the class feature — the
// link IS the shared secret. Coach's display name is captured in the form so
// students can see who's teaching.

import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, HttpException, HttpStatus } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";

const ROOM_RE = /^[A-Za-z0-9_-]{4,64}$/;
const MAX_TITLE = 120;
const MAX_COACH = 80;
const MAX_NOTES = 2000;

function newRoomId(): string {
  return Math.random().toString(36).slice(2, 8);
}

type ScheduleDoc = {
  _id: string; title: string; coach: string;
  startAt: Date; durationMin: number; notes: string;
  createdAt: Date;
  // Coach identity — set from the session at create time. Anonymous coaches
  // (not signed in) get null and simply lose the ability to cancel/edit later.
  createdByUserId: string | null;
  // Recurrence — materialized at create time. Every doc in a series shares
  // the same seriesId (= the FIRST doc's _id). seriesIndex/seriesTotal drive
  // the "3 of 12" badge on the client. Standalone one-off classes leave
  // seriesId null (implicit series of one).
  seriesId?: string | null;
  seriesIndex?: number;    // 1-based position in the series
  seriesTotal?: number;    // total number of instances originally created
};

const MAX_RECUR = 12;

@Controller("class/schedule")
export class ClassScheduleController {
  constructor(@InjectConnection() private readonly conn: Connection) {}
  private col() { return this.conn.db!.collection<ScheduleDoc>("classSchedules"); }

  // POST /api/class/schedule — create a scheduled class. Body validated + trimmed.
  // Returns the persisted row (including the minted room id / join link).
  @Post()
  async create(@Body() body: unknown, @Req() req: any) {
    const b: any = body ?? {};
    const title = String(b.title ?? "").trim();
    const coach = String(b.coach ?? "").trim();
    const notes = String(b.notes ?? "").trim();
    const durationMin = Math.max(5, Math.min(600, Math.floor(Number(b.durationMin) || 60)));
    const startAtNum = Number(new Date(b.startAt || "").getTime());
    if (!title) throw new HttpException("title required", HttpStatus.BAD_REQUEST);
    if (title.length > MAX_TITLE) throw new HttpException("title too long", HttpStatus.BAD_REQUEST);
    if (coach.length > MAX_COACH) throw new HttpException("coach name too long", HttpStatus.BAD_REQUEST);
    if (notes.length > MAX_NOTES) throw new HttpException("notes too long", HttpStatus.BAD_REQUEST);
    if (!Number.isFinite(startAtNum)) throw new HttpException("bad startAt", HttpStatus.BAD_REQUEST);
    // Recurrence — 'none' or 'weekly'. Count is clamped so the API can't be used to
    // spam thousands of docs from a single request; MAX_RECUR keeps the semester
    // shape sane (12 weeks fits a typical school term).
    const recurrence: "none" | "weekly" = b.recurrence === "weekly" ? "weekly" : "none";
    const count = recurrence === "weekly"
      ? Math.max(1, Math.min(MAX_RECUR, Math.floor(Number(b.recurrenceCount) || 1)))
      : 1;
    const userId: string | null = req?.session?.userId ?? null;
    const username: string | null = req?.session?.username ?? null;
    const coachName = coach || username || "Coach";
    // Materialise N docs. First doc's _id doubles as the seriesId when count>1 so we
    // don't need a separate uuid. One-off classes leave seriesId null.
    const docs: ScheduleDoc[] = [];
    for (let i = 0; i < count; i++) {
      let id = newRoomId();
      for (let r = 0; r < 3; r++) {
        const existing = await this.col().findOne({ _id: id as any }, { projection: { _id: 1 } });
        if (!existing) break;
        id = newRoomId();
      }
      const seriesId = count > 1 ? (i === 0 ? id : docs[0]!._id) : null;
      docs.push({
        _id: id, title, coach: coachName,
        startAt: new Date(startAtNum + i * 7 * 24 * 60 * 60 * 1000),
        durationMin, notes, createdAt: new Date(),
        createdByUserId: userId,
        seriesId, seriesIndex: count > 1 ? i + 1 : undefined,
        seriesTotal: count > 1 ? count : undefined,
      });
    }
    await this.col().insertMany(docs);
    // Return the FIRST doc — that's the "canonical" entry the client navigates into.
    // Client's list refresh will pick up the rest.
    return { ...docs[0], mine: true };
  }

  // GET /api/class/schedule — list live + upcoming classes. Each row gets a
  // `mine: boolean` flag based on the caller's session so the client can render
  // owner-only controls (Delete) without a second round-trip. Rows the caller
  // OWNS also get `attendedCount` so the coach can see roster health at a glance
  // on the landing (fetched via one aggregate to avoid N+1 on busy days).
  // Ended classes are hidden by default (a separate ?past=1 query would return
  // the recent past).
  @Get()
  async list(@Req() req: any) {
    const now = new Date();
    const me: string | null = req?.session?.userId ?? null;
    const rows = await this.col().find({}, { sort: { startAt: 1 } }).limit(200).toArray();
    const live: (ScheduleDoc & { mine: boolean; attendedCount?: number })[] = [];
    const upcoming: (ScheduleDoc & { mine: boolean; attendedCount?: number })[] = [];
    const mineIds: string[] = [];
    for (const r of rows) {
      const endAt = new Date(r.startAt.getTime() + r.durationMin * 60_000);
      if (endAt <= now) continue;
      const mine = !!me && r.createdByUserId === me;
      if (mine) mineIds.push(r._id);
      const flagged = { ...r, mine };
      if (r.startAt <= now) live.push(flagged);
      else upcoming.push(flagged);
    }
    // Attendance counts for the caller's own rows only — students can see live
    // participants directly in the room anyway; coach cares about it on the
    // landing when scanning their schedule.
    if (mineIds.length) {
      const counts = await this.conn.db!.collection("classAttendance").aggregate([
        { $match: { classId: { $in: mineIds } } },
        { $group: { _id: "$classId", n: { $sum: 1 } } },
      ]).toArray();
      const byId = new Map<string, number>(counts.map((c: any) => [c._id, c.n]));
      for (const r of [...live, ...upcoming]) {
        if (r.mine) r.attendedCount = byId.get(r._id) ?? 0;
      }
    }
    return { live, upcoming };
  }

  // PATCH /api/class/schedule/:id  — coach-only edit. Body may include any subset
  // of { title, coach, notes, durationMin }. startAt is intentionally NOT editable
  // here — moving the class time requires re-materializing series positions and
  // is safer as cancel + re-create. Query ?scope=series applies the same change
  // to every FUTURE instance of the series (past instances are historical record
  // and stay untouched).
  @Patch(":id")
  async edit(@Param("id") id: string, @Body() body: unknown, @Query("scope") scope: string, @Req() req: any) {
    if (!ROOM_RE.test(id)) throw new HttpException("bad room", HttpStatus.BAD_REQUEST);
    const me: string | null = req?.session?.userId ?? null;
    if (!me) throw new HttpException("sign in required", HttpStatus.UNAUTHORIZED);
    const row = await this.col().findOne({ _id: id as any });
    if (!row) throw new HttpException("not found", HttpStatus.NOT_FOUND);
    if (row.createdByUserId !== me) throw new HttpException("only the creator can edit", HttpStatus.FORBIDDEN);
    const b: any = body ?? {};
    const patch: Partial<ScheduleDoc> = {};
    if (typeof b.title === "string") {
      const v = b.title.trim();
      if (!v) throw new HttpException("title required", HttpStatus.BAD_REQUEST);
      if (v.length > MAX_TITLE) throw new HttpException("title too long", HttpStatus.BAD_REQUEST);
      patch.title = v;
    }
    if (typeof b.coach === "string") {
      const v = b.coach.trim();
      if (v.length > MAX_COACH) throw new HttpException("coach name too long", HttpStatus.BAD_REQUEST);
      patch.coach = v || "Coach";
    }
    if (typeof b.notes === "string") {
      const v = b.notes.trim();
      if (v.length > MAX_NOTES) throw new HttpException("notes too long", HttpStatus.BAD_REQUEST);
      patch.notes = v;
    }
    if (b.durationMin != null) {
      patch.durationMin = Math.max(5, Math.min(600, Math.floor(Number(b.durationMin) || 60)));
    }
    if (Object.keys(patch).length === 0) return { ok: true, matched: 0 };
    if (scope === "series" && row.seriesId) {
      // Cascade to every FUTURE instance in the series (past instances stay as-is
      // so old attendance / recordings retain the title they were held under).
      const now = new Date();
      const r = await this.col().updateMany({ seriesId: row.seriesId, startAt: { $gte: now } }, { $set: patch });
      return { ok: true, matched: r.matchedCount ?? 0 };
    }
    await this.col().updateOne({ _id: id as any }, { $set: patch });
    return { ok: true, matched: 1 };
  }

  // DELETE /api/class/schedule/:id — coach-only cancel. Deletes the schedule row;
  // does NOT touch any recordings that may already exist for the room (those live
  // in a separate on-disk tree and remain accessible via their known filenames).
  @Delete(":id")
  async cancel(@Param("id") id: string, @Req() req: any) {
    if (!ROOM_RE.test(id)) throw new HttpException("bad room", HttpStatus.BAD_REQUEST);
    const me: string | null = req?.session?.userId ?? null;
    if (!me) throw new HttpException("sign in required", HttpStatus.UNAUTHORIZED);
    const row = await this.col().findOne({ _id: id as any });
    if (!row) throw new HttpException("not found", HttpStatus.NOT_FOUND);
    if (row.createdByUserId !== me) throw new HttpException("only the creator can cancel", HttpStatus.FORBIDDEN);
    await this.col().deleteOne({ _id: id as any });
    return { ok: true };
  }

  // DELETE /api/class/schedule/series/:sid — bulk cancel every FUTURE instance in
  // the series (past instances stay — they're history and may have recordings /
  // attendance rows). Coach-only. Returns how many were removed so the client can
  // show a "N cancelled" toast if it wants.
  @Delete("series/:sid")
  async cancelSeries(@Param("sid") sid: string, @Req() req: any) {
    if (!ROOM_RE.test(sid)) throw new HttpException("bad seriesId", HttpStatus.BAD_REQUEST);
    const me: string | null = req?.session?.userId ?? null;
    if (!me) throw new HttpException("sign in required", HttpStatus.UNAUTHORIZED);
    // Verify ownership on any single doc in the series (they all share the same
    // creator by construction) before touching anything.
    const sample = await this.col().findOne({ seriesId: sid as any });
    if (!sample) throw new HttpException("series not found", HttpStatus.NOT_FOUND);
    if (sample.createdByUserId !== me) throw new HttpException("only the creator can cancel the series", HttpStatus.FORBIDDEN);
    const now = new Date();
    const r = await this.col().deleteMany({ seriesId: sid as any, startAt: { $gt: now } });
    return { ok: true, cancelled: r.deletedCount ?? 0 };
  }

  // GET /api/class/schedule/:id — single class detail. 404 when not found (either
  // never scheduled or an ad-hoc room that never created a schedule row).
  @Get(":id")
  async detail(@Param("id") id: string) {
    if (!ROOM_RE.test(id)) throw new HttpException("bad room", HttpStatus.BAD_REQUEST);
    const row = await this.col().findOne({ _id: id as any });
    if (!row) throw new HttpException("not found", HttpStatus.NOT_FOUND);
    return row;
  }
}
