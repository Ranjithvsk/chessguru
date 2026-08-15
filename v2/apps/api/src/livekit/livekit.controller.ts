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
    // TENANT ISOLATION: if the requested room maps to a scheduled class with
    // an academyId, the caller's session must belong to that same academy.
    // Blocks Harinitha (academy X) from joining a Guna Chess (academy Y) class
    // by knowing the room URL. Ad-hoc rooms (no schedule row) fall through so
    // legacy public meetings still work.
    try {
      const klass: any = await this.conn.db!.collection("classSchedules")
        .findOne({ _id: roomName as any }, { projection: { academyId: 1 } });
      if (klass?.academyId) {
        const mine = req.session.academyId ?? null;
        if (mine !== klass.academyId) throw new HttpException("not found", HttpStatus.NOT_FOUND);
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
