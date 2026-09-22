// GET /api/admin/dream-meet-stats — everything the Dreamcy Super Admin needs to
// watch live classes ("Dream Meet") on an ACADEMY and COACH basis: classes
// conducted, how long they ACTUALLY ran, attendance, engagement, and errors.
//
// Two ways in, because the superadmin lives in a different app on a different
// domain and has no ChessGuru session:
//   * a signed-in ChessGuru admin (isAdmin allowlist), or
//   * the superadmin server-side, presenting the shared internal token.
//
// Shapes worth knowing (they drive every join here):
//   classSchedules  _id = roomId (STRING), academyId (slug STRING),
//                   createdByUserId (coach, STRING), startAt, durationMin,
//                   endedAt, roomKind ("meet" = Dream Meet | "call").
//                   There is NO status field — "conducted" must be derived.
//   classAttendance { classId, key, userId, name, joinedAt, lastSeenAt } — carries
//                   NO academyId/coachId, so per-academy/coach needs a classId join.
//   classBoardState _id = classId, `history` = the moves actually played.
//   classPositionPacks / classChallenges — both carry classId.
//   errorEvents     realtime rows carry the classId in `url` and no academyId.
//   academies/users _id are STRINGS (slug / username) — never wrap in ObjectId.
import { Controller, ForbiddenException, Get, Query, Req } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { isAdmin } from "../admin/admins";

const STATS_TOKEN =
  process.env.CHESSGURU_STATS_TOKEN || process.env.DREAMCY_INTERNAL_TOKEN || "";
/** A participant seen within this window counts as "in class right now". */
const LIVE_MS = 3 * 60 * 1000;
/** Past this, a class "ran short"/"ran over" rather than just being imprecise. */
const DRIFT_MIN = 10;
/** Sanity ceiling for a derived duration (a tab left open must not read as 9h). */
const MAX_CLASS_MIN = 480;
const CLASS_ID_RX = /(?:\/api\/class\/|\/class-v2\/|\/call\/)([A-Za-z0-9_-]{1,64})/;
const ROOM_ID_RX = /^[A-Za-z0-9_-]{1,64}$/;

/** Anything that belongs to a live class, across all three error sources. */
const DREAM_MEET_MATCH = {
  $or: [
    { kind: "realtime" },
    { route: { $regex: "^/api/class/" } },
    { route: { $regex: "/(class-v2|call)/" } },
    { url: { $regex: "/(class-v2|call)/" } },
  ],
};

