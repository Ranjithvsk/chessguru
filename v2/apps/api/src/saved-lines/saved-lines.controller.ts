// "My Repertoire" — the user's saved opening set. Two entry kinds:
//   * kind: "corpus" — a bookmark to one of the 3810 named ECO openings
//     (`slug` + display `name`)
//   * kind: "line"   — a custom hand-played line (`sans[]` + display `name`
//     + optional `notes`)
//
// Owner ask 2026-08-19: "when new moves entered, different from opening
// moves, show option to save with a name for that particular student. And
// coach can save with name and share with the students, and existing opening
// option to add to Opening Repertoire, and coach can also add openings to
// students repertoire. Create My Repertoire for that, to save the openings."
//
// Data model — one Mongo collection `myRepertoire`:
//   { _id, ownerId, academyId?, kind, name,
//     slug?,          // when kind === "corpus"
//     sans?, notes?,  // when kind === "line"
//     createdAt, sharedFrom?, sharedFromName? }
//
// Sharing / coach-push:
//   * Coach can share OWN entry with N students — duplicates row per
//     recipient with sharedFrom = coach's _id (recipients own the copy).
//   * Coach can also PUSH straight to one student's repertoire without
//     saving to their own — same shape, different endpoint.

import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Req } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection, Types } from "mongoose";
import { PushService } from "../push/push.service";

