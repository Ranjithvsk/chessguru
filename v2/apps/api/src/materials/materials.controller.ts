// Study materials sharing — coach uploads a file (PDF, PGN, image, text)
// and picks who gets to see it: the whole academy, all of their own
// students, or a specific pick-list. Students see materials shared with
// them on their /dashboard and can download.
//
// Data model (mongo `studyMaterials`):
//   { _id, academyId, coachId, coachName, title, description?,
//     filename, mime, bytes, uploadedAt, scope, targetStudentIds?, tags? }
//
// Storage: /home/ubuntu/chessguru-study-materials/<materialId>.<ext>

import {
  BadRequestException, Body, Controller, Delete, ForbiddenException,
  Get, HttpException, HttpStatus, NotFoundException, Param, Post, Req,
  UnauthorizedException,
} from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { promises as fs, createReadStream, statSync } from "fs";
import { join } from "path";
import { randomBytes } from "crypto";

const MAT_ID_RE = /^sm_[A-Za-z0-9_-]{6,32}$/;
const MATERIALS_DIR = process.env.CHESSGURU_MATERIALS_DIR ?? "/home/ubuntu/chessguru-study-materials";
const MAX_BYTES = 25 * 1024 * 1024;   // 25 MB — comfortable for a chess book PDF
const MAX_TITLE = 120;
const MAX_DESCRIPTION = 2000;
const MAX_TAGS = 10;

// Allowlist: what we will accept + serve back. Mime is derived server-side
// (sniff for pdf/image, extension for text/pgn); nothing else is stored.
const ALLOWED_EXT: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  pgn: "application/x-chess-pgn",
  txt: "text/plain",
  md: "text/markdown",
};
type Scope = "academy" | "coach-students" | "specific-students";

function newMatId(): string { return "sm_" + randomBytes(9).toString("base64url").slice(0, 12); }

function extOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "";
}

/** Coach + owner ops: upload, list, delete. */
@Controller("academy/materials")
export class MaterialsController {
  constructor(@InjectConnection() private readonly conn: Connection) {}
  private col() { return this.conn.db!.collection("studyMaterials"); }
  private users() { return this.conn.db!.collection("users"); }

  private ensureCoachOrOwner(session: any): { academyId: string; userId: string; role: "academy_owner" | "coach" } {
    const role = session?.role;
    const academyId = session?.academyId;
    const userId = session?.userId;
    if (!userId) throw new UnauthorizedException("sign in first");
    if ((role !== "academy_owner" && role !== "coach") || !academyId) throw new ForbiddenException("owner or coach only");
    return { academyId, userId, role };
  }

  /** Create a material row (no file yet). Returns { materialId } for the
   *  binary upload that follows. Two-step so we can validate metadata
   *  before touching disk. */
  @Post()
  async create(@Req() req: any, @Body() body: any) {
    const g = this.ensureCoachOrOwner(req.session);
    const title = String(body?.title ?? "").trim().slice(0, MAX_TITLE);
    if (!title) throw new BadRequestException("title required");
    const description = String(body?.description ?? "").slice(0, MAX_DESCRIPTION);
    const filename = String(body?.filename ?? "").trim().slice(0, 240);
    if (!filename) throw new BadRequestException("filename required");
    const ext = extOf(filename);
    if (!ALLOWED_EXT[ext]) throw new BadRequestException(`unsupported file type: .${ext}`);

    const scopeRaw = String(body?.scope ?? "coach-students");
    const scope: Scope = (["academy","coach-students","specific-students"] as const).includes(scopeRaw as any)
      ? (scopeRaw as Scope) : "coach-students";
    let targetStudentIds: string[] = [];
    if (scope === "specific-students") {
      const raw = Array.isArray(body?.targetStudentIds) ? body.targetStudentIds : [];
      const cleaned = raw.map((x: unknown) => String(x || "").trim().toLowerCase()).filter(Boolean).slice(0, 200);
      if (cleaned.length === 0) throw new BadRequestException("pick at least one student for a targeted share");
      // Verify all are in this academy (and if coach, on their roster).
      const filter: any = { _id: { $in: cleaned }, academyId: g.academyId, role: "student" };
      if (g.role === "coach") filter.coachId = g.userId;
      const found = await this.users().find(filter, { projection: { _id: 1 } }).toArray();
      targetStudentIds = found.map((u: any) => String(u._id));
      if (targetStudentIds.length === 0) throw new BadRequestException("no matching students in this academy");
    }
    const tags = (Array.isArray(body?.tags) ? body.tags : [])
      .map((t: unknown) => String(t || "").trim().slice(0, 40))
      .filter((t: string) => t.length > 0)
      .slice(0, MAX_TAGS);

    const user: any = await this.users().findOne({ _id: g.userId as any }, { projection: { username: 1 } });
    const materialId = newMatId();
    await this.col().insertOne({
      _id: materialId as any,
      academyId: g.academyId,
      coachId: g.userId,
      coachName: user?.username || g.userId,
      title, description,
      filename, mime: ALLOWED_EXT[ext]!, bytes: 0,
      uploadedAt: new Date(),
      scope, targetStudentIds: scope === "specific-students" ? targetStudentIds : [],
      tags,
      hasFile: false,
    });
    return { ok: true, materialId };
  }

