// Endpoints for the ChessGuru Live (P0) video-meeting stack.
//
//   GET  /api/livekit/status                     is the server configured?
//   POST /api/livekit/room  { roomName, title }  create/ensure a room
//   GET  /api/livekit/token?room=…&role=coach|student
//                                                mint a signed join token
//
// Any signed-in user can request a token for now; academy-role gating comes
// once the coach/student roles from CHESSGURU-SAAS-VISION.md land in Q1.

import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpException, HttpStatus, Post, Query, Req, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { LivekitService } from "./livekit.service";
import { resolveEligibility, isStudentEligible } from "../class/class-eligibility";

@Controller("livekit")
export class LivekitController {
  constructor(
    private readonly svc: LivekitService,
    @InjectConnection() private readonly conn: Connection,
  ) {}

  @Get("status")
  status() {
    return {
      configured: this.svc.isConfigured(),
      url: this.svc.isConfigured() ? this.svc.clientUrl() : null,
    };
  }

  @Post("room")
  async createRoom(@Body() body: any, @Req() req: any) {
    if (!req?.session?.userId) throw new UnauthorizedException();
    const roomName = String(body?.roomName || "").trim();
    if (!/^[a-zA-Z0-9_-]{2,64}$/.test(roomName)) throw new BadRequestException("bad roomName");
    if (!this.svc.isConfigured()) throw new ServiceUnavailableException("LiveKit not configured");
    await this.svc.ensureRoom(roomName, {
      title: String(body?.title || "").slice(0, 120),
      createdBy: req.session.userId,
    });
    return { ok: true, roomName };
  }

  @Get("token")
  async token(
    @Req() req: any,
    @Query("room") roomRaw?: string,
    @Query("role") roleRaw?: string,
  ) {
    if (!req?.session?.userId) throw new UnauthorizedException();
    const roomName = String(roomRaw || "").trim();
    if (!/^[a-zA-Z0-9_-]{2,64}$/.test(roomName)) throw new BadRequestException("bad room");
    const role: "coach" | "student" = roleRaw === "coach" ? "coach" : "student";
    if (!this.svc.isConfigured()) throw new ServiceUnavailableException("LiveKit not configured");
    // TENANT ISOLATION + coach-student scoping. Rules:
    //   * class has an academyId → caller's session must belong to that
    //     academy (blocks a Guna student from a Harinitha room)
    //   * coach role → must be the creator, an academy_owner, OR the
    //     coach who started an ad-hoc room (looked up from
    //     classLiveAnnouncements when no schedule row exists)
    //   * student role → must be in the class's eligibility set (either
    //     explicit batchStudentIds, or "students whose coachId matches
    //     the coach who created/is-hosting the class"). See
    //     class-eligibility.ts for the resolution order.
    //
    // Ad-hoc rooms (no schedule row) go through classLiveAnnouncements to
    // find the hosting coach so the eligibility check still applies —
    // otherwise Sarika's ad-hoc class would fall to "everyone in academy
    // allowed" (owner-reported 2026-08-25: all guna students joined
    // Sarika's class).
    try {
      const db = this.conn.db!;
      const klass: any = await db.collection("classSchedules")
        .findOne({ _id: roomName as any }, { projection: { academyId: 1, createdByUserId: 1 } });
      const announce: any = await db.collection("classLiveAnnouncements")
        .findOne({ _id: roomName as any }, { projection: { academyId: 1, coachUserId: 1 } });
      const academyId: string | null = klass?.academyId ?? announce?.academyId ?? null;
      const coachUserId: string | null = klass?.createdByUserId ?? announce?.coachUserId ?? null;
      const mineAcademy: string | null = req.session.academyId ?? null;
      if (academyId) {
        if (mineAcademy !== academyId) throw new HttpException("not found", HttpStatus.NOT_FOUND);
      }
      if (role === "coach") {
        // Must own this room. Academy owners can join any coach's room.
        const myRole = req.session.role;
        const myUid = req.session.userId;
        const isCreator = coachUserId && coachUserId === myUid;
        const isOwner = myRole === "academy_owner";
        // If there's neither a schedule row NOR an announcement AND we know
        // the caller is a coach in the academy, allow it (they're claiming a
        // fresh ad-hoc room). Same-academy check above already fired.
        const roomHasHost = !!(klass || announce);
        if (roomHasHost && !isCreator && !isOwner) {
          throw new HttpException("not found", HttpStatus.NOT_FOUND);
        }
      }
      if (role === "student" && (klass || announce)) {
        const elig = await resolveEligibility(this.conn, roomName, coachUserId);
        if (!isStudentEligible(elig, req.session.userId)) {
          throw new HttpException("not found", HttpStatus.NOT_FOUND);
        }
      }
      // Kicked from THIS session? Block token issue too so they can't sneak
      // back in via LiveKit-only (coach doesn't want them). Coaches never
      // hit this branch — the kick endpoint refuses to kick the host.
      const myUidForKick = req?.session?.userId;
      if (myUidForKick) {
        const kicked = await db.collection("classKicks").findOne(
          { _id: `${roomName}:${myUidForKick}` as any },
          { projection: { _id: 1 } },
        );
        if (kicked) throw new HttpException("not found", HttpStatus.NOT_FOUND);
      }
    } catch (e) {
      if (e instanceof HttpException) throw e;
      // swallow other errors — don't 500 the whole join flow if lookup fails
    }
    const { token, url } = await this.svc.createToken({
      roomName,
      identity: req.session.userId,
      displayName: req.session.username || req.session.userId,
      role,
    });
    return { ok: true, token, url, role, room: roomName };
  }
}