type Roll = {
  scheduled: number; conducted: number; students: number; errors: number; liveNow: number;
  meet: number; call: number; lastClassAt: Date | null;
  noShows: number; ranShort: number; ranOver: number; idle: number;
  schedMin: number; actualMin: number; durSamples: number;
  lateMin: number; lateSamples: number;
  moves: number; packs: number; challenges: number;
};
const emptyRoll = (): Roll => ({
  scheduled: 0, conducted: 0, students: 0, errors: 0, liveNow: 0, meet: 0, call: 0, lastClassAt: null,
  noShows: 0, ranShort: 0, ranOver: 0, idle: 0,
  schedMin: 0, actualMin: 0, durSamples: 0, lateMin: 0, lateSamples: 0,
  moves: 0, packs: 0, challenges: 0,
});
const avg = (total: number, n: number) => (n > 0 ? Math.round(total / n) : null);

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
    const ids = classes.map((c) => String(c._id));
    const classById = new Map<string, any>(classes.map((c) => [String(c._id), c]));

    // ── the joins that make quality measurable ──────────────────────────────
    // Attendance is a small collection; pulling the rows lets us derive the span
    // a class was ACTUALLY occupied, which is far more honest than endedAt (a
    // coach who forgets to press End leaves endedAt unset or wildly late).
    const [attRows, boards, packRows, chRows, usageRows] = await Promise.all([
      ids.length ? db.collection("classAttendance").find({ classId: { $in: ids } } as any,
        { projection: { classId: 1, key: 1, joinedAt: 1, lastSeenAt: 1, name: 1, userId: 1 } }).toArray() : Promise.resolve([] as any[]),
      ids.length ? db.collection("classBoardState").find({ _id: { $in: ids } } as any,
        { projection: { history: 1 } }).toArray() : Promise.resolve([] as any[]),
      ids.length ? db.collection("classPositionPacks").aggregate([
        { $match: { classId: { $in: ids } } }, { $group: { _id: "$classId", n: { $sum: 1 } } },
      ]).toArray() : Promise.resolve([] as any[]),
      ids.length ? db.collection("classChallenges").aggregate([
        { $match: { classId: { $in: ids } } }, { $group: { _id: "$classId", n: { $sum: 1 } } },
      ]).toArray() : Promise.resolve([] as any[]),
      // What the coach actually DID — written by class-ws as the class runs, so it
      // is already current for a class still in progress (owner 2026-09-22).
      ids.length ? db.collection("classFeatureUsage").find({ _id: { $in: ids } } as any).toArray()
        : Promise.resolve([] as any[]),
    ]);

    // Raw frame types mean nothing to whoever reads this board, so label them here.
    // Kept in the API (not the UI) so every consumer gets the same wording, and the
    // list is ordered by what happened FIRST — which reads like a story of the class.
    const FEATURE_LABELS: Record<string, string> = {
      move: "Moves on the board",
      annot: "Arrows & circles",
      pointer: "Laser pointer",
      lock: "Board lock",
      orientation: "Flipped the board",
      reset: "Reset the board",
      seek: "Jumped to a move",
      stepBack: "Stepped through the moves",
      stepForward: "Stepped through the moves",
      takeback: "Takeback",
      "load-tree": "Loaded a line (Teach Opening / master game)",
      loadFen: "Loaded a position",
      "offer-position": "Sent a position to notebooks",
      "annotate-move": "Move comments & glyphs",
      "promote-variation": "Edited variations",
      "make-mainline": "Edited variations",
      "delete-from": "Edited variations",
      notation: "Notation panel",
    };
    const featuresByClass = new Map<string, any[]>();
    for (const row of usageRows as any[]) {
      const merged = new Map<string, { label: string; count: number; firstAt: Date | null; lastAt: Date | null }>();
      for (const [key, st] of Object.entries((row?.f ?? {}) as Record<string, any>)) {
        const label = FEATURE_LABELS[key];
        if (!label) continue;                      // unknown/retired frame type
        const first = st?.firstAt ? new Date(st.firstAt) : null;
        const last = st?.lastAt ? new Date(st.lastAt) : null;
        // Several frame types share one label (variation edits, stepping) — sum them.
        const cur = merged.get(label);
        if (cur) {
          cur.count += Number(st?.n) || 0;
          if (first && (!cur.firstAt || first < cur.firstAt)) cur.firstAt = first;
          if (last && (!cur.lastAt || last > cur.lastAt)) cur.lastAt = last;
        } else {
          merged.set(label, { label, count: Number(st?.n) || 0, firstAt: first, lastAt: last });
        }
      }
      featuresByClass.set(String(row._id), [...merged.values()]
        .filter((x) => x.count > 0)
        .sort((x, y) => (+(x.firstAt ?? 0)) - (+(y.firstAt ?? 0))));
    }

    // who joined, and when — the owner reads the names, not just a count (2026-09-17)
    const att = new Map<string, { keys: Set<string>; first: number | null; last: number | null; people: Map<string, { name: string; joinedAt: Date | null; lastSeenAt: Date | null }> }>();
    for (const r of attRows) {
      const k = String(r.classId);
      let a = att.get(k);
      if (!a) { a = { keys: new Set(), first: null, last: null, people: new Map() }; att.set(k, a); }
      if (r.key) a.keys.add(String(r.key));
      {
        const who = String(r.userId || r.key || r.name || "?");
        const prev = a.people.get(who);
        const jd = r.joinedAt ? new Date(r.joinedAt) : null;
        const ls = r.lastSeenAt ? new Date(r.lastSeenAt) : null;
        if (!prev) a.people.set(who, { name: String(r.name || r.userId || "student"), joinedAt: jd, lastSeenAt: ls });
        else {
          if (jd && (!prev.joinedAt || jd < prev.joinedAt)) prev.joinedAt = jd;
          if (ls && (!prev.lastSeenAt || ls > prev.lastSeenAt)) prev.lastSeenAt = ls;
        }
      }
      const j = r.joinedAt ? +new Date(r.joinedAt) : null;
      const s = r.lastSeenAt ? +new Date(r.lastSeenAt) : null;
      if (j != null && (a.first == null || j < a.first)) a.first = j;
      if (s != null && (a.last == null || s > a.last)) a.last = s;
    }
    const movesByClass = new Map<string, number>(boards.map((b: any) => [String(b._id), Array.isArray(b.history) ? b.history.length : 0]));
    const packsByClass = new Map<string, number>(packRows.map((p: any) => [String(p._id), p.n]));
    const chByClass = new Map<string, number>(chRows.map((p: any) => [String(p._id), p.n]));

    // ── Dream Meet errors in the window ─────────────────────────────────────
    const errs: any[] = await db.collection("errorEvents")
      .find({ at: { $gte: since }, ...DREAM_MEET_MATCH } as any, { projection: { stack: 0 } })
      .sort({ at: -1 }).limit(3000).toArray();
    const classIdOf = (e: any): string | null => {
      if (e?.kind === "realtime" && typeof e.url === "string" && ROOM_ID_RX.test(e.url)) return e.url;
      const m = CLASS_ID_RX.exec(String(e?.route || "")) || CLASS_ID_RX.exec(String(e?.url || ""));
      return m && m[1] ? m[1] : null;
    };
    const extraIds = [...new Set(errs.map(classIdOf).filter(Boolean) as string[])].filter((id) => !classById.has(id));
    if (extraIds.length) {
      const extra: any[] = await db.collection("classSchedules")
        .find({ _id: { $in: extraIds.slice(0, 2000) } } as any, { projection: { title: 1, createdByUserId: 1, academyId: 1, startAt: 1, roomKind: 1 } })
        .toArray();
      for (const c of extra) classById.set(String(c._id), c);
    }
    const errByClass = new Map<string, number>();

    // ── per-class facts + roll up ───────────────────────────────────────────
    const byAcademy = new Map<string, Roll & { coaches: Set<string> }>();
    const byCoach = new Map<string, Roll & { academyId: string | null }>();
    const liveNow: any[] = [];
    const classRows: any[] = [];

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
      const a = att.get(id);
      const students = a ? a.keys.size : 0;
      const conducted = !!c.endedAt || students > 0;
      const live = !c.endedAt && !!a?.last && now - a.last < LIVE_MS;
      const startAt = c.startAt ? new Date(c.startAt) : null;
      const scheduledMin = Number(c.durationMin) || 0;
      const moves = movesByClass.get(id) ?? 0;
      const packs = packsByClass.get(id) ?? 0;
      const challenges = chByClass.get(id) ?? 0;

      // ACTUAL duration = from the first person joining to the class ending.
      // Prefer endedAt when the coach pressed End, but never trust it past the
      // last heartbeat; fall back to the heartbeat, clamped so an abandoned tab
      // can't report a nine-hour class.
      let actualMin: number | null = null;
      if (a?.first != null) {
        const endedTs = c.endedAt ? +new Date(c.endedAt) : null;
        const endTs = endedTs != null && a.last != null ? Math.min(endedTs, a.last)
          : endedTs != null ? endedTs
          : a.last;
        if (endTs != null) actualMin = Math.max(0, Math.min(MAX_CLASS_MIN, Math.round((endTs - a.first) / 60000)));
      }
      const deltaMin = actualMin != null && scheduledMin > 0 ? actualMin - scheduledMin : null;
      const lateMin = startAt && a?.first != null ? Math.max(0, Math.round((a.first - +startAt) / 60000)) : null;
      const noShow = students === 0;
      // "Conducted" but nothing actually happened on the board.
      const idle = conducted && moves === 0 && packs === 0 && challenges === 0;

      for (const r of [academyRoll(aId), coachRoll(cId, c.academyId ? String(c.academyId) : null)]) {
        r.scheduled++;
        if (conducted) r.conducted++;
        r.students += students;
        if (live) r.liveNow++;
        if (c.roomKind === "meet") r.meet++; else if (c.roomKind === "call") r.call++;
        if (startAt && (!r.lastClassAt || startAt > r.lastClassAt)) r.lastClassAt = startAt;
        if (noShow) r.noShows++;
        if (idle) r.idle++;
        if (deltaMin != null) {
          r.schedMin += scheduledMin; r.actualMin += actualMin!; r.durSamples++;
          if (deltaMin < -DRIFT_MIN) r.ranShort++;
          else if (deltaMin > DRIFT_MIN) r.ranOver++;
        }
        if (lateMin != null) { r.lateMin += lateMin; r.lateSamples++; }
        r.moves += moves; r.packs += packs; r.challenges += challenges;
      }
      academyRoll(aId).coaches.add(cId);

      classRows.push({
        classId: id, title: c.title || "Class", startAt: c.startAt ?? null,
        academyId: c.academyId ?? null, coachId: c.createdByUserId ?? null, coachLabel: c.coach ?? null,
        roomKind: c.roomKind ?? null, students, scheduledMin, actualMin, deltaMin, lateMin,
        moves, packs, challenges, conducted, noShow, idle, live, endedAt: c.endedAt ?? null,
        // What the owner reads to answer "was this class actually taught, and did anything break
        // while it ran" (2026-09-17): when the first person joined, when the room went quiet or the
        // coach pressed End, and the errors that happened between those two moments. Booked length
        // and over/under-run are not the question.
        firstJoinAt: a?.first != null ? new Date(a.first) : null,
        lastSeenAt: a?.last != null ? new Date(a.last) : null,
        attendees: a ? [...a.people.values()]
          .sort((x, y) => (+(x.joinedAt ?? 0)) - (+(y.joinedAt ?? 0)))
          .slice(0, 30)
          .map((x) => ({ name: x.name, joinedAt: x.joinedAt, lastSeenAt: x.lastSeenAt })) : [],
        errors: 0, errorList: [] as any[],
        // What was used, oldest action first. `[]` = recorded and the board was never
        // touched; `null` = no tally exists at all, i.e. the class ran before usage
        // tracking was recording. Those two must not read the same on the board.
        features: featuresByClass.has(id) ? featuresByClass.get(id) : null,
      });

      if (live) {
        liveNow.push({
          classId: id, title: c.title || "Class",
          academyId: c.academyId ?? null, coachId: c.createdByUserId ?? null, coachLabel: c.coach ?? null,
          roomKind: c.roomKind ?? null, students, startAt: c.startAt ?? null, lastSeenAt: a?.last ? new Date(a.last) : null,
        });
      }
    }

    // Errors attribute to the CLASS's academy/coach when resolvable.
    const recentErrors: any[] = [];
    for (const e of errs) {
      const cid = classIdOf(e);
      const klass = cid ? classById.get(cid) : null;
      const aId = String(e.academyId || klass?.academyId || "(none)");
      const cId = String(klass?.createdByUserId || e.userId || "(unknown)");
      const n = Number(e.n) || 1;
      academyRoll(aId).errors += n;
      coachRoll(cId, klass?.academyId ? String(klass.academyId) : null).errors += n;
      if (cid) errByClass.set(cid, (errByClass.get(cid) || 0) + n);
      if (recentErrors.length < 100) {
        recentErrors.push({
          at: e.at, kind: e.kind, message: e.message, route: e.route ?? null, url: e.url ?? null,
          status: e.status ?? null, n, classId: cid, classTitle: klass?.title ?? null,
          academyId: aId === "(none)" ? null : aId, coachId: cId === "(unknown)" ? null : cId, userId: e.userId ?? null,
        });
      }
    }
    for (const r of classRows) r.errors = errByClass.get(r.classId) || 0;

    // ── names (academies._id and users._id are STRINGS) ─────────────────────
    const academyIds = [...byAcademy.keys()].filter((k) => k !== "(none)");
    const coachIds = [...byCoach.keys()].filter((k) => k !== "(unknown)");
    const [academyDocs, userDocs] = await Promise.all([
      academyIds.length ? db.collection("academies").find({ _id: { $in: academyIds } } as any, { projection: { name: 1 } }).toArray() : Promise.resolve([] as any[]),
      coachIds.length ? db.collection("users").find({ _id: { $in: coachIds } } as any, { projection: { name: 1, username: 1 } }).toArray() : Promise.resolve([] as any[]),
    ]);
    const academyName = new Map<string, string>(academyDocs.map((a: any) => [String(a._id), a.name || String(a._id)]));
    const userName = new Map<string, string>(userDocs.map((u: any) => [String(u._id), u.name || u.username || String(u._id)]));

    const strip = (r: Roll) => ({
      scheduled: r.scheduled, conducted: r.conducted, students: r.students, errors: r.errors,
      liveNow: r.liveNow, meet: r.meet, call: r.call, lastClassAt: r.lastClassAt,
      noShows: r.noShows, ranShort: r.ranShort, ranOver: r.ranOver, idle: r.idle,
      avgScheduledMin: avg(r.schedMin, r.durSamples),
      avgActualMin: avg(r.actualMin, r.durSamples),
      avgDeltaMin: r.durSamples ? Math.round((r.actualMin - r.schedMin) / r.durSamples) : null,
      avgLateMin: avg(r.lateMin, r.lateSamples),
      moves: r.moves, packs: r.packs, challenges: r.challenges,
      avgMoves: avg(r.moves, r.conducted),
    });

    const academies = [...byAcademy.entries()]
      .map(([id, r]) => ({ academyId: id === "(none)" ? null : id, academyName: academyName.get(id) || id, coaches: r.coaches.size, ...strip(r) }))
      .sort((a, b) => b.conducted - a.conducted || b.errors - a.errors);
    const coaches = [...byCoach.entries()]
      .map(([id, r]) => ({
        coachId: id === "(unknown)" ? null : id, coachName: userName.get(id) || id,
        academyId: r.academyId, academyName: r.academyId ? (academyName.get(r.academyId) || r.academyId) : null,
        ...strip(r),
      }))
      .sort((a, b) => b.conducted - a.conducted || b.errors - a.errors);

    const nameUp = (o: any) => {
      o.academyName = o.academyId ? (academyName.get(String(o.academyId)) || o.academyId) : null;
      o.coachName = o.coachId ? (userName.get(String(o.coachId)) || o.coachLabel || o.coachId) : (o.coachLabel ?? null);
      return o;
    };
    liveNow.forEach(nameUp);
    classRows.forEach(nameUp);
    recentErrors.forEach((e) => {
      e.academyName = e.academyId ? (academyName.get(String(e.academyId)) || e.academyId) : null;
      e.coachName = e.coachId ? (userName.get(String(e.coachId)) || e.coachId) : null;
    });

    const durSamples = classRows.filter((r) => r.deltaMin != null);
    const totals = {
      scheduled: classes.length,
      conducted: academies.reduce((n, a) => n + a.conducted, 0),
      students: academies.reduce((n, a) => n + a.students, 0),
      errors: academies.reduce((n, a) => n + a.errors, 0),
      liveNow: liveNow.length,
      academies: academies.length,
      coaches: coaches.length,
      noShows: classRows.filter((r) => r.noShow).length,
      idle: classRows.filter((r) => r.idle).length,
      ranShort: durSamples.filter((r) => r.deltaMin < -DRIFT_MIN).length,
      ranOver: durSamples.filter((r) => r.deltaMin > DRIFT_MIN).length,
      durSamples: durSamples.length,
      avgDeltaMin: durSamples.length
        ? Math.round(durSamples.reduce((n, r) => n + r.deltaMin, 0) / durSamples.length) : null,
      avgLateMin: (() => { const s = classRows.filter((r) => r.lateMin != null); return s.length ? Math.round(s.reduce((n, r) => n + r.lateMin, 0) / s.length) : null; })(),
      packs: classRows.reduce((n, r) => n + r.packs, 0),
      challenges: classRows.reduce((n, r) => n + r.challenges, 0),
    };

    // The classes that most need a look: biggest shortfall first, then no-shows.
    const worst = [...durSamples].sort((a, b) => a.deltaMin - b.deltaMin).slice(0, 15);

    // Hang each error on the class it happened during. An error that names its class id wins;
    // otherwise it belongs to whichever class was running at that moment (first join → ended /
    // last heartbeat), which is how a coach recognises it.
    {
      const rowById = new Map<string, any>(classRows.map((r) => [r.classId, r]));
      const windows = classRows
        .filter((r) => r.firstJoinAt)
        .map((r) => ({ row: r, from: +new Date(r.firstJoinAt), to: r.endedAt ? +new Date(r.endedAt) : (r.lastSeenAt ? +new Date(r.lastSeenAt) : +new Date(r.firstJoinAt)) }))
        .sort((x, y) => x.from - y.from);
      for (const e of errs) {
        const n = Number(e.n) || 1;
        let row = null as any;
        const cid = classIdOf(e);
        if (cid && rowById.has(cid)) row = rowById.get(cid);
        if (!row && e.at) {
          const t = +new Date(e.at);
          const hit = windows.find((w) => t >= w.from && t <= w.to + 60_000);
          if (hit) row = hit.row;
        }
        if (!row) continue;
        row.errors += n;
        if (row.errorList.length < 8) {
          row.errorList.push({ at: e.at, kind: e.kind ?? null, message: e.message ?? null, status: e.status ?? null, n });
        }
      }
    }

    const errorsByKind: Record<string, number> = {};
    for (const e of errs) errorsByKind[e.kind || "other"] = (errorsByKind[e.kind || "other"] || 0) + (Number(e.n) || 1);

    return {
      ok: true, generatedAt: new Date(), windowDays: days, driftMin: DRIFT_MIN,
      totals, errorsByKind, liveNow, academies, coaches, recentErrors,
      worst, classes: classRows.slice(0, 300),
    };
  }
}
