// Watching a class without anyone in it knowing (owner 2026-09-22).
//
// Two things live here:
//   * GET  /api/class/observable          — classes this caller may watch
//   * POST /api/class/:id/observe-token   — a one-shot grant to join silently
//   * GET  /api/class/:id/replay          — a finished class, step by step
//
// WHO. The same two ways in as the Dream Meet stats endpoint, because the
// superadmin lives in a different app on a different domain and holds no
// ChessGuru session — plus the academy owner, who may watch only inside their
// own academy:
//   * a signed-in ChessGuru admin (isAdmin allowlist), or
//   * the superadmin server-side, presenting the shared internal token, or
//   * a signed-in academy_owner whose academyId matches the class.
//
// WHY A GRANT AND NOT A ROLE. The class socket on :4100 believes whatever
// userId a client puts in its hello frame — it has no session. So observer
// authority cannot be asserted over that socket. It is decided HERE, where a
// real session exists, and handed over as a row in Mongo that :4100 redeems
// once and deletes. Short-lived and one-shot, so a token that leaks out of a
// URL or a log is not a way into somebody's classroom.

import { Controller, ForbiddenException, Get, NotFoundException, Param, Post, Query, Req } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { randomBytes } from "crypto";
import { isAdmin } from "../admin/admins";

const STATS_TOKEN = process.env.CHESSGURU_STATS_TOKEN || process.env.DREAMCY_INTERNAL_TOKEN || "";
/** Long enough to open a tab and connect, short enough to be worthless if it leaks. */
const GRANT_TTL_MS = 2 * 60 * 1000;
/** A participant seen within this window counts as "in class right now". */
const LIVE_MS = 3 * 60 * 1000;
const ROOM_ID_RX = /^[A-Za-z0-9_-]{1,64}$/;

type Who = { ok: true; label: string; academyId: string | null; all: boolean } | { ok: false };

@Controller("class")
export class ClassObserveController {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  /** Resolve the caller once. `all` means "may watch any academy". */
  private who(req: any): Who {
    const hdr = String(req?.headers?.["x-internal-token"] || "");
    if (STATS_TOKEN && hdr && hdr === STATS_TOKEN) {
      return { ok: true, label: "superadmin", academyId: null, all: true };
    }
    const uid: string | null = req?.session?.userId ?? null;
    if (!uid) return { ok: false };
    if (isAdmin(uid)) return { ok: true, label: uid, academyId: null, all: true };
    if (req?.session?.role === "academy_owner" && req?.session?.academyId) {
      return { ok: true, label: uid, academyId: String(req.session.academyId), all: false };
    }
    return { ok: false };
  }

  /** The class row + the academy that owns it, from either collection. */
  private async classOf(id: string) {
    const db = this.conn.db!;
    const klass: any = await db.collection("classSchedules").findOne({ _id: id as any });
    const ann: any = await db.collection("classLiveAnnouncements").findOne({ _id: id as any });
    if (!klass && !ann) return null;
    return {
      klass, ann,
      academyId: (klass?.academyId ?? ann?.academyId ?? null) as string | null,
      coachUserId: (klass?.createdByUserId ?? ann?.coachUserId ?? null) as string | null,
      title: (klass?.title ?? "Class") as string,
      startAt: klass?.startAt ?? ann?.at ?? null,
      endedAt: klass?.endedAt ?? null,
    };
  }

  private gate(w: Who, academyId: string | null): asserts w is { ok: true; label: string; academyId: string | null; all: boolean } {
    if (!w.ok) throw new ForbiddenException("not allowed");
    // An academy owner is confined to their own academy. A class with no academy
    // at all is vendor-side only, never theirs.
    if (!w.all && (!academyId || academyId !== w.academyId)) throw new ForbiddenException("not allowed");
  }

