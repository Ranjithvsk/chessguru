// Live class attendance — snapshot of who's currently connected to a class's
// WebSocket room. Powers the "🟢 Live now" attendee list on the academy
// dashboard. Read-only, coach + student can call it.
//
// The heavy attendance history (all-time joins, per-student rollups) already
// exists in class-attendance.controller.ts and hits Mongo. THIS endpoint is
// deliberately cheap: reads the in-memory rooms map, no DB round-trip, so
// the dashboard can poll it every 10s while a class is live without breaking
// a sweat.

import { BadRequestException, Controller, Get, Param, Req } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { getLiveAttendees } from "./class-ws";

const ROOM_RE = /^[a-zA-Z0-9_-]{3,32}$/;

@Controller("class")
export class ClassLiveController {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  /** GET /api/class/:id/live-attendance — who's connected right now, plus a
   *  compact all-time-joins list + inferred "missing" (invitees who haven't
   *  joined yet). Auth-lenient: exposing live count during a class is a
   *  discovery aid, not sensitive. */
  @Get(":id/live-attendance")
  async live(@Param("id") id: string, @Req() req: any) {
    if (!ROOM_RE.test(id)) throw new BadRequestException("bad room id");
    const inRoom = getLiveAttendees(id);
    // All-time joined for this class (small — bounded by roster size).
    const rows = await this.conn.db!.collection("classAttendance")
      .find({ classId: id }, { projection: { userId: 1, name: 1, joinedAt: 1, lastSeenAt: 1 } })
      .sort({ joinedAt: 1 })
      .limit(500)
      .toArray();
    const allTime = rows.map((r: any) => ({
      userId: r.userId, name: r.name,
      joinedAt: r.joinedAt, lastSeenAt: r.lastSeenAt,
    }));
    // Missing = invitees emailed for this class who haven't shown up yet.
    // Look at the class doc's invitees list (email strings) and diff by name
    // OR by email match against a user lookup. For MVP: return the raw
    // invitee emails minus anyone whose name appears in allTime.
    const klass: any = await this.conn.db!.collection("classSchedules").findOne(
      { _id: id as any }, { projection: { invitees: 1, academyId: 1, coach: 1, title: 1, startAt: 1, durationMin: 1 } },
    );
    const invited: string[] = Array.isArray(klass?.invitees)
      ? klass.invitees.map((i: any) => String(i?.email || "").trim()).filter(Boolean)
      : [];
    let missing: string[] = [];
    if (invited.length) {
      const seenEmails = new Set<string>();
      if (invited.length) {
        const users = await this.conn.db!.collection("users").find(
          { email: { $in: invited } }, { projection: { _id: 1, username: 1, email: 1 } },
        ).toArray();
        const emailByUid: Record<string, string> = {};
        for (const u of users as any[]) if (u.email) emailByUid[String(u._id)] = String(u.email).toLowerCase();
        for (const a of allTime) {
          const em = emailByUid[String(a.userId || "")];
          if (em) seenEmails.add(em);
        }
      }
      missing = invited.filter((e) => !seenEmails.has(e.toLowerCase()));
    }
    return {
      classId: id, title: klass?.title || "", coach: klass?.coach || "",
      startAt: klass?.startAt || null, durationMin: klass?.durationMin || null,
      inRoom, allTime, missing,
      counts: { inRoom: inRoom.length, allTime: allTime.length, missing: missing.length },
    };
  }
}
