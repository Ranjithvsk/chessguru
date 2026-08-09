// Snap-position — coach's mid-class "flag this moment" feature. Captures the
// current FEN + an optional note (audio clip is a later slice). Stores as one
// row per snap in classSnaps.
//
// Auth: session-cookie gated (any signed-in ChessGuru user in the room can
// snap; academy-scoped listing/authz lives in AcademyService).

import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Req, UnauthorizedException } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { randomBytes } from "crypto";

const ROOM_RE = /^[A-Za-z0-9_-]{1,64}$/;
const FEN_RE = /^[a-zA-Z0-9\/\-\s]{10,120}$/;   // loose but catches obvious garbage

@Controller("class")
export class ClassSnapController {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  @Post(":id/snap")
  async snap(@Param("id") id: string, @Req() req: any, @Body() body: any) {
    if (!ROOM_RE.test(id)) throw new BadRequestException("bad room");
    const userId: string | null = req?.session?.userId ?? null;
    if (!userId) throw new UnauthorizedException();
    const username: string | null = req?.session?.username ?? userId;
    const fen = String(body?.fen || "");
    const note = String(body?.note || "").slice(0, 500);
    if (!FEN_RE.test(fen)) throw new BadRequestException("bad fen");
    // Sanitize shapes: coach's live arrows/circles from chessground. Each
    // shape is { orig, dest?, brush? } with algebraic squares like "e4".
    // Anything malformed is dropped; capped at 64 to bound the payload.
    type SnapShape = { orig: string; dest?: string; brush?: string };
    const rawShapes: any[] = Array.isArray(body?.shapes) ? body.shapes.slice(0, 64) : [];
    const SQ_RE = /^[a-h][1-8]$/;
    const BRUSH_RE = /^[a-zA-Z0-9_-]{1,16}$/;
    const shapes: SnapShape[] = [];
    for (const s of rawShapes) {
      if (!s || typeof s.orig !== "string" || !SQ_RE.test(s.orig)) continue;
      const out: SnapShape = { orig: s.orig };
      if (typeof s.dest === "string" && SQ_RE.test(s.dest)) out.dest = s.dest;
      if (typeof s.brush === "string" && BRUSH_RE.test(s.brush)) out.brush = s.brush;
      shapes.push(out);
    }
    const doc = {
      _id: "sn_" + randomBytes(8).toString("base64url"),
      classId: id, fen, note, shapes,
      byUserId: userId, byName: username,
      at: new Date(),
    };
    await this.conn.db!.collection("classSnaps").insertOne(doc as any);
    return { ok: true, id: doc._id, at: doc.at };
  }

  @Get(":id/snaps")
  async list(@Param("id") id: string) {
    if (!ROOM_RE.test(id)) throw new BadRequestException("bad room");
    const rows = await this.conn.db!.collection("classSnaps")
      .find({ classId: id }).sort({ at: -1 }).limit(200).toArray();
    return { snaps: rows };
  }

  // PATCH /api/class/:id/snap/:snapId { note?: string }
  // Only the original author of the snap may edit the note. Owner/coach edit
  // is a follow-up (would need academy resolution); this covers 90% of cases
  // (coach typo fix on their own snap).
  @Patch(":id/snap/:snapId")
  async patch(@Param("id") id: string, @Param("snapId") snapId: string, @Req() req: any, @Body() body: any) {
    if (!ROOM_RE.test(id)) throw new BadRequestException("bad room");
    if (!/^sn_[A-Za-z0-9_-]{6,32}$/.test(snapId)) throw new BadRequestException("bad snap id");
    const userId: string | null = req?.session?.userId ?? null;
    if (!userId) throw new UnauthorizedException();
    const cur = await this.conn.db!.collection("classSnaps").findOne({ _id: snapId as any, classId: id });
    if (!cur) throw new NotFoundException("snap not found");
    if (cur.byUserId !== userId) throw new ForbiddenException("not your snap");
    const $set: Record<string, unknown> = {};
    if (typeof body?.note === "string") $set.note = body.note.slice(0, 500);
    if (Object.keys($set).length === 0) return { ok: true, changed: false };
    await this.conn.db!.collection("classSnaps").updateOne({ _id: snapId as any }, { $set });
    return { ok: true, changed: true };
  }
}