const NAME_MAX = 80;
const NOTES_MAX = 1000;
const SANS_MAX = 100;
const SAN_RE = /^[a-hRNBQKPO0-9x+#=\-]{1,10}$/;
const SLUG_RE = /^[a-z0-9-]{1,80}$/;

function newId(): string { return new Types.ObjectId().toHexString(); }
function requireLogin(req: any): { userId: string; role: string | null; academyId: string | null } {
  const userId = req?.session?.userId;
  if (!userId) throw new BadRequestException("not-signed-in");
  return {
    userId: String(userId),
    role: req?.session?.role ?? null,
    academyId: req?.session?.academyId ?? null,
  };
}
function normalizeName(x: unknown): string {
  const s = String(x || "").trim().slice(0, NAME_MAX);
  if (!s) throw new BadRequestException("name-required");
  return s;
}
function normalizeSans(x: unknown): string[] {
  if (!Array.isArray(x) || !x.length) throw new BadRequestException("sans-required");
  if (x.length > SANS_MAX) throw new BadRequestException(`sans-too-long (max ${SANS_MAX})`);
  const out: string[] = [];
  for (const s of x) {
    const v = String(s || "").trim();
    if (!SAN_RE.test(v)) throw new BadRequestException(`bad-san: ${v}`);
    out.push(v);
  }
  return out;
}
function buildEntry(body: any): { kind: "corpus" | "line"; slug?: string; sans?: string[]; notes?: string | null; name: string } {
  const name = normalizeName(body?.name);
  const kind = body?.kind === "corpus" ? "corpus" : "line";
  if (kind === "corpus") {
    const slug = String(body?.slug || "").trim();
    if (!SLUG_RE.test(slug)) throw new BadRequestException("bad-slug");
    return { kind, slug, name };
  }
  const sans = normalizeSans(body?.sans);
  const notes = body?.notes ? String(body.notes).slice(0, NOTES_MAX) : null;
  return { kind, sans, notes, name };
}

@Controller("my/repertoire")
export class SavedLinesController {
  constructor(
    @InjectConnection() private readonly conn: Connection,
    private readonly push: PushService,
  ) {}

  /** Fan-out web push + persist a small notification row so students see a
   *  bell / inbox entry the next time they open the app (owner ask
   *  2026-08-19: "when coach shares, notify the student"). Fire-and-forget
   *  — a push hiccup shouldn't roll back the share itself. */
  private async notifyRecipients(recipientIds: string[], coachName: string, entryName: string) {
    if (!recipientIds.length) return;
    // Web push (best-effort — students who granted permission see a real toast)
    await Promise.all(recipientIds.map((sid) =>
      this.push.sendToUser(sid, {
        title: `\u{1F393} ${coachName} shared an opening`,
        body: `${entryName} was added to your Repertoire — tap to open.`,
        url: "/openings",
        tag: `cg-rep-share-${sid}`,
      }).catch(() => { /* silent */ })
    ));
    // Durable in-app record — students see it in their notifications feed
    // even if push is denied / offline at share time.
    const now = new Date();
    await this.conn.db!.collection("userNotifications").insertMany(
      recipientIds.map((sid) => ({
        _id: new Types.ObjectId().toHexString(),
        userId: sid,
        kind: "repertoire-share",
        title: `${coachName} shared an opening`,
        body: `${entryName} was added to your Repertoire.`,
        url: "/openings",
        createdAt: now,
        readAt: null,
      })) as any,
    ).catch(() => { /* silent — feed absence is not fatal */ });
  }

  private col() { return this.conn.db!.collection("myRepertoire"); }

  /** List every entry owned by the caller — newest first. */
  @Get()
  async list(@Req() req: any) {
    const me = requireLogin(req);
    const rows: any[] = await this.col()
      .find({ ownerId: me.userId }, { sort: { createdAt: -1 } })
      .limit(500).toArray();
    // Enrich sharedFrom with the coach's display name so the UI can show
    // "shared by Ranjith" without a second round-trip.
    const coachIds = [...new Set(rows.map((r) => r.sharedFrom).filter(Boolean))];
    if (coachIds.length) {
      const coaches = await this.conn.db!.collection("users")
        .find({ _id: { $in: coachIds } }, { projection: { name: 1, username: 1 } })
        .toArray();
      const nameById = new Map(coaches.map((u: any) => [String(u._id), u.name || u.username || "coach"]));
      for (const r of rows) if (r.sharedFrom) r.sharedFromName = nameById.get(String(r.sharedFrom)) ?? null;
    }
    return { entries: rows };
  }

  @Post()
  async create(@Req() req: any, @Body() body: any) {
    const me = requireLogin(req);
    const entry = buildEntry(body);
    const doc: any = {
      _id: newId(),
      ownerId: me.userId,
      academyId: me.academyId,
      ...entry,
      createdAt: new Date(),
    };
    await this.col().insertOne(doc);
    return { ok: true, entry: doc };
  }

  @Delete(":id")
  async remove(@Req() req: any, @Param("id") id: string) {
    const me = requireLogin(req);
    const r = await this.col().deleteOne({ _id: id as any, ownerId: me.userId });
    return { ok: r.deletedCount > 0 };
  }

  /** Coach → N students. Body: { studentIds: string[] }. Copies the entry
   *  under each recipient's ownerId. Only the row's owner (coach/owner)
   *  can share; recipients must be students in the same academy. */
  @Post(":id/share")
  async share(@Req() req: any, @Param("id") id: string, @Body() body: any) {
    const me = requireLogin(req);
    if (me.role !== "coach" && me.role !== "academy_owner") {
      throw new BadRequestException("coach-only");
    }
    const src: any = await this.col().findOne({ _id: id as any, ownerId: me.userId });
    if (!src) throw new BadRequestException("not-found");
    const studentIds: string[] = Array.isArray(body?.studentIds)
      ? body.studentIds.map((s: any) => String(s)).filter(Boolean).slice(0, 200)
      : [];
    if (!studentIds.length) return { ok: true, shared: 0 };
    const students = await this.conn.db!.collection("users").find(
      { _id: { $in: studentIds } as any, academyId: me.academyId, role: "student" },
      { projection: { _id: 1 } },
    ).toArray();
    const validIds = students.map((u: any) => String(u._id));
    if (!validIds.length) return { ok: true, shared: 0 };
    const now = new Date();
    const copies = validIds.map((sid) => ({
      _id: newId(),
      ownerId: sid,
      academyId: me.academyId,
      kind: src.kind,
      name: src.name,
      slug: src.slug ?? undefined,
      sans: src.sans ?? undefined,
      notes: src.notes ?? undefined,
      createdAt: now,
      sharedFrom: me.userId,
    }));
    await this.col().insertMany(copies as any);
    const coach: any = await this.conn.db!.collection("users").findOne(
      { _id: me.userId as any }, { projection: { name: 1, username: 1 } },
    );
    const coachName = coach?.name || coach?.username || "Your coach";
    await this.notifyRecipients(validIds, coachName, src.name);
    return { ok: true, shared: copies.length };
  }

  /** Coach → ONE student, push directly (no self-copy). Body: same shape as
   *  POST /my/repertoire but the entry lands in the STUDENT's repertoire.
   *  Owner ask: "coach can also add openings to students repertoire". */
  @Post("push/:studentId")
  async pushToStudent(@Req() req: any, @Param("studentId") studentId: string, @Body() body: any) {
    const me = requireLogin(req);
    if (me.role !== "coach" && me.role !== "academy_owner") {
      throw new BadRequestException("coach-only");
    }
    const student: any = await this.conn.db!.collection("users").findOne(
      { _id: studentId as any, academyId: me.academyId, role: "student" },
      { projection: { _id: 1 } },
    );
    if (!student) throw new BadRequestException("student-not-in-your-academy");
    const entry = buildEntry(body);
    const doc: any = {
      _id: newId(),
      ownerId: studentId,
      academyId: me.academyId,
      ...entry,
      createdAt: new Date(),
      sharedFrom: me.userId,
    };
    await this.col().insertOne(doc);
    const coach: any = await this.conn.db!.collection("users").findOne(
      { _id: me.userId as any }, { projection: { name: 1, username: 1 } },
    );
    const coachName = coach?.name || coach?.username || "Your coach";
    await this.notifyRecipients([studentId], coachName, entry.name);
    return { ok: true, entry: doc };
  }
}