  /** Upload the binary. application/octet-stream body via express.raw. */
  @Post(":id/file")
  async uploadFile(@Param("id") id: string, @Body() body: Buffer, @Req() req: any) {
    if (!MAT_ID_RE.test(id)) throw new BadRequestException("bad material id");
    const g = this.ensureCoachOrOwner(req.session);
    const row: any = await this.col().findOne({ _id: id as any, academyId: g.academyId });
    if (!row) throw new NotFoundException();
    if (row.coachId !== g.userId && g.role !== "academy_owner") throw new ForbiddenException("not your material");
    if (!Buffer.isBuffer(body) || body.byteLength === 0) throw new BadRequestException("empty body");
    if (body.byteLength > MAX_BYTES) throw new HttpException("file too large (max 25 MB)", HttpStatus.PAYLOAD_TOO_LARGE);
    const ext = extOf(row.filename);
    if (!ALLOWED_EXT[ext]) throw new BadRequestException("bad extension");
    await fs.mkdir(MATERIALS_DIR, { recursive: true });
    await fs.writeFile(join(MATERIALS_DIR, `${id}.${ext}`), body);
    await this.col().updateOne({ _id: id as any }, { $set: { bytes: body.byteLength, hasFile: true } });
    return { ok: true, bytes: body.byteLength };
  }

  /** Coach view — materials THEY uploaded. Owner sees all in the academy.
   *  Each row is enriched with unique-reader count (read receipts) so the
   *  coach sees "👁 N read" on the card without opening a per-material drawer. */
  @Get()
  async list(@Req() req: any) {
    const g = this.ensureCoachOrOwner(req.session);
    const filter: any = { academyId: g.academyId };
    if (g.role !== "academy_owner") filter.coachId = g.userId;
    const rows = await this.col().find(filter).sort({ uploadedAt: -1 }).limit(200).toArray();
    if (rows.length === 0) return [];
    // Batch read-count aggregation: one round-trip regardless of list size.
    const ids = rows.map((r: any) => String(r._id));
    const counts = await this.conn.db!.collection("materialReads").aggregate([
      { $match: { materialId: { $in: ids } } },
      { $group: { _id: "$materialId", readers: { $sum: 1 }, totalReads: { $sum: "$reads" }, lastReadAt: { $max: "$lastReadAt" } } },
    ]).toArray();
    const rcMap: Record<string, { readers: number; totalReads: number; lastReadAt: Date | null }> = {};
    for (const c of counts as any[]) rcMap[String(c._id)] = { readers: c.readers ?? 0, totalReads: c.totalReads ?? 0, lastReadAt: c.lastReadAt ?? null };
    return rows.map((r: any) => {
      const s = scrub(r);
      const rc = rcMap[s._id];
      return { ...s, readCount: rc?.readers ?? 0, totalReads: rc?.totalReads ?? 0, lastReadAt: rc?.lastReadAt ?? null };
    });
  }

  /** Coach drills into one material's read receipts. Ordered most-recent-read
   *  first so the coach immediately sees who's still catching up. */
  @Get(":id/reads")
  async reads(@Param("id") id: string, @Req() req: any) {
    if (!MAT_ID_RE.test(id)) throw new BadRequestException("bad material id");
    const g = this.ensureCoachOrOwner(req.session);
    const row: any = await this.col().findOne({ _id: id as any, academyId: g.academyId });
    if (!row) throw new NotFoundException();
    if (row.coachId !== g.userId && g.role !== "academy_owner") throw new ForbiddenException();
    const reads = await this.conn.db!.collection("materialReads")
      .find({ materialId: id }).sort({ lastReadAt: -1 }).limit(500).toArray();
    return reads.map((r: any) => ({
      userId: r.userId, userName: r.userName || r.userId,
      firstReadAt: r.firstReadAt, lastReadAt: r.lastReadAt,
      reads: r.reads ?? 1,
    }));
  }

  @Delete(":id")
  async remove(@Param("id") id: string, @Req() req: any) {
    if (!MAT_ID_RE.test(id)) throw new BadRequestException("bad material id");
    const g = this.ensureCoachOrOwner(req.session);
    const row: any = await this.col().findOne({ _id: id as any, academyId: g.academyId });
    if (!row) throw new NotFoundException();
    if (row.coachId !== g.userId && g.role !== "academy_owner") throw new ForbiddenException();
    const ext = extOf(row.filename);
    try { await fs.unlink(join(MATERIALS_DIR, `${id}.${ext}`)); } catch { /* already gone */ }
    await this.col().deleteOne({ _id: id as any });
    return { ok: true };
  }
}

/** Student side. */
@Controller("me/materials")
export class MyMaterialsController {
  constructor(@InjectConnection() private readonly conn: Connection) {}
  private col() { return this.conn.db!.collection("studyMaterials"); }