  /** Classes this caller may watch — live first, then recent. */
  @Get("observable")
  async observable(@Req() req: any, @Query("days") daysRaw?: string) {
    const w = this.who(req);
    if (!w.ok) throw new ForbiddenException("not allowed");
    const db = this.conn.db!;
    const days = Math.min(Math.max(Number(daysRaw) || 7, 1), 90);
    const since = new Date(Date.now() - days * 86400_000);
    const scope: Record<string, unknown> = w.all ? {} : { academyId: w.academyId };

    const announcements = await db.collection("classLiveAnnouncements")
      .find({ ...scope, at: { $gte: since } }).sort({ at: -1 }).limit(200).toArray();
    const schedules = await db.collection("classSchedules")
      .find({ ...scope, startAt: { $gte: since } }).sort({ startAt: -1 }).limit(200).toArray();

    const byId = new Map<string, any>();
    for (const r of schedules as any[]) {
      byId.set(String(r._id), {
        classId: String(r._id), title: r.title || "Class", coachUserId: r.createdByUserId ?? null,
        academyId: r.academyId ?? null, startAt: r.startAt ?? null, endedAt: r.endedAt ?? null, live: false,
      });
    }
    for (const a of announcements as any[]) {
      const id = String(a._id);
      const prev = byId.get(id) ?? {
        classId: id, title: "Ad-hoc class", coachUserId: a.coachUserId ?? null,
        academyId: a.academyId ?? null, startAt: a.at ?? null, endedAt: null,
      };
      byId.set(id, { ...prev, announcedAt: a.at ?? null });
    }

    // "Live" is decided by people actually present, not by a stale announcement:
    // a class nobody is in is over, whatever the row says.
    const ids = [...byId.keys()];
    const present = await db.collection("classAttendance").aggregate([
      { $match: { classId: { $in: ids }, lastSeenAt: { $gte: new Date(Date.now() - LIVE_MS) } } },
      { $group: { _id: "$classId", n: { $sum: 1 } } },
    ]).toArray();
    const liveCounts = new Map(present.map((p: any) => [String(p._id), p.n as number]));
    const rows = [...byId.values()].map((r) => ({
      ...r, inClass: liveCounts.get(r.classId) ?? 0,
      live: !r.endedAt && (liveCounts.get(r.classId) ?? 0) > 0,
    }));
    rows.sort((a, b) => Number(b.live) - Number(a.live)
      || new Date(b.startAt ?? 0).getTime() - new Date(a.startAt ?? 0).getTime());
    return { ok: true, viewer: w.label, scope: w.all ? "all" : w.academyId, classes: rows.slice(0, 200) };
  }

  /** Mint a one-shot grant to join the class socket invisibly. */
  @Post(":id/observe-token")
  async observeToken(@Req() req: any, @Param("id") id: string) {
    if (!ROOM_ID_RX.test(id)) throw new NotFoundException("no such class");
    const w = this.who(req);
    // Refuse BEFORE looking the class up. Checking existence first answered
    // "does this class id exist?" to anyone who asked — 404 for a made-up id,
    // 403 for a real one — which is a free way to enumerate other people's
    // classrooms.
    if (!w.ok) throw new ForbiddenException("not allowed");
    const info = await this.classOf(id);
    if (!info) throw new NotFoundException("no such class");
    this.gate(w, info.academyId);
    const token = randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + GRANT_TTL_MS);
    await this.conn.db!.collection("classObserverGrants").insertOne({
      _id: token as any, classId: id, watcher: w.label, createdAt: new Date(), expiresAt,
    });
    // Belt and braces: the socket deletes the row on redemption, and this index
    // sweeps anything never redeemed so the collection cannot grow for ever.
    await this.conn.db!.collection("classObserverGrants")
      .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => { /* already there */ });
    return { ok: true, token, classId: id, expiresAt, title: info.title };
  }

  /** Everything needed to replay a class start to finish. */
  @Get(":id/replay")
  async replay(@Req() req: any, @Param("id") id: string) {
    if (!ROOM_ID_RX.test(id)) throw new NotFoundException("no such class");
    const w = this.who(req);
    // Refuse BEFORE looking the class up. Checking existence first answered
    // "does this class id exist?" to anyone who asked — 404 for a made-up id,
    // 403 for a real one — which is a free way to enumerate other people's
    // classrooms.
    if (!w.ok) throw new ForbiddenException("not allowed");
    const info = await this.classOf(id);
    if (!info) throw new NotFoundException("no such class");
    this.gate(w, info.academyId);
    const db = this.conn.db!;
    const [events, attendance, board, features] = await Promise.all([
      db.collection("classEvents").find({ classId: id }).sort({ at: 1 }).limit(20_000).toArray(),
      db.collection("classAttendance").find({ classId: id }).sort({ joinedAt: 1 }).toArray(),
      db.collection("classBoardState").findOne({ _id: id as any }),
      db.collection("classFeatureUse").findOne({ _id: id as any }).catch(() => null),
    ]);
    return {
      ok: true,
      classId: id,
      title: info.title,
      coachUserId: info.coachUserId,
      academyId: info.academyId,
      startAt: info.startAt,
      endedAt: info.endedAt,
      // The move tree as it finished — the events carry the order and the timing,
      // this carries the full variation structure.
      finalBoard: board ? { fen: (board as any).fen, startFen: (board as any).startFen, tree: (board as any).tree, history: (board as any).history } : null,
      events: (events as any[]).map((e) => ({
        at: e.at, type: e.type, fen: e.fen ?? null, move: e.move ?? null,
        cursorPath: e.cursorPath ?? null, cursorIdx: e.cursorIdx ?? null,
        shapes: e.shapes ?? null, locked: e.locked ?? null, hidden: e.hidden ?? null,
      })),
      attendance: (attendance as any[]).map((a) => ({
        userId: a.userId ?? null, name: a.name ?? null, joinedAt: a.joinedAt ?? null, lastSeenAt: a.lastSeenAt ?? null,
      })),
      features: features ?? null,
    };
  }
}
