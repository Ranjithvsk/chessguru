// GET /api/admin/dream-meet-stats — everything the Dreamcy Super Admin needs to
// watch live classes ("Dream Meet") on an ACADEMY and COACH basis: classes
// conducted, attendance, errors, and what is live right now.
//
// Two ways in, because the superadmin lives in a different app on a different
// domain and has no ChessGuru session:
//   * a signed-in ChessGuru admin (isAdmin allowlist), or
//   * the superadmin server-side, presenting the shared internal token.
//
// Shapes worth knowing (they drive every join here):
//   classSchedules  _id = roomId (STRING), academyId (slug STRING),
//                   createdByUserId (coach, STRING), startAt, durationMin,
//                   endedAt, roomKind ("meet" = Dream Meet/LiveKit | "call").
//                   There is NO status field — "conducted" must be derived.
//   classAttendance { classId, key, userId, name, joinedAt, lastSeenAt } — carries
//                   NO academyId/coachId, so per-academy/coach needs a classId join.
//   errorEvents     { at, kind, message, route, url, userId, academyId, n } —
//                   realtime rows (from the :4100 class-ws process) carry the
//                   classId in `url` and no academyId, so they join the same way.
//   academies/users _id are STRINGS (slug / username) — never wrap in ObjectId.
import { Controller, ForbiddenException, Get, Query, Req } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { isAdmin } from "../admin/admins";

const STATS_TOKEN =
  process.env.CHESSGURU_STATS_TOKEN || process.env.DREAMCY_INTERNAL_TOKEN || "";
/** A participant seen within this window counts as "in class right now". */
const LIVE_MS = 3 * 60 * 1000;
/** Pull a classId out of an error's route/url. */
const CLASS_ID_RX = /(?:\/api\/class\/|\/class-v2\/|\/call\/)([A-Za-z0-9_-]{1,64})/;
const ROOM_ID_RX = /^[A-Za-z0-9_-]{1,64}$/;

/** Anything that belongs to a live class, across all three error sources:
 *  realtime (:4100 board-sync + video-signal), the class HTTP API (:4000 —
 *  send-position and friends), and browser crashes on the class pages. */
const DREAM_MEET_MATCH = {
  $or: [
    { kind: "realtime" },
    { route: { $regex: "^/api/class/" } },
    { route: { $regex: "/(class-v2|call)/" } },
    { url: { $regex: "/(class-v2|call)/" } },
  ],
};

type Roll = {
  scheduled: number;
  conducted: number;
  students: number;
  errors: number;
  liveNow: number;
  meet: number;
  call: number;
  lastClassAt: Date | null;
};

const emptyRoll = (): Roll => ({
  scheduled: 0, conducted: 0, students: 0, errors: 0, liveNow: 0, meet: 0, call: 0, lastClassAt: null,
});

