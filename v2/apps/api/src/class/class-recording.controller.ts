// Phase 3c: browser-side class recording endpoints.
//
// Coach's browser captures screen via MediaRecorder + getDisplayMedia and posts the
// resulting .webm blob here as application/octet-stream. Files are stored on disk
// under RECORDINGS_DIR/<classId>/<isoTimestamp>.webm — one directory per class,
// one file per stop.
//
// Tenant-isolated 2026-08-27: every endpoint now requires a logged-in caller
// whose session.academyId matches the class row (classSchedules OR
// classLiveAnnouncements). Coaches uploading a recording must also be the
// creator of the class (or an academy_owner). Older comment about "URL is the
// shared secret" was wrong for a multi-tenant setup — a leaked classId used
// to hand every other tenant read access to the video. Same isolation shape
// as /api/livekit/token (see livekit.controller.ts).
//
// A future upgrade to server-side Jibri recording (Dream Meet's upstream stack
// supports it) can write into the same directory tree and reuse the list/
// download endpoints as-is.

import { Body, Controller, Get, Param, Post, Req, Res, HttpException, HttpStatus, UnauthorizedException, ForbiddenException } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
// Response typed as `any` — @types/express isn't in the api's deps and we only
// use setHeader/status/json/pipe, all supported on the runtime object.
type Response = any;
import { promises as fs, createReadStream, statSync } from "fs";
import { join } from "path";

const RECORDINGS_DIR = process.env.CLASS_RECORDINGS_DIR
  ?? "/home/ubuntu/chessguru-recordings";
// Match the parseRoomId regex in class-ws.ts so a room known to the sync bus is
// exactly the set of ids we accept here. Prevents path traversal by construction.
const ROOM_RE = /^[A-Za-z0-9_-]{1,64}$/;
const FILE_RE = /^[A-Za-z0-9._-]{1,80}\.webm$/;

@Controller("class")
export class ClassRecordingController {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  /** Ensure the caller has read access to this class's recordings. Same
   *  policy as /api/livekit/token: session required, and session.academyId
   *  MUST match the class's academyId. Returns { academyId, coachUserId }
   *  so upload can additionally require creator/owner. Throws if not
   *  found (unknown classId with no schedule + no announcement) — we no
   *  longer treat unknown ids as public. */
  private async requireTenantAccess(req: any, classId: string): Promise<{ academyId: string | null; coachUserId: string | null }> {
    if (!req?.session?.userId) throw new UnauthorizedException();
    const db = this.conn.db!;
    const klass: any = await db.collection("classSchedules")
      .findOne({ _id: classId as any }, { projection: { academyId: 1, createdByUserId: 1 } });
    const announce: any = await db.collection("classLiveAnnouncements")
      .findOne({ _id: classId as any }, { projection: { academyId: 1, coachUserId: 1 } });
    if (!klass && !announce) throw new HttpException("not found", HttpStatus.NOT_FOUND);
    const academyId: string | null = klass?.academyId ?? announce?.academyId ?? null;
    const coachUserId: string | null = klass?.createdByUserId ?? announce?.coachUserId ?? null;
    const mineAcademy: string | null = req.session.academyId ?? null;
    // Unscoped legacy class (academyId null) is only visible to a logged-in
    // caller with no academy either — otherwise treat as isolated.
    if (academyId && mineAcademy !== academyId) throw new HttpException("not found", HttpStatus.NOT_FOUND);
    if (!academyId && mineAcademy) throw new HttpException("not found", HttpStatus.NOT_FOUND);
    return { academyId, coachUserId };
  }

  // POST /api/class/:id/recording  — coach uploads a full .webm blob after Stop.
  // Body arrives as a raw Buffer (see main.ts express.raw hook on this path).
  @Post(":id/recording")
  async upload(@Param("id") id: string, @Body() body: Buffer, @Req() req: any, @Res() res: Response) {
    if (!ROOM_RE.test(id)) throw new HttpException("bad room", HttpStatus.BAD_REQUEST);
    const { coachUserId } = await this.requireTenantAccess(req, id);
    // Only the class's own coach (or an academy_owner) may upload — a student
    // in the same academy shouldn't be dropping .webms into a class directory.
    const isCreator = coachUserId && coachUserId === req.session.userId;
    const isOwner = req.session.role === "academy_owner";
    if (!isCreator && !isOwner) throw new ForbiddenException("only the class coach can upload");
    if (!Buffer.isBuffer(body) || body.byteLength === 0) throw new HttpException("empty body", HttpStatus.BAD_REQUEST);
    // Coarse sanity cap: 500MB is ~2h at typical MediaRecorder bitrates.
    if (body.byteLength > 500 * 1024 * 1024) throw new HttpException("too large", HttpStatus.PAYLOAD_TOO_LARGE);
    const dir = join(RECORDINGS_DIR, id);
    await fs.mkdir(dir, { recursive: true });
    const filename = `${new Date().toISOString().replace(/[:.]/g, "-")}.webm`;
    const full = join(dir, filename);
    await fs.writeFile(full, body);
    res.status(HttpStatus.CREATED).json({ filename, bytes: body.byteLength });
  }

