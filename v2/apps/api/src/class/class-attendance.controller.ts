// Attendance list for a class — populated by class-ws.ts on WS join/leave and read
// here for display on the class page + coach's landing card.
//
// Auth: no user gate today. Anyone in the class (which is anyone with the URL) can
// see who's attended. The class URL is the shared secret; the panel is a nicer view
// of what Jitsi's participant list already shows live.
//
// Data (classAttendance collection): one doc per (classId, key) with
//   { classId, key, userId, name, joinedAt, lastSeenAt }
// Key = userId when signed in, "guest:<name>" otherwise. A rejoin updates
// lastSeenAt but preserves the original joinedAt.

import { Controller, Get, Param, HttpException, HttpStatus } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";

const ROOM_RE = /^[A-Za-z0-9_-]{4,64}$/;

@Controller("class")
export class ClassAttendanceController {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  // GET /api/class/:id/attendance — sorted by joinedAt asc so the display reads
  // as an arrival order. Anonymous joiners have userId: null.
  @Get(":id/attendance")
  async list(@Param("id") id: string) {
    if (!ROOM_RE.test(id)) throw new HttpException("bad room", HttpStatus.BAD_REQUEST);
    const col = this.conn.db!.collection("classAttendance");
    const rows = await col.find({ classId: id }, { sort: { joinedAt: 1 } as any }).limit(500).toArray();
    return { attendees: rows.map((r: any) => ({
      userId: r.userId ?? null, name: r.name ?? "Guest",
      joinedAt: r.joinedAt, lastSeenAt: r.lastSeenAt,
    })) };
  }
}
