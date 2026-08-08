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

import { Controller, Get, Param, Req, Res, HttpException, HttpStatus } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
type Response = any;

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

  // GET /api/class/:id/attendance.csv — coach-only download. Gated to the class's
  // schedule creator (or any request when no schedule row exists at all — that's
  // an ad-hoc room where nobody "owns" the class). Renders as a CSV so a coach
  // can archive or forward to parents / a management system.
  @Get(":id/attendance.csv")
  async csv(@Param("id") id: string, @Req() req: any, @Res() res: Response) {
    if (!ROOM_RE.test(id)) throw new HttpException("bad room", HttpStatus.BAD_REQUEST);
    const sched = await this.conn.db!.collection("classSchedules").findOne({ _id: id as any });
    if (sched && sched.createdByUserId) {
      const me: string | null = req?.session?.userId ?? null;
      if (!me || me !== sched.createdByUserId) throw new HttpException("only the class creator can export", HttpStatus.FORBIDDEN);
    }
    const rows: any[] = await this.conn.db!.collection("classAttendance")
      .find({ classId: id }, { sort: { joinedAt: 1 } as any }).limit(5000).toArray();
    // Quote every field that could contain a comma/quote/newline; escape internal
    // quotes by doubling per RFC 4180. Keeps Excel/Sheets happy even when a coach
    // signed up with a comma in their name.
    const q = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = ["userId,name,joinedAt,lastSeenAt"];
    for (const r of rows) {
      lines.push([q(r.userId ?? ""), q(r.name ?? "Guest"), q(new Date(r.joinedAt).toISOString()), q(r.lastSeenAt ? new Date(r.lastSeenAt).toISOString() : "")].join(","));
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="attendance-${id}.csv"`);
    res.send(lines.join("\n"));
  }
}