  // GET /api/class/:id/recordings — list recordings (name/size/created) for the class.
  // Empty array when the class has no recordings yet.
  @Get(":id/recordings")
  async list(@Param("id") id: string, @Req() req: any) {
    if (!ROOM_RE.test(id)) throw new HttpException("bad room", HttpStatus.BAD_REQUEST);
    await this.requireTenantAccess(req, id);
    const dir = join(RECORDINGS_DIR, id);
    let entries: string[] = [];
    try { entries = await fs.readdir(dir); } catch { return { recordings: [] }; }
    const rows = await Promise.all(entries.filter((e) => FILE_RE.test(e)).map(async (name) => {
      const st = await fs.stat(join(dir, name)).catch(() => null);
      if (!st) return null;
      return { name, bytes: st.size, createdAt: st.mtime.toISOString() };
    }));
    return { recordings: rows.filter(Boolean).sort((a: any, b: any) => (a!.createdAt < b!.createdAt ? 1 : -1)) };
  }

  // GET /api/class/:id/recording/:filename — stream the file. Content-Type is webm
  // so <video src> playback works in-browser.
  @Get(":id/recording/:filename")
  async download(@Param("id") id: string, @Param("filename") filename: string, @Req() req: any, @Res() res: Response) {
    if (!ROOM_RE.test(id))    throw new HttpException("bad room", HttpStatus.BAD_REQUEST);
    if (!FILE_RE.test(filename)) throw new HttpException("bad filename", HttpStatus.BAD_REQUEST);
    await this.requireTenantAccess(req, id);
    const full = join(RECORDINGS_DIR, id, filename);
    // stat() first so we can 404 cleanly rather than pipe an error mid-stream.
    let size = 0;
    try { size = statSync(full).size; } catch { throw new HttpException("not found", HttpStatus.NOT_FOUND); }
    res.setHeader("Content-Type", "video/webm");
    res.setHeader("Content-Length", String(size));
    res.setHeader("Cache-Control", "private, max-age=3600");
    createReadStream(full).pipe(res);
  }

  // POST /api/class/:id/recording/:filename/timeline — sidecar JSON with the moves
  // played during the recording, timestamped relative to record-start. Called by
  // the coach's browser AFTER the .webm upload completes. Small enough (few KB
  // even for a long class) that we accept it as a normal JSON body — no raw hook.
  @Post(":id/recording/:filename/timeline")
  async postTimeline(@Param("id") id: string, @Param("filename") filename: string, @Body() body: unknown, @Req() req: any) {
    if (!ROOM_RE.test(id))    throw new HttpException("bad room", HttpStatus.BAD_REQUEST);
    if (!FILE_RE.test(filename)) throw new HttpException("bad filename", HttpStatus.BAD_REQUEST);
    const { coachUserId } = await this.requireTenantAccess(req, id);
    const isCreator = coachUserId && coachUserId === req.session.userId;
    const isOwner = req.session.role === "academy_owner";
    if (!isCreator && !isOwner) throw new ForbiddenException("only the class coach can upload");
    // Validate shape: { events: [{ tMs: int, move: {from, to, promotion?} }, ...] }.
    // Malformed rows are dropped rather than rejecting the whole payload — the
    // primary asset is the video, timeline is an accompaniment that must never
    // block saving.
    const raw = (body as any)?.events;
    if (!Array.isArray(raw)) throw new HttpException("bad body", HttpStatus.BAD_REQUEST);
    const events: Array<{ tMs: number; move: { from: string; to: string; promotion?: string } }> = [];
    for (const e of raw) {
      if (typeof e?.tMs !== "number" || !e.move) continue;
      const m = e.move;
      if (typeof m.from !== "string" || typeof m.to !== "string") continue;
      if (!/^[a-h][1-8]$/.test(m.from) || !/^[a-h][1-8]$/.test(m.to)) continue;
      events.push({ tMs: Math.max(0, Math.round(e.tMs)),
                    move: { from: m.from, to: m.to, promotion: typeof m.promotion === "string" ? m.promotion : undefined } });
      if (events.length >= 5000) break;   // 5000 moves = 15+ hours of chess, well past any real class
    }
    const dir = join(RECORDINGS_DIR, id);
    // Only accept a timeline for a video that actually exists — sidecar for a
    // non-existent recording is meaningless (and would allow noise in the dir).
    try { statSync(join(dir, filename)); } catch { throw new HttpException("recording not found", HttpStatus.NOT_FOUND); }
    await fs.writeFile(join(dir, filename + ".timeline.json"), JSON.stringify({ events }));
    return { ok: true, count: events.length };
  }

  // GET /api/class/:id/recording/:filename/timeline — returns { events: [] } if
  // no sidecar exists yet (a recording made before this feature landed) so the
  // replay page can render the video without a board and never crash.
  @Get(":id/recording/:filename/timeline")
  async getTimeline(@Param("id") id: string, @Param("filename") filename: string, @Req() req: any) {
    if (!ROOM_RE.test(id))    throw new HttpException("bad room", HttpStatus.BAD_REQUEST);
    if (!FILE_RE.test(filename)) throw new HttpException("bad filename", HttpStatus.BAD_REQUEST);
    await this.requireTenantAccess(req, id);
    const path = join(RECORDINGS_DIR, id, filename + ".timeline.json");
    try {
      const raw = await fs.readFile(path, "utf8");
      const parsed = JSON.parse(raw);
      return { events: Array.isArray(parsed?.events) ? parsed.events : [] };
    } catch { return { events: [] }; }
  }
}
