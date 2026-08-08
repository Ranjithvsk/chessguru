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

import { Body, Controller, Delete, Get, Param, Post, Req, HttpException, HttpStatus } from "@nestjs/common";
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
};

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
    // Retry a couple of times on the vanishingly-rare id collision (6-char base36).
    let id = newRoomId();
    for (let i = 0; i < 3; i++) {
      const existing = await this.col().findOne({ _id: id as any }, { projection: { _id: 1 } });
      if (!existing) break;
      id = newRoomId();
    }
    const userId: string | null = req?.session?.userId ?? null;
    const username: string | null = req?.session?.username ?? null;
    const doc: ScheduleDoc = {
      _id: id, title,
      // Default coach display = session username so a logged-in coach doesn't have to
      // retype their name every time. Anonymous coaches fall back to "Coach".
      coach: coach || username || "Coach",
      startAt: new Date(startAtNum), durationMin, notes, createdAt: new Date(),
      createdByUserId: userId,
    };
    await this.col().insertOne(doc);
    return { ...doc, mine: true };
  }

  // GET /api/class/schedule — list live + upcoming classes. Each row gets a
  // `mine: boolean` flag based on the caller's session so the client can render
  // owner-only controls (Delete) without a second round-trip. Ended classes are
  // hidden by default (a separate ?past=1 query would return the recent past).
  @Get()
  async list(@Req() req: any) {
    const now = new Date();
    const me: string | null = req?.session?.userId ?? null;
    const rows = await this.col().find({}, { sort: { startAt: 1 } }).limit(200).toArray();
    const live: (ScheduleDoc & { mine: boolean })[] = [];
    const upcoming: (ScheduleDoc & { mine: boolean })[] = [];
    for (const r of rows) {
      const endAt = new Date(r.startAt.getTime() + r.durationMin * 60_000);
      if (endAt <= now) continue;
      const flagged = { ...r, mine: !!me && r.createdByUserId === me };
      if (r.startAt <= now) live.push(flagged);
      else upcoming.push(flagged);
    }
    return { live, upcoming };
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
