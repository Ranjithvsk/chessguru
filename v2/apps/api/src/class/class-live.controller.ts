// Live class attendance — snapshot of who's currently connected to a class's
// WebSocket room. Powers the "🟢 Live now" attendee list on the academy
// dashboard. Read-only, coach + student can call it.
//
// The heavy attendance history (all-time joins, per-student rollups) already
// exists in class-attendance.controller.ts and hits Mongo. THIS endpoint is
// deliberately cheap: reads the in-memory rooms map, no DB round-trip, so
// the dashboard can poll it every 10s while a class is live without breaking
// a sweat.

import { BadRequestException, Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { getLiveAttendees } from "./class-ws";
import { PushService } from "../push/push.service";

const ROOM_RE = /^[a-zA-Z0-9_-]{3,32}$/;
// Whitelist the room routes a "join" push may point at — defends the
// notification's deep-link against an open-redirect via a spoofed joinPath, and
// carries the /v2 app base so the service worker resolves it under the SPA
// (a bare /call/... would drop the base and miss the router).
const JOIN_PATH_RE = /^\/v2\/(call|class-v2)\/[A-Za-z0-9_-]{1,64}(\?[A-Za-z0-9_=&%-]*)?$/;

@Controller("class")
export class ClassLiveController {
  constructor(
    @InjectConnection() private readonly conn: Connection,
    private readonly push: PushService,
  ) {}

  /** POST /api/class/:id/going-live — the coach just entered a class room (any
   *  room system: /call or Dream Meet). Fan a Web Push out to every student in
   *  the coach's academy so OFFLINE learners get pulled in, deep-linking to the
   *  exact room the coach is in. Session-authenticated (we trust req.session,
   *  not the URL role), coach/owner only, and idempotent per room for 3h so a
   *  reconnect / double-mount can't re-spam. Students calling it are a silent
   *  no-op. Covers BOTH scheduled classes and ad-hoc "Start class now" rooms. */
  @Post(":id/going-live")
  async goingLive(@Param("id") id: string, @Body() body: any, @Req() req: any) {
    if (!ROOM_RE.test(id)) throw new BadRequestException("bad room id");
    const me: string | null = req?.session?.userId ?? null;
    const role: string | null = req?.session?.role ?? null;
    const academyId: string | null = req?.session?.academyId ?? null;
    // Only an academy coach/owner can summon students — everyone else no-ops.
    if (!me || !academyId || (role !== "coach" && role !== "academy_owner")) return { ok: false };

    let joinPath = typeof body?.joinPath === "string" ? body.joinPath : "";
    if (!JOIN_PATH_RE.test(joinPath)) joinPath = `/v2/call/${id}?board=1`;

    // Idempotent per room for 3h.
    const prev: any = await this.conn.db!.collection("classLiveAnnouncements").findOne(
      { _id: id as any }, { projection: { at: 1 } });
    if (prev && Date.now() - new Date(prev.at).getTime() < 3 * 3_600_000) return { ok: true, already: true };
    await this.conn.db!.collection("classLiveAnnouncements").updateOne(
      { _id: id as any },
      { $set: { at: new Date(), academyId, coachUserId: me, joinPath } },
      { upsert: true },
    );

    const klass: any = await this.conn.db!.collection("classSchedules").findOne(
      { _id: id as any }, { projection: { title: 1 } });
    const coachDoc: any = await this.conn.db!.collection("users").findOne(
      { _id: me as any }, { projection: { name: 1, username: 1 } });
    const title = (body?.title && String(body.title).slice(0, 80)) || klass?.title || "Class";
    const coach = coachDoc?.name || coachDoc?.username || "Your coach";

    const students = await this.conn.db!.collection("users")
      .find({ academyId, role: "student" }, { projection: { _id: 1 } }).toArray();
    let notified = 0;
    await Promise.all(students.map(async (st: any) => {
      if (String(st._id) === String(me)) return;
      const r = await this.push.sendToUser(String(st._id), {
        title: `\u{1F534} ${coach} is live now`,
        body: `${title} has started — tap to join.`,
        url: joinPath,
        tag: `cg-classlive-${id}`,
      });
      if (r.sent > 0) notified++;
    }));
    return { ok: true, notified };
  }

  /** GET /api/class/:id/live-attendance — who's connected right now, plus a
   *  compact all-time-joins list + inferred "missing" (invitees who haven't
   *  joined yet). Auth-lenient: exposing live count during a class is a
   *  discovery aid, not sensitive. */
  /** GET /api/class/live-now — active classes in the caller's academy right now,
   *  including AD-HOC "Start now" rooms (which have no classSchedules row and so
   *  never appear in /class/schedule). Reads classLiveAnnouncements written by
   *  going-live (a coach entering a room) within the last 2h. Powers the in-site
   *  "class live" banner so an ONLINE student sees an ad-hoc class even without
   *  push. Returns the room system as roomKind so the client links correctly. */
  @Get("live-now")
  async liveNow(@Req() req: any) {
    const academyId: string | null = req?.session?.academyId ?? null;
    if (!academyId) return { live: [] };
    const since = new Date(Date.now() - 2 * 3_600_000);
    const rows = await this.conn.db!.collection("classLiveAnnouncements")
      .find({ academyId, at: { $gte: since } }, { projection: { _id: 1, at: 1, coachUserId: 1, joinPath: 1 } })
      .sort({ at: -1 }).limit(10).toArray();
    if (!rows.length) return { live: [] };
    const coachIds = [...new Set(rows.map((r: any) => r.coachUserId).filter(Boolean))];
    const roomIds = rows.map((r: any) => r._id);
    const [coaches, klasses] = await Promise.all([
      this.conn.db!.collection("users").find({ _id: { $in: coachIds } }, { projection: { name: 1, username: 1 } }).toArray(),
      this.conn.db!.collection("classSchedules").find({ _id: { $in: roomIds } }, { projection: { title: 1 } }).toArray(),
    ]);
    const coachName = new Map(coaches.map((u: any) => [String(u._id), u.name || u.username]));
    const titleById = new Map(klasses.map((k: any) => [String(k._id), k.title]));
    return {
      live: rows.map((r: any) => ({
        _id: r._id,
        title: titleById.get(String(r._id)) || "Class",
        coach: coachName.get(String(r.coachUserId)) || "Your coach",
        roomKind: (typeof r.joinPath === "string" && /\/class-v2\//.test(r.joinPath)) ? "meet" : "call",
        startAt: r.at,
        durationMin: 60,
      })),
    };
  }

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
