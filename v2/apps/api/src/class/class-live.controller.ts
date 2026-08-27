// Live class attendance — snapshot of who's currently connected to a class's
// WebSocket room. Powers the "🟢 Live now" attendee list on the academy
// dashboard. Read-only, coach + student can call it.
//
// The heavy attendance history (all-time joins, per-student rollups) already
// exists in class-attendance.controller.ts and hits Mongo. THIS endpoint is
// deliberately cheap: reads the in-memory rooms map, no DB round-trip, so
// the dashboard can poll it every 10s while a class is live without breaking
// a sweat.

import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { getLiveAttendees, closeClassRoom, kickFromClassRoom } from "./class-ws";
import { PushService } from "../push/push.service";
import { resolveEligibility, isStudentEligible } from "./class-eligibility";

const ROOM_RE = /^[a-zA-Z0-9_-]{3,32}$/;
// Whitelist the room routes a "join" push may point at — defends the
// notification's deep-link against an open-redirect via a spoofed joinPath, and
// carries the /v2 app base so the service worker resolves it under the SPA
// (a bare /call/... would drop the base and miss the router).
const JOIN_PATH_RE = /^\/(v2\/)?(call|class-v2)\/[A-Za-z0-9_-]{1,64}(\?[A-Za-z0-9_=&%-]*)?$/;

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
    // The old in-app WebRTC-mesh CallRoom was retired 2026-08-12. Any
    // announcement that doesn't ship its own valid /class-v2/... path defaults
    // to Dream Meet — the sole live-class surface.
    if (!JOIN_PATH_RE.test(joinPath)) joinPath = `/class-v2/${id}?role=student`;

    // Idempotent per room for 3h (skips push re-spam on reconnect).
    const prev: any = await this.conn.db!.collection("classLiveAnnouncements").findOne(
      { _id: id as any }, { projection: { at: 1 } });
    const alreadyRecent = !!(prev && Date.now() - new Date(prev.at).getTime() < 3 * 3_600_000);
    // ALWAYS upsert the current row (updates `at` even if already recent, so
    // the live-now feed reflects the LATEST activity in this room).
    await this.conn.db!.collection("classLiveAnnouncements").updateOne(
      { _id: id as any },
      { $set: { at: new Date(), academyId, coachUserId: me, joinPath } },
      { upsert: true },
    );
    // Wipe any OTHER older announcements from THIS coach in THIS academy —
    // otherwise students see a stale room link at the top of live-now and land
    // in an abandoned room where the coach isn't (owner-reported 2026-08-12).
    // One live class per coach at any moment is a safe assumption.
    await this.conn.db!.collection("classLiveAnnouncements").deleteMany({
      _id: { $ne: id as any },
      academyId, coachUserId: me,
    });
    if (alreadyRecent) return { ok: true, already: true };
    // Owner-hardened 2026-08-25 ROUND 2: going-live NEVER fires the push
    // anymore. The class-v2 page always opens the audience picker on coach
    // entry, and only PATCH /audience fires the push (to the coach's
    // freshly-picked recipients). This closes the last leak reported by
    // the owner: "after clicking Dream Meet itself, notification shows,
    // in background class starts and wait for joining" — students got
    // pinged before the coach had a chance to narrow down. The
    // announcement row is still written so the in-app live-now banner
    // picks the room up for whoever's already logged in.
    return { ok: true, deferred: true };
  }

  /** GET /api/class/:id/audience — audience state + picker options.
   *  Returns the current audience selection (kind, batchId, studentIds) plus
   *  the coach's batches and students so the picker UI can render without
   *  another round-trip. Coach/owner only; other roles get {}. */
  @Get(":id/audience")
  async getAudience(@Param("id") id: string, @Req() req: any) {
    if (!ROOM_RE.test(id)) throw new BadRequestException("bad room id");
    const me: string | null = req?.session?.userId ?? null;
    const role: string | null = req?.session?.role ?? null;
    const academyId: string | null = req?.session?.academyId ?? null;
    if (!me || !academyId || (role !== "coach" && role !== "academy_owner")) return {};
    const db = this.conn.db!;
    const klass: any = await db.collection("classSchedules").findOne(
      { _id: id as any },
      { projection: { batchStudentIds: 1, audienceKind: 1, audienceBatchId: 1, createdByUserId: 1, academyId: 1 } },
    );
    // Coach can only see audience for classes they host.
    if (klass && klass.createdByUserId && klass.createdByUserId !== me && role !== "academy_owner") {
      return {};
    }
    const batchFilter: any = { academyId };
    if (role === "coach") batchFilter.coachUserId = me;
    const batches = await db.collection("academyBatches")
      .find(batchFilter, { projection: { _id: 1, name: 1, studentIds: 1 } })
      .sort({ createdAt: -1 }).limit(50).toArray();
    const studentFilter: any = { academyId, role: "student" };
    if (role === "coach") studentFilter.coachId = me;
    const students = await db.collection("users")
      .find(studentFilter, { projection: { _id: 1, name: 1, username: 1 } })
      .sort({ name: 1 }).limit(500).toArray();
    return {
      audienceKind: klass?.audienceKind ?? null,
      audienceBatchId: klass?.audienceBatchId ?? null,
      batchStudentIds: Array.isArray(klass?.batchStudentIds) ? klass.batchStudentIds : null,
      batches: batches.map((b: any) => ({ _id: String(b._id), name: b.name, memberCount: (b.studentIds ?? []).length })),
      students: students.map((u: any) => ({ _id: String(u._id), name: u.name || u.username || String(u._id) })),
    };
  }

  /** PATCH /api/class/:id/audience — coach picks who can join + who gets
   *  notified. Body: { kind, batchId?, studentIds?, notify? }. kind is
   *  "batch" | "coach_students" | "individuals" | "academy". "academy" is
   *  owner-only (opens the room to the whole tenant). Coach picks resolve
   *  ONLY within their own students so a coach can't invite another coach's
   *  students by id. Writes batchStudentIds on classSchedules (creating an
   *  ad-hoc row if there is none — matches the classic "Start now" flow).
   *  If notify != false, fires push to the resolved audience with the same
   *  tag as going-live so the notification stack de-dupes. Owner ask
   *  2026-08-25 ("coach needs option to select batch, coach students, or
   *  individual person, the person selected can only join the class, and
   *  only they should get notification"). */
  @Patch(":id/audience")
  async setAudience(@Param("id") id: string, @Body() body: any, @Req() req: any) {
    if (!ROOM_RE.test(id)) throw new BadRequestException("bad room id");
    const me: string | null = req?.session?.userId ?? null;
    const role: string | null = req?.session?.role ?? null;
    const academyId: string | null = req?.session?.academyId ?? null;
    if (!me || !academyId || (role !== "coach" && role !== "academy_owner")) {
      return { ok: false, error: "forbidden" };
    }
    const kind = String(body?.kind || "").trim();
    if (!["batch", "coach_students", "individuals", "academy"].includes(kind)) {
      throw new BadRequestException("bad kind");
    }
    if (kind === "academy" && role !== "academy_owner") {
      return { ok: false, error: "only-owner-can-open-to-academy" };
    }
    const db = this.conn.db!;

    // Resolve studentIds based on kind. Coach picks always intersect with
    // the coach's own students so no cross-coach leak.
    let studentIds: string[] = [];
    let audienceBatchId: string | null = null;
    if (kind === "batch") {
      audienceBatchId = String(body?.batchId || "").trim();
      if (!audienceBatchId) throw new BadRequestException("batchId required");
      const batchFilter: any = { _id: audienceBatchId as any, academyId };
      if (role === "coach") batchFilter.coachUserId = me;
      const batch: any = await db.collection("academyBatches").findOne(batchFilter);
      if (!batch) return { ok: false, error: "batch-not-found" };
      studentIds = (batch.studentIds || []).map(String);
    } else if (kind === "coach_students") {
      const rows = await db.collection("users")
        .find({ academyId, role: "student", coachId: me }, { projection: { _id: 1 } })
        .toArray();
      studentIds = rows.map((r: any) => String(r._id));
    } else if (kind === "individuals") {
      const rawIds = Array.isArray(body?.studentIds) ? body.studentIds.map(String) : [];
      if (!rawIds.length) throw new BadRequestException("studentIds required");
      const filter: any = { academyId, role: "student", _id: { $in: rawIds as any } };
      if (role === "coach") filter.coachId = me;
      const rows = await db.collection("users").find(filter, { projection: { _id: 1 } }).toArray();
      studentIds = rows.map((r: any) => String(r._id));
    } else {
      // "academy" — owner opens to whole tenant. studentIds stays [] and
      // batchStudentIds gets $unset so resolveEligibility falls back to
      // unrestricted (rule 3 in class-eligibility.ts).
      studentIds = [];
    }

    // Ensure the classSchedules row exists so batchStudentIds sticks
    // (ad-hoc "Start now" rooms don't have one). Minimal doc — matches the
    // shape the schedule-controller edits, so /schedule list picks it up.
    const now = new Date();
    const update: any = {
      audienceKind: kind,
      audienceBatchId,
      audienceUpdatedAt: now,
    };
    if (kind === "academy") update.batchStudentIds = null;
    else update.batchStudentIds = studentIds;
    await db.collection("classSchedules").updateOne(
      { _id: id as any },
      {
        $set: update,
        $setOnInsert: {
          title: (typeof body?.title === "string" && body.title.trim()) || "Ad-hoc class",
          coach: "", startAt: now, durationMin: 60, notes: "", createdAt: now,
          createdByUserId: me, academyId, roomKind: "meet",
        },
      },
      { upsert: true },
    );
    // Clear batchStudentIds field explicitly when opening to academy (a
    // $set: {batchStudentIds: null} above stamps null; resolveEligibility
    // treats missing OR non-array as unrestricted, so this is safe).
    if (kind === "academy") {
      await db.collection("classSchedules").updateOne(
        { _id: id as any }, { $unset: { batchStudentIds: "" } },
      );
    }

    // Push to the audience (unless coach opted out via notify:false).
    let notified = 0;
    if (body?.notify !== false && (kind === "academy" || studentIds.length > 0)) {
      const klass: any = await db.collection("classSchedules").findOne(
        { _id: id as any }, { projection: { title: 1 } });
      const coachDoc: any = await db.collection("users").findOne(
        { _id: me as any }, { projection: { name: 1, username: 1 } });
      const title = (typeof body?.title === "string" && body.title.slice(0, 80)) || klass?.title || "Class";
      const coach = coachDoc?.name || coachDoc?.username || "Your coach";
      const joinPath = `/class-v2/${id}?role=student`;

      let recipientQuery: any = { academyId, role: "student" };
      if (kind !== "academy") recipientQuery._id = { $in: studentIds as any };
      const recipients = await db.collection("users")
        .find(recipientQuery, { projection: { _id: 1 } }).toArray();
      await Promise.all(recipients.map(async (st: any) => {
        if (String(st._id) === String(me)) return;
        const r = await this.push.sendToUser(String(st._id), {
          title: `\u{1F534} ${coach} is live now`,
          body: `${title} has started — tap to join.`,
          url: joinPath,
          tag: `cg-classlive-${id}`,     // same tag as going-live → replaces any prior notif
        });
        if (r.sent > 0) notified++;
      }));
      // Stamp the announcement so live-now feed reflects "latest activity"
      // — mirrors going-live's upsert without repeating the 3h idempotency
      // check (the picker is an explicit coach action).
      await db.collection("classLiveAnnouncements").updateOne(
        { _id: id as any },
        { $set: { at: new Date(), academyId, coachUserId: me, joinPath } },
        { upsert: true },
      );
    }
    return { ok: true, kind, audienceCount: studentIds.length, notified };
  }

  /** POST /api/class/:id/kick — coach removes a student from this ONE class
   *  session. Adds the studentId to an in-memory + persisted per-class
   *  kick-list; class-ws refuses further connections from that user AND
   *  drops any open sockets. Persisted (classKicks collection) so a page
   *  reload doesn't let them back in. Scoped per class — being kicked from
   *  today's session doesn't affect tomorrow's. Owner ask 2026-08-25. */
  @Post(":id/kick")
  async kick(@Param("id") id: string, @Body() body: any, @Req() req: any) {
    if (!ROOM_RE.test(id)) throw new BadRequestException("bad room id");
    const me: string | null = req?.session?.userId ?? null;
    const role: string | null = req?.session?.role ?? null;
    if (!me) return { ok: false, error: "auth" };
    if (role !== "coach" && role !== "academy_owner") return { ok: false, error: "forbidden" };
    // Ownership check: coach must be host of THIS room (creator or ad-hoc
    // announcer). Academy owners can kick from any room in their academy.
    const db = this.conn.db!;
    const klass: any = await db.collection("classSchedules")
      .findOne({ _id: id as any }, { projection: { createdByUserId: 1, academyId: 1 } });
    const announce: any = await db.collection("classLiveAnnouncements")
      .findOne({ _id: id as any }, { projection: { coachUserId: 1, academyId: 1 } });
    const roomAcademy = klass?.academyId ?? announce?.academyId ?? null;
    const hostUid = klass?.createdByUserId ?? announce?.coachUserId ?? null;
    const mineAcademy: string | null = req?.session?.academyId ?? null;
    if (roomAcademy && mineAcademy !== roomAcademy) return { ok: false, error: "forbidden" };
    const isHost = hostUid && hostUid === me;
    const isOwner = role === "academy_owner";
    if (!isHost && !isOwner) return { ok: false, error: "forbidden" };
    const targetUid = String(body?.userId || "").trim();
    if (!targetUid || targetUid.length > 64) throw new BadRequestException("bad userId");
    if (targetUid === me) return { ok: false, error: "cannot-kick-self" };
    if (hostUid && targetUid === hostUid) return { ok: false, error: "cannot-kick-host" };
    // Persist so a page reload can't re-join. Composite id keeps it
    // per-class-per-user + idempotent on re-kick clicks.
    const rowId = `${id}:${targetUid}`;
    await db.collection("classKicks").updateOne(
      { _id: rowId as any },
      { $set: { classId: id, userId: targetUid, kickedByUserId: me, kickedAt: new Date() } },
      { upsert: true },
    );
    const { dropped } = kickFromClassRoom(id, targetUid);
    return { ok: true, kicked: true, socketsDropped: dropped };
  }

  /** DELETE /api/class/:id/kick/:userId — undo a kick (coach may have
   *  clicked the wrong name). Removes the persisted row so the student
   *  can re-join if their tab is still open (WS re-connects on wake). */
  @Post(":id/unkick")
  async unkick(@Param("id") id: string, @Body() body: any, @Req() req: any) {
    if (!ROOM_RE.test(id)) throw new BadRequestException("bad room id");
    const me: string | null = req?.session?.userId ?? null;
    const role: string | null = req?.session?.role ?? null;
    if (!me || (role !== "coach" && role !== "academy_owner")) return { ok: false };
    const targetUid = String(body?.userId || "").trim();
    if (!targetUid) throw new BadRequestException("bad userId");
    const rowId = `${id}:${targetUid}`;
    const r = await this.conn.db!.collection("classKicks").deleteOne({ _id: rowId as any });
    return { ok: true, removed: r.deletedCount ?? 0 };
  }

  /** GET /api/class/:id/kicks — who has been kicked from this session.
   *  Coach uses this to show a small "removed from this class" list with
   *  an Undo button. Academy-scoped read; anyone in the academy can see
   *  the list (small, not sensitive). */
  @Get(":id/kicks")
  async listKicks(@Param("id") id: string, @Req() req: any) {
    if (!ROOM_RE.test(id)) throw new BadRequestException("bad room id");
    const rows = await this.conn.db!.collection("classKicks")
      .find({ classId: id }, { projection: { userId: 1, kickedByUserId: 1, kickedAt: 1 } })
      .sort({ kickedAt: -1 })
      .limit(50)
      .toArray();
    if (!rows.length) return { kicks: [] };
    const uids = [...new Set(rows.map((r: any) => String(r.userId)))];
    const users = await this.conn.db!.collection("users")
      .find({ _id: { $in: uids as any } }, { projection: { name: 1, username: 1 } })
      .toArray();
    const nameById = new Map(users.map((u: any) => [String(u._id), u.name || u.username || String(u._id)]));
    return {
      kicks: rows.map((r: any) => ({
        userId: String(r.userId),
        name: nameById.get(String(r.userId)) || String(r.userId),
        kickedAt: r.kickedAt,
      })),
    };
  }

  /** POST /api/class/:id/end — coach explicitly ended the class. Deletes the
   *  live-now announcement AND kicks every student in the class-ws room (they
   *  get a `classEnded` frame + a hard socket close so their tab bails out).
   *  Session-authed, coach/owner only. Idempotent: calling on a room that's
   *  already gone is a no-op. Owner ask (2026-08-12): one live class per
   *  coach, ended = kicked, no more stale rooms hanging around. */
  @Post(":id/end")
  async endClass(@Param("id") id: string, @Req() req: any) {
    if (!ROOM_RE.test(id)) throw new BadRequestException("bad room id");
    const me: string | null = req?.session?.userId ?? null;
    const role: string | null = req?.session?.role ?? null;
    const academyId: string | null = req?.session?.academyId ?? null;
    if (!me || !academyId || (role !== "coach" && role !== "academy_owner")) return { ok: false };

    // Only the coach who OWNS the announcement can end it (defence against a
    // rogue coach in the same academy nuking another's live class).
    const doc: any = await this.conn.db!.collection("classLiveAnnouncements").findOne(
      { _id: id as any }, { projection: { coachUserId: 1, academyId: 1 } });
    if (doc && doc.coachUserId && doc.coachUserId !== me) return { ok: false, reason: "not-your-class" };

    await this.conn.db!.collection("classLiveAnnouncements").deleteOne({ _id: id as any });
    // Also stamp the schedule row (if this id maps to one) so the /schedule
    // list stops surfacing it as live — otherwise a coach who ends inside the
    // startAt..endAt window watches the "🔴 live now" banner spring back up on
    // the next 5s poll (owner-reported 2026-08-18: "clicked but didn't close").
    await this.conn.db!.collection("classSchedules").updateOne(
      { _id: id as any },
      { $set: { endedAt: new Date(), endedByUserId: me } },
    ).catch(() => {});
    const { closed } = closeClassRoom(id, "coach_left");
    return { ok: true, kicked: closed };
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
  /** GET /api/class/attendance-today — every class (scheduled or ad-hoc) with
   *  at least one attendance record for the caller's academy today, plus a
   *  distinct-student total. Powers the "👥 Attendance today" card on the
   *  academy homepage (owner ask 2026-08-12). Academy-scoped: coach/owner
   *  only. Uses local calendar day of the SERVER — good enough since all
   *  academies here run on Asia/Kolkata timezone anchoring in the SSR layer. */
  @Get("attendance-today")
  async attendanceToday(@Req() req: any) {
    const academyId: string | null = req?.session?.academyId ?? null;
    if (!academyId) return { classes: [], totalStudents: 0, totalJoins: 0 };
    // "Today" in server UTC — good enough; the dashboard shows the number, not
    // a to-the-minute timestamp.
    const start = new Date(); start.setUTCHours(0, 0, 0, 0);
    const end   = new Date(start); end.setUTCDate(end.getUTCDate() + 1);
    // Which classes in THIS academy had any attendance today?
    const classIds = await this.conn.db!.collection("classSchedules")
      .find({ academyId }, { projection: { _id: 1 } })
      .toArray()
      .then((rows: any[]) => rows.map((r) => r._id));
    if (!classIds.length) return { classes: [], totalStudents: 0, totalJoins: 0 };
    const attendance = await this.conn.db!.collection("classAttendance")
      .find({ classId: { $in: classIds }, joinedAt: { $gte: start, $lt: end } },
            { projection: { classId: 1, userId: 1, name: 1, joinedAt: 1 } })
      .toArray();
    if (!attendance.length) return { classes: [], totalStudents: 0, totalJoins: 0 };
    // Group by classId
    const byClass = new Map<string, { classId: string; attendees: Array<{ userId: string | null; name: string; joinedAt: Date }> }>();
    const distinct = new Set<string>();
    for (const a of attendance as any[]) {
      const cid = String(a.classId);
      if (!byClass.has(cid)) byClass.set(cid, { classId: cid, attendees: [] });
      byClass.get(cid)!.attendees.push({ userId: a.userId ?? null, name: a.name ?? "Guest", joinedAt: a.joinedAt });
      distinct.add(a.userId ? `u:${a.userId}` : `g:${a.name}`);
    }
    // Fetch class titles + coach names for display
    const classes = await this.conn.db!.collection("classSchedules")
      .find({ _id: { $in: [...byClass.keys()] } as any },
            { projection: { title: 1, coach: 1, startAt: 1 } })
      .toArray();
    const meta = new Map<string, any>(classes.map((c: any) => [String(c._id), c]));
    const rows = [...byClass.values()].map((g) => {
      const m = meta.get(g.classId) || {};
      return {
        classId: g.classId,
        title: m.title || "Class",
        coach: m.coach || "",
        startAt: m.startAt || null,
        count: g.attendees.length,
        distinctCount: new Set(g.attendees.map((a) => a.userId ? `u:${a.userId}` : `g:${a.name}`)).size,
        attendees: g.attendees.sort((a, b) => new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime()),
      };
    }).sort((a, b) => new Date(b.startAt || 0).getTime() - new Date(a.startAt || 0).getTime());
    return { classes: rows, totalStudents: distinct.size, totalJoins: attendance.length };
  }

  @Get("live-now")
  async liveNow(@Req() req: any) {
    const academyId: string | null = req?.session?.academyId ?? null;
    const meUid: string | null = req?.session?.userId ?? null;
    const meRole: string | null = req?.session?.role ?? null;
    if (!academyId) return { live: [] };
    const since = new Date(Date.now() - 2 * 3_600_000);
    const rows = await this.conn.db!.collection("classLiveAnnouncements")
      .find({ academyId, at: { $gte: since } }, { projection: { _id: 1, at: 1, coachUserId: 1, joinPath: 1 } })
      .sort({ at: -1 }).limit(10).toArray();
    if (!rows.length) return { live: [] };
    // Filter out live classes this student isn't eligible for. Coach +
    // academy_owner see everything in-academy so they can supervise.
    // Owner-fixed 2026-08-25: previously every guna student saw Sarika's
    // live-now entry regardless of who her assigned students were.
    //
    // Owner-hardened 2026-08-25 ROUND 3: student live-now HIDES any room
    // whose audience the coach hasn't explicitly picked yet. The push
    // fix (round 2) blocked the push notification, but the in-app
    // "🟢 Live now" banner was still popping the instant the coach
    // clicked Dream Meet — because going-live writes the announcement
    // row before the audience picker even opens. Now: room only shows
    // in student live-now once classSchedules.audienceKind is set (or
    // batchStudentIds explicitly populated). Coaches / owners still see
    // every announcement so they can supervise / clean up stalled rooms.
    let visible = rows;
    // Owner-fixed 2026-08-27: coaches used to see EVERY live announcement in
    // their academy — including private 1-on-1s they weren't invited to.
    // Raagul was getting "Join now" popups for gunachess's ad-hoc class with
    // deepakcharanv on its roster. Now coaches only see their OWN room OR a
    // room where they were explicitly added to the audience. Owners still
    // see everything (their supervisory role still needs the visibility).
    if (meRole === "student" || meRole === "coach") {
      const roomIds = rows.map((r: any) => r._id);
      const schedules = await this.conn.db!.collection("classSchedules")
        .find({ _id: { $in: roomIds } }, { projection: { _id: 1, audienceKind: 1, batchStudentIds: 1 } })
        .toArray();
      const scheduleById = new Map(schedules.map((s: any) => [String(s._id), s]));
      const checks = await Promise.all(rows.map(async (r: any) => {
        // A coach always sees their OWN live room, regardless of audience
        // picker state — they're the one running it.
        if (meRole === "coach" && meUid && r.coachUserId === meUid) return true;
        const sched: any = scheduleById.get(String(r._id));
        // Audience must be explicitly picked — no picker done = no banner.
        const audiencePicked = !!sched && (sched.audienceKind || (Array.isArray(sched.batchStudentIds) && sched.batchStudentIds.length > 0));
        if (!audiencePicked) return false;
        const elig = await resolveEligibility(this.conn, String(r._id), r.coachUserId ?? null);
        return isStudentEligible(elig, meUid);
      }));
      visible = rows.filter((_r, i) => checks[i]);
    }
    if (!visible.length) return { live: [] };
    const coachIds = [...new Set(visible.map((r: any) => r.coachUserId).filter(Boolean))];
    const roomIds = visible.map((r: any) => r._id);
    const [coaches, klasses] = await Promise.all([
      this.conn.db!.collection("users").find({ _id: { $in: coachIds } }, { projection: { name: 1, username: 1 } }).toArray(),
      this.conn.db!.collection("classSchedules").find({ _id: { $in: roomIds } }, { projection: { title: 1 } }).toArray(),
    ]);
    const coachName = new Map(coaches.map((u: any) => [String(u._id), u.name || u.username]));
    const titleById = new Map(klasses.map((k: any) => [String(k._id), k.title]));
    return {
      live: visible.map((r: any) => ({
        _id: r._id,
        title: titleById.get(String(r._id)) || "Class",
        coach: coachName.get(String(r.coachUserId)) || "Your coach",
        roomKind: "meet" as const,   // every live class is Dream Meet now (in-app mesh CallRoom retired 2026-08-12)
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

  /** GET /api/class/my-open — active class rooms this coach OWNS, so they can
   *  clean up abandoned "Going live" rooms they forgot to end. Bounded to the
   *  last 12h — anything older is definitely stale + auto-purged elsewhere.
   *  Coach/owner only; returns empty for students. Each row carries the class
   *  title (when known), the join path, and the started-at time so the UI can
   *  show a "started 40 min ago — end this" widget. */
  @Get("my-open")
  async myOpen(@Req() req: any) {
    const me: string | null = req?.session?.userId ?? null;
    const role: string | null = req?.session?.role ?? null;
    const academyId: string | null = req?.session?.academyId ?? null;
    if (!me || !academyId || (role !== "coach" && role !== "academy_owner")) return { open: [] };
    const since = new Date(Date.now() - 12 * 3_600_000);
    const rows: any[] = await this.conn.db!.collection("classLiveAnnouncements")
      .find({ academyId, coachUserId: me, at: { $gte: since } },
            { projection: { _id: 1, at: 1, joinPath: 1 } })
      .sort({ at: -1 }).limit(20).toArray();
    if (!rows.length) return { open: [] };
    const titleById = new Map<string, string>();
    const roomIds = rows.map((r) => r._id);
    const klasses = await this.conn.db!.collection("classSchedules")
      .find({ _id: { $in: roomIds } }, { projection: { title: 1 } }).toArray();
    for (const k of klasses as any[]) titleById.set(String(k._id), String(k.title || ""));
    return {
      open: rows.map((r) => ({
        _id: String(r._id),
        title: titleById.get(String(r._id)) || "Ad-hoc class",
        joinPath: String(r.joinPath || ""),
        startedAt: r.at,
      })),
    };
  }
}