@Controller()
export class DreamMeetStatsController {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  @Get("admin/dream-meet-stats")
  async stats(@Req() req: any, @Query("days") daysRaw?: string) {
    const presented = String(req?.headers?.["x-internal-token"] || "");
    const viaToken = !!STATS_TOKEN && presented === STATS_TOKEN;
    if (!viaToken && !isAdmin(req?.session?.userId)) throw new ForbiddenException("admin only");

    const days = Math.min(120, Math.max(1, parseInt(String(daysRaw ?? "30"), 10) || 30));
    const since = new Date(Date.now() - days * 86_400_000);
    const now = Date.now();
    const db = this.conn.db!;

    // ── classes in the window ────────────────────────────────────────────────
    const classes: any[] = await db.collection("classSchedules")
      .find({ startAt: { $gte: since } } as any, {
        projection: { title: 1, coach: 1, createdByUserId: 1, academyId: 1, startAt: 1, durationMin: 1, endedAt: 1, roomKind: 1 },
      })
      .sort({ startAt: -1 })
      .limit(5000)
      .toArray();
    const classById = new Map<string, any>(classes.map((c) => [String(c._id), c]));

    // ── attendance per class (distinct participants + latest heartbeat) ──────
    const attRows: any[] = classes.length
      ? await db.collection("classAttendance").aggregate([
          { $match: { classId: { $in: classes.map((c) => String(c._id)) } } },
          { $group: { _id: "$classId", keys: { $addToSet: "$key" }, lastSeenAt: { $max: "$lastSeenAt" } } },
        ]).toArray()
      : [];
    const attByClass = new Map<string, { students: number; lastSeenAt: Date | null }>(
      attRows.map((a) => [String(a._id), { students: (a.keys || []).length, lastSeenAt: a.lastSeenAt ?? null }]),
    );

    // ── Dream Meet errors in the window ─────────────────────────────────────
    const errs: any[] = await db.collection("errorEvents")
      .find({ at: { $gte: since }, ...DREAM_MEET_MATCH } as any, { projection: { stack: 0 } })
      .sort({ at: -1 })
      .limit(3000)
      .toArray();

    const classIdOf = (e: any): string | null => {
      // Realtime rows put the bare classId in `url`.
      if (e?.kind === "realtime" && typeof e.url === "string" && ROOM_ID_RX.test(e.url)) return e.url;
      const m = CLASS_ID_RX.exec(String(e?.route || "")) || CLASS_ID_RX.exec(String(e?.url || ""));
      return m && m[1] ? m[1] : null;
    };

    // Errors can reference classes older than the window — pull those in too so
    // they still attribute to the right academy/coach.
    const extraIds = [...new Set(errs.map(classIdOf).filter(Boolean) as string[])].filter((id) => !classById.has(id));
    if (extraIds.length) {
      const extra: any[] = await db.collection("classSchedules")
        .find({ _id: { $in: extraIds.slice(0, 2000) } } as any, { projection: { title: 1, createdByUserId: 1, academyId: 1, startAt: 1, roomKind: 1 } })
        .toArray();
      for (const c of extra) classById.set(String(c._id), c);
    }

    // ── roll up ─────────────────────────────────────────────────────────────
    const byAcademy = new Map<string, Roll & { coaches: Set<string> }>();
    const byCoach = new Map<string, Roll & { academyId: string | null }>();
    const liveNow: any[] = [];

    const academyRoll = (id: string) => {
      let r = byAcademy.get(id);
      if (!r) { r = { ...emptyRoll(), coaches: new Set<string>() }; byAcademy.set(id, r); }
      return r;
    };
    const coachRoll = (id: string, academyId: string | null) => {
      let r = byCoach.get(id);
      if (!r) { r = { ...emptyRoll(), academyId }; byCoach.set(id, r); }
      if (!r.academyId && academyId) r.academyId = academyId;
      return r;
    };

    for (const c of classes) {
      const id = String(c._id);
      const aId = c.academyId ? String(c.academyId) : "(none)";
      const cId = c.createdByUserId ? String(c.createdByUserId) : "(unknown)";
      const att = attByClass.get(id);
      const students = att?.students ?? 0;
      // No status field: a class counts as CONDUCTED if it was explicitly ended
      // or somebody actually joined it. A row alone only proves it was booked.
      const conducted = !!c.endedAt || students > 0;
      const live = !c.endedAt && !!att?.lastSeenAt && now - new Date(att.lastSeenAt).getTime() < LIVE_MS;
      const startAt = c.startAt ? new Date(c.startAt) : null;

      for (const r of [academyRoll(aId), coachRoll(cId, c.academyId ? String(c.academyId) : null)]) {
        r.scheduled++;
        if (conducted) r.conducted++;
        r.students += students;
        if (live) r.liveNow++;
        if (c.roomKind === "meet") r.meet++; else if (c.roomKind === "call") r.call++;
        if (startAt && (!r.lastClassAt || startAt > r.lastClassAt)) r.lastClassAt = startAt;
      }
      academyRoll(aId).coaches.add(cId);

      if (live) {
        liveNow.push({
          classId: id,
          title: c.title || "Class",
          academyId: c.academyId ?? null,
          coachId: c.createdByUserId ?? null,
          coachLabel: c.coach ?? null,
          roomKind: c.roomKind ?? null,
          students,
          startAt: c.startAt ?? null,
          lastSeenAt: att?.lastSeenAt ?? null,
        });
      }
    }

    // Errors attribute to the CLASS's academy/coach when we can resolve the
    // class (the erroring user is often a student, not the coach).
    const recentErrors: any[] = [];
    for (const e of errs) {
      const cid = classIdOf(e);
      const klass = cid ? classById.get(cid) : null;
      const aId = String(e.academyId || klass?.academyId || "(none)");
      const cId = String(klass?.createdByUserId || e.userId || "(unknown)");
      const n = Number(e.n) || 1;
      academyRoll(aId).errors += n;
      coachRoll(cId, klass?.academyId ? String(klass.academyId) : null).errors += n;
      if (recentErrors.length < 100) {
        recentErrors.push({
          at: e.at, kind: e.kind, message: e.message, route: e.route ?? null, url: e.url ?? null,
          status: e.status ?? null, n,
          classId: cid, classTitle: klass?.title ?? null,
          academyId: aId === "(none)" ? null : aId,
          coachId: cId === "(unknown)" ? null : cId,
          userId: e.userId ?? null,
        });
      }
    }

    // ── names (academies._id and users._id are STRINGS) ─────────────────────
    const academyIds = [...byAcademy.keys()].filter((k) => k !== "(none)");
    const coachIds = [...byCoach.keys()].filter((k) => k !== "(unknown)");
    const [academyDocs, userDocs] = await Promise.all([
      academyIds.length
        ? db.collection("academies").find({ _id: { $in: academyIds } } as any, { projection: { name: 1 } }).toArray()
        : Promise.resolve([] as any[]),
      coachIds.length
        ? db.collection("users").find({ _id: { $in: coachIds } } as any, { projection: { name: 1, username: 1, role: 1 } }).toArray()
        : Promise.resolve([] as any[]),
    ]);
    const academyName = new Map<string, string>(academyDocs.map((a: any) => [String(a._id), a.name || String(a._id)]));
    const userName = new Map<string, string>(userDocs.map((u: any) => [String(u._id), u.name || u.username || String(u._id)]));

    const strip = (r: Roll) => ({
      scheduled: r.scheduled, conducted: r.conducted, students: r.students,
      errors: r.errors, liveNow: r.liveNow, meet: r.meet, call: r.call, lastClassAt: r.lastClassAt,
    });

    const academies = [...byAcademy.entries()]
      .map(([id, r]) => ({ academyId: id === "(none)" ? null : id, academyName: academyName.get(id) || id, coaches: r.coaches.size, ...strip(r) }))
      .sort((a, b) => b.conducted - a.conducted || b.errors - a.errors);

    const coaches = [...byCoach.entries()]
      .map(([id, r]) => ({
        coachId: id === "(unknown)" ? null : id,
        coachName: userName.get(id) || id,
        academyId: r.academyId,
        academyName: r.academyId ? (academyName.get(r.academyId) || r.academyId) : null,
        ...strip(r),
      }))
      .sort((a, b) => b.conducted - a.conducted || b.errors - a.errors);

    for (const l of liveNow) {
      l.academyName = l.academyId ? (academyName.get(String(l.academyId)) || l.academyId) : null;
      l.coachName = l.coachId ? (userName.get(String(l.coachId)) || l.coachLabel || l.coachId) : l.coachLabel;
    }
    for (const e of recentErrors) {
      e.academyName = e.academyId ? (academyName.get(String(e.academyId)) || e.academyId) : null;
      e.coachName = e.coachId ? (userName.get(String(e.coachId)) || e.coachId) : null;
    }

    const totals = {
      scheduled: classes.length,
      conducted: academies.reduce((n, a) => n + a.conducted, 0),
      students: academies.reduce((n, a) => n + a.students, 0),
      errors: academies.reduce((n, a) => n + a.errors, 0),
      liveNow: liveNow.length,
      academies: academies.length,
      coaches: coaches.length,
    };

    // Error mix by kind, so the panel can say "3 realtime, 1 send-position".
    const errorsByKind: Record<string, number> = {};
    for (const e of errs) errorsByKind[e.kind || "other"] = (errorsByKind[e.kind || "other"] || 0) + (Number(e.n) || 1);

    return { ok: true, generatedAt: new Date(), windowDays: days, totals, errorsByKind, liveNow, academies, coaches, recentErrors };
  }
}
