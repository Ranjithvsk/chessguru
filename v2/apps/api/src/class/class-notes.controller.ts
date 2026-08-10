// Class notes — a student writes reflection on paper after a class, snaps a
// photo, and submits it here. Coach then reviews the paper photo + gives a
// rating (1-5) + a short comment. Great for gauging understanding when a
// coach can't read every student's mind live.
//
// Data model (mongo `classNotes`):
//   { _id, classId, academyId, studentId, studentName, submittedAt,
//     text?: string,                       // optional typed reflection
//     hasImage: bool, imageMime, imageBytes,
//     review?: { rating: 1..5, comment: string, reviewedAt, reviewedBy } }
//
// Storage: photos go to /home/ubuntu/chessguru-class-notes/<classId>/<noteId>.<ext>
// Same disk pattern as the snap audio clip + recording upload.

import {
  BadRequestException, Body, Controller, ForbiddenException, Get,
  HttpException, HttpStatus, NotFoundException, Param, Post, Req,
  UnauthorizedException,
} from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { promises as fs, createReadStream, statSync } from "fs";
import { join } from "path";
import { randomBytes } from "crypto";

const ROOM_RE = /^[a-zA-Z0-9_-]{3,32}$/;
const NOTE_ID_RE = /^cn_[A-Za-z0-9_-]{6,32}$/;
const NOTES_DIR = process.env.CHESSGURU_CLASS_NOTES_DIR ?? "/home/ubuntu/chessguru-class-notes";
const MAX_IMAGE = 8 * 1024 * 1024;   // 8 MB — comfortable for a phone snap of a page
const MAX_TEXT = 4000;

function newNoteId(): string {
  return "cn_" + randomBytes(9).toString("base64url").slice(0, 12);
}
function extFor(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/heic" || mime === "image/heif") return "heic";
  return "jpg";
}

@Controller("class")
export class ClassNotesController {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  private col() { return this.conn.db!.collection("classNotes"); }
  private classes() { return this.conn.db!.collection("classSchedules"); }
  private users() { return this.conn.db!.collection("users"); }

  /** POST /api/class/:id/notes  — student creates a note row.
   *  Body: { text?: string }.  Returns { noteId } so the client can then PUT
   *  the image bytes. Attendance-gated: the caller must have attended (or be
   *  invited to) this class — no drive-by note-spamming from strangers. */
  @Post(":id/notes")
  async create(@Param("id") id: string, @Body() body: any, @Req() req: any) {
    if (!ROOM_RE.test(id)) throw new BadRequestException("bad room");
    const userId: string | null = req?.session?.userId ?? null;
    if (!userId) throw new UnauthorizedException();
    const klass: any = await this.classes().findOne({ _id: id as any });
    if (!klass) throw new NotFoundException("class not found");

    // Attendance gate: student must have joined at least once, OR their email
    // must be on the invitee list. Coach can always submit notes.
    let allow = klass.createdByUserId === userId;
    if (!allow) {
      const att = await this.conn.db!.collection("classAttendance").findOne({ classId: id, userId });
      allow = !!att;
    }
    if (!allow) throw new ForbiddenException("attend the class first");

    const user: any = await this.users().findOne({ _id: userId as any }, { projection: { username: 1 } });
    const text = String(body?.text ?? "").slice(0, MAX_TEXT);
    const noteId = newNoteId();
    const now = new Date();
    await this.col().insertOne({
      _id: noteId as any,
      classId: id,
      classTitle: klass.title || "",
      academyId: klass.academyId ?? null,
      coachId: klass.createdByUserId ?? null,
      studentId: userId,
      studentName: user?.username || userId,
      submittedAt: now,
      text,
      hasImage: false,
    });
    return { ok: true, noteId };
  }

  /** POST /api/class/:id/notes/:noteId/image  (application/octet-stream)
   *  Uploads the photo of the paper note. Sender must be the note's student.
   *  Overwrites previous image (student can re-snap if it was blurry). */
  @Post(":id/notes/:noteId/image")
  async uploadImage(
    @Param("id") id: string, @Param("noteId") noteId: string,
    @Body() body: Buffer, @Req() req: any,
  ) {
    if (!ROOM_RE.test(id)) throw new BadRequestException("bad room");
    if (!NOTE_ID_RE.test(noteId)) throw new BadRequestException("bad note id");
    const userId: string | null = req?.session?.userId ?? null;
    if (!userId) throw new UnauthorizedException();
    const note: any = await this.col().findOne({ _id: noteId as any, classId: id });
    if (!note) throw new NotFoundException("note not found");
    if (note.studentId !== userId) throw new ForbiddenException("not your note");
    if (!Buffer.isBuffer(body) || body.byteLength === 0) throw new BadRequestException("empty body");
    if (body.byteLength > MAX_IMAGE) throw new HttpException("image too large (max 8 MB)", HttpStatus.PAYLOAD_TOO_LARGE);

    // Sniff a common image mime from the first bytes so we don't trust the
    // content-type header alone. Fall back to jpg.
    let mime = "image/jpeg";
    if (body.length > 8) {
      if (body[0] === 0x89 && body[1] === 0x50 && body[2] === 0x4e && body[3] === 0x47) mime = "image/png";
      else if (body[0] === 0xff && body[1] === 0xd8) mime = "image/jpeg";
      else if (body[0] === 0x52 && body[1] === 0x49 && body[2] === 0x46 && body[3] === 0x46) mime = "image/webp";
    }
    const dir = join(NOTES_DIR, id);
    await fs.mkdir(dir, { recursive: true });
    // Clean up any prior extension for this noteId (re-upload with a different type).
    for (const ext of ["jpg", "png", "webp", "heic"]) {
      try { await fs.unlink(join(dir, `${noteId}.${ext}`)); } catch { /* not present */ }
    }
    await fs.writeFile(join(dir, `${noteId}.${extFor(mime)}`), body);
    await this.col().updateOne(
      { _id: noteId as any },
      { $set: { hasImage: true, imageMime: mime, imageBytes: body.byteLength } },
    );
    return { ok: true, bytes: body.byteLength, mime };
  }