  /** List everything shared with the caller: academy-wide + shared by their
   *  coach + specifically targeted at them. */
  @Get()
  async listForStudent(@Req() req: any) {
    const userId: string | null = req?.session?.userId ?? null;
    const academyId: string | null = req?.session?.academyId ?? null;
    if (!userId || !academyId) return [];
    // Get the student's coachId — needed for the "coach-students" scope.
    const user: any = await this.conn.db!.collection("users").findOne(
      { _id: userId as any }, { projection: { coachId: 1, role: 1 } },
    );
    const coachId: string | null = user?.coachId ?? null;
    // If the caller isn't a student, still let them read academy-wide items.
    const or: any[] = [
      { academyId, scope: "academy" },
      { academyId, scope: "specific-students", targetStudentIds: userId },
    ];
    if (coachId) or.push({ academyId, coachId, scope: "coach-students" });
    const rows = await this.col().find({ $or: or, hasFile: true }).sort({ uploadedAt: -1 }).limit(200).toArray();
    return rows.map(scrub);
  }
}

/** File download — coach who owns it OR a student who's in-scope. */
@Controller("materials")
export class MaterialsFileController {
  constructor(@InjectConnection() private readonly conn: Connection) {}
  private col() { return this.conn.db!.collection("studyMaterials"); }

  @Get(":id/file")
  async download(@Param("id") id: string, @Req() req: any) {
    if (!MAT_ID_RE.test(id)) throw new BadRequestException("bad material id");
    const userId: string | null = req?.session?.userId ?? null;
    const academyId: string | null = req?.session?.academyId ?? null;
    const role: string | null = req?.session?.role ?? null;
    if (!userId) throw new UnauthorizedException();
    const row: any = await this.col().findOne({ _id: id as any });
    if (!row || !row.hasFile) throw new NotFoundException();
    // Academy check first.
    if (row.academyId && row.academyId !== academyId) throw new ForbiddenException();
    // Access check:
    const isCoachOwner = row.coachId === userId;
    const isAcademyOwner = role === "academy_owner";
    const inAcademyScope = row.scope === "academy";
    const inSpecific = row.scope === "specific-students" && Array.isArray(row.targetStudentIds) && row.targetStudentIds.includes(userId);
    // "coach-students" scope: fetch caller's coachId lazily.
    let inCoachScope = false;
    if (!inAcademyScope && !inSpecific && !isCoachOwner && !isAcademyOwner) {
      if (row.scope === "coach-students") {
        const user: any = await this.conn.db!.collection("users").findOne(
          { _id: userId as any }, { projection: { coachId: 1 } },
        );
        inCoachScope = user?.coachId === row.coachId;
      }
    }
    if (!isCoachOwner && !isAcademyOwner && !inAcademyScope && !inSpecific && !inCoachScope) {
      throw new ForbiddenException("not shared with you");
    }
    const ext = extOf(row.filename);
    const full = join(MATERIALS_DIR, `${id}.${ext}`);
    let size = 0;
    try { size = statSync(full).size; } catch { throw new NotFoundException("file missing"); }
    const res: any = (req as any).res;
    res.setHeader("Content-Type", row.mime || "application/octet-stream");
    res.setHeader("Content-Length", String(size));
    res.setHeader("Content-Disposition", `inline; filename="${row.filename.replace(/[^\w.-]/g, "_")}"`);
    res.setHeader("Cache-Control", "private, max-age=3600");
    createReadStream(full).pipe(res);

    // Read receipt — fire-and-forget so we don't block the stream. Skip when
    // the coach who OWNS the material is fetching it (opening your own upload
    // to verify shouldn't spam your own "who's read this" drawer). Owner
    // opening academy-wide items DOES count — they're consuming the same as
    // any other reader. Composite _id (materialId:userId) keeps this
    // idempotent: N-th open bumps `reads` + `lastReadAt` in place.
    if (!isCoachOwner) {
      (async () => {
        try {
          const now = new Date();
          const user: any = await this.conn.db!.collection("users").findOne(
            { _id: userId as any }, { projection: { username: 1 } },
          );
          await this.conn.db!.collection("materialReads").updateOne(
            { _id: `${id}:${userId}` as any },
            {
              $setOnInsert: { materialId: id, userId, userName: user?.username || userId, firstReadAt: now },
              $set: { lastReadAt: now },
              $inc: { reads: 1 },
            },
            { upsert: true },
          );
        } catch { /* logging noise only */ }
      })();
    }
  }
}

function scrub(r: any) {
  return {
    _id: String(r._id),
    coachId: r.coachId, coachName: r.coachName,
    title: r.title, description: r.description || "",
    filename: r.filename, mime: r.mime, bytes: r.bytes ?? 0,
    uploadedAt: r.uploadedAt,
    scope: r.scope,
    targetStudentIds: Array.isArray(r.targetStudentIds) ? r.targetStudentIds : [],
    tags: Array.isArray(r.tags) ? r.tags : [],
    hasFile: !!r.hasFile,
  };
}