  /** GET /api/class/:id/notes/:noteId/image  — streams the image back. Class
   *  members only (student who owns it, or the coach). */
  @Get(":id/notes/:noteId/image")
  async getImage(@Param("id") id: string, @Param("noteId") noteId: string, @Req() req: any) {
    if (!ROOM_RE.test(id)) throw new BadRequestException("bad room");
    if (!NOTE_ID_RE.test(noteId)) throw new BadRequestException("bad note id");
    const userId: string | null = req?.session?.userId ?? null;
    if (!userId) throw new UnauthorizedException();
    const note: any = await this.col().findOne({ _id: noteId as any, classId: id });
    if (!note) throw new NotFoundException();
    // Author or the class's coach.
    if (note.studentId !== userId && note.coachId !== userId) throw new ForbiddenException();
    const ext = extFor(note.imageMime || "image/jpeg");
    const full = join(NOTES_DIR, id, `${noteId}.${ext}`);
    let size = 0;
    try { size = statSync(full).size; } catch { throw new NotFoundException("image missing"); }
    const res: any = (req as any).res;
    res.setHeader("Content-Type", note.imageMime || "image/jpeg");
    res.setHeader("Content-Length", String(size));
    res.setHeader("Cache-Control", "private, max-age=3600");
    createReadStream(full).pipe(res);
  }

  /** GET /api/class/:id/notes — coach view of ALL notes for their class. */
  @Get(":id/notes")
  async listForClass(@Param("id") id: string, @Req() req: any) {
    if (!ROOM_RE.test(id)) throw new BadRequestException("bad room");
    const userId: string | null = req?.session?.userId ?? null;
    if (!userId) throw new UnauthorizedException();
    const klass: any = await this.classes().findOne({ _id: id as any });
    if (!klass) throw new NotFoundException("class not found");
    if (klass.createdByUserId !== userId && req?.session?.role !== "academy_owner") {
      throw new ForbiddenException();
    }
    const rows = await this.col().find({ classId: id }).sort({ submittedAt: -1 }).limit(500).toArray();
    return rows.map(scrub);
  }

  /** POST /api/class/:id/notes/:noteId/review — coach adds rating + comment.
   *  Body: { rating: 1..5, comment?: string } */
  @Post(":id/notes/:noteId/review")
  async review(
    @Param("id") id: string, @Param("noteId") noteId: string,
    @Body() body: any, @Req() req: any,
  ) {
    if (!ROOM_RE.test(id)) throw new BadRequestException("bad room");
    if (!NOTE_ID_RE.test(noteId)) throw new BadRequestException("bad note id");
    const userId: string | null = req?.session?.userId ?? null;
    if (!userId) throw new UnauthorizedException();
    const note: any = await this.col().findOne({ _id: noteId as any, classId: id });
    if (!note) throw new NotFoundException();
    if (note.coachId !== userId && req?.session?.role !== "academy_owner") throw new ForbiddenException();
    const rating = Math.max(1, Math.min(5, Math.round(Number(body?.rating) || 0)));
    if (!rating) throw new BadRequestException("rating 1-5 required");
    const comment = String(body?.comment ?? "").slice(0, 800);
    await this.col().updateOne(
      { _id: noteId as any },
      { $set: { review: { rating, comment, reviewedAt: new Date(), reviewedBy: userId } } },
    );
    return { ok: true };
  }
}

@Controller("me")
export class MyClassNotesController {
  constructor(@InjectConnection() private readonly conn: Connection) {}
  private col() { return this.conn.db!.collection("classNotes"); }

  /** GET /api/me/class-notes — student's own submitted notes with coach reviews. */
  @Get("class-notes")
  async mine(@Req() req: any) {
    const userId: string | null = req?.session?.userId ?? null;
    if (!userId) return [];
    const rows = await this.col().find({ studentId: userId }).sort({ submittedAt: -1 }).limit(50).toArray();
    return rows.map(scrub);
  }
}

/** Coach dashboard convenience — recent notes across every class this
 *  coach owns (or across the whole academy for the owner). Powers the
 *  "📝 Notes to review" panel on the academy home. */
@Controller("academy")
export class AcademyClassNotesController {
  constructor(@InjectConnection() private readonly conn: Connection) {}
  private col() { return this.conn.db!.collection("classNotes"); }

  @Get("class-notes")
  async recent(@Req() req: any) {
    const userId: string | null = req?.session?.userId ?? null;
    const academyId: string | null = req?.session?.academyId ?? null;
    const role: string | null = req?.session?.role ?? null;
    if (!userId || !academyId) return [];
    const filter: any = { academyId };
    if (role !== "academy_owner") filter.coachId = userId;
    const rows = await this.col().find(filter).sort({ submittedAt: -1 }).limit(100).toArray();
    return rows.map(scrub);
  }
}

function scrub(r: any) {
  return {
    _id: String(r._id),
    classId: r.classId, classTitle: r.classTitle || "",
    studentId: r.studentId, studentName: r.studentName,
    submittedAt: r.submittedAt,
    text: r.text || "",
    hasImage: !!r.hasImage, imageMime: r.imageMime || null, imageBytes: r.imageBytes || 0,
    review: r.review ?? null,
  };
}
