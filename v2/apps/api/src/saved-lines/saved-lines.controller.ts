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

import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection, Types } from "mongoose";
import { PushService } from "../push/push.service";

const NAME_MAX = 80;
const NOTES_MAX = 1000;
const SANS_MAX = 100;
const SAN_RE = /^[a-hRNBQKPO0-9x+#=\-]{1,10}$/;
const SLUG_RE = /^[a-z0-9-]{1,80}$/;
// Sideline tree caps — a saved line can have branches at any node, but not
// arbitrarily many. Same SANS_MAX ply cap on any single path + a hard total
// node count so a malicious client can't bomb Mongo with a huge tree.
const TREE_MAX_NODES = 4000;
const TREE_MAX_DEPTH = 200;

interface TreeNode { san: string; children: TreeNode[] }

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
// Recursively normalise a MoveNode tree — same shape client-side uses.
// Enforces total node count, per-node SAN validity, and max branch depth so a
// bad/hostile client can't bloat Mongo. Returns null when the input is missing
// or empty (the caller falls back to sans-only saving).
function normalizeTree(x: unknown): TreeNode[] | null {
  if (!Array.isArray(x) || x.length === 0) return null;
  let nodeCount = 0;
  const walk = (nodes: unknown[], depth: number): TreeNode[] => {
    if (depth > TREE_MAX_DEPTH) throw new BadRequestException(`tree-too-deep (max ${TREE_MAX_DEPTH})`);
    const out: TreeNode[] = [];
    for (const raw of nodes) {
      nodeCount++;
      if (nodeCount > TREE_MAX_NODES) throw new BadRequestException(`tree-too-large (max ${TREE_MAX_NODES} nodes)`);
      const n: any = raw;
      const san = String(n?.san || "").trim();
      if (!SAN_RE.test(san)) throw new BadRequestException(`bad-san in tree: ${san}`);
      const kids = Array.isArray(n?.children) ? walk(n.children, depth + 1) : [];
      out.push({ san, children: kids });
    }
    return out;
  };
  return walk(x, 1);
}

function buildEntry(body: any): { kind: "corpus" | "line"; slug?: string; sans?: string[]; tree?: TreeNode[]; notes?: string | null; name: string } {
  const name = normalizeName(body?.name);
  const kind = body?.kind === "corpus" ? "corpus" : "line";
  if (kind === "corpus") {
    const slug = String(body?.slug || "").trim();
    if (!SLUG_RE.test(slug)) throw new BadRequestException("bad-slug");
    return { kind, slug, name };
  }
  const sans = normalizeSans(body?.sans);
  const notes = body?.notes ? String(body.notes).slice(0, NOTES_MAX) : null;
  // Optional tree — when the client sent one AND it carries at least one
  // sibling variation, persist it alongside sans. `sans` stays as the
  // canonical mainline so old clients (and list-render tooltips) keep working.
  const tree = normalizeTree(body?.tree);
  const hasVariations = tree ? tree.some(function containsBranch(n: TreeNode): boolean {
    return n.children.length > 1 || n.children.some(containsBranch);
  }) : false;
  return hasVariations
    ? { kind, sans, tree: tree!, notes, name }
    : { kind, sans, notes, name };
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
   *  — a push hiccup shouldn't roll back the share itself. `mode` picks the
   *  copy: "share" for the initial share, "update" for propagated edits
   *  (owner ask 2026-08-25 — "if edited, shared file should reflect edit
   *  and notify changes to the student"). */
  private async notifyRecipients(
    recipientIds: string[], coachName: string, entryName: string,
    mode: "share" | "update" = "share",
  ) {
    if (!recipientIds.length) return;
    const title = mode === "update"
      ? `\u{270F}\u{FE0F} ${coachName} updated an opening`
      : `\u{1F393} ${coachName} shared an opening`;
    const body = mode === "update"
      ? `${entryName} was updated in your Repertoire — tap to open.`
      : `${entryName} was added to your Repertoire — tap to open.`;
    // Web push (best-effort — students who granted permission see a real toast)
    await Promise.all(recipientIds.map((sid) =>
      this.push.sendToUser(sid, {
        title, body,
        url: "/openings",
        tag: `cg-rep-${mode}-${sid}`,
      }).catch(() => { /* silent */ })
    ));
    // Durable in-app record — students see it in their notifications feed
    // even if push is denied / offline at share time.
    const now = new Date();
    await this.conn.db!.collection("userNotifications").insertMany(
      recipientIds.map((sid) => ({
        _id: new Types.ObjectId().toHexString(),
        userId: sid,
        kind: mode === "update" ? "repertoire-update" : "repertoire-share",
        title: mode === "update" ? `${coachName} updated an opening` : `${coachName} shared an opening`,
        body: mode === "update"
          ? `${entryName} was updated in your Repertoire.`
          : `${entryName} was added to your Repertoire.`,
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
    // Students may not delete entries their coach shared with them —
    // otherwise a wrong tap wipes homework the coach expected them to
    // study (owner report 2026-08-20: harinit accidentally deleted a
    // gunachess-shared repertoire; had to be restored from source).
    // Coaches/owners can still delete anything they own (including
    // things they were shared TO, e.g. from their academy owner).
    const row: any = await this.col().findOne({ _id: id as any, ownerId: me.userId }, { projection: { sharedFrom: 1 } });
    if (!row) return { ok: false };
    if (row.sharedFrom && me.role === "student") {
      throw new BadRequestException("Coach-shared entries can't be deleted by students. Ask your coach to unassign it.");
    }
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
    // Coach can flag the share as "required study" — the student's client
    // auto-activates it in the Opening Trainer and blocks removal (owner
    // ask 2026-08-20). Defaults to false so plain share is unchanged.
    const forceTrain: boolean = body?.forceTrain === true;
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
      // Propagate the sideline tree on share too — otherwise coaches sharing
      // a repertoire with branches would silently flatten it back to mainline
      // on the student's side.
      tree: src.tree ?? undefined,
      notes: src.notes ?? undefined,
      createdAt: now,
      sharedFrom: me.userId,
      // Backlink to the coach's original doc so a later PATCH on the coach
      // entry can fan the edit out to every student copy (owner ask
      // 2026-08-25 — "if edited, shared file should reflect edit").
      sourceId: String(src._id),
      ...(forceTrain ? { forceTrain: true } : {}),
    }));
    await this.col().insertMany(copies as any);
    const coach: any = await this.conn.db!.collection("users").findOne(
      { _id: me.userId as any }, { projection: { name: 1, username: 1 } },
    );
    const coachName = coach?.name || coach?.username || "Your coach";
    await this.notifyRecipients(validIds, coachName, src.name);
    return { ok: true, shared: copies.length };
  }

  /** PATCH /api/my/repertoire/:id — edit an entry the caller owns. Body may
   *  include any subset of { name, notes, sans, tree, forceTrain }. `kind`
   *  and `slug` are intentionally NOT editable — changing kind would
   *  invalidate the shape; slug corresponds to a fixed ECO opening.
   *
   *  Students can't edit an entry a coach shared with them (same rule as
   *  delete — otherwise homework rots silently). Coaches CAN edit their
   *  own — and every student copy that came from this doc (matched via
   *  sourceId) is updated to match AND notified. Owner ask 2026-08-25:
   *  "if edited, shared file should reflect edit and notify changes to
   *  the student." */
  @Patch(":id")
  async edit(@Req() req: any, @Param("id") id: string, @Body() body: any) {
    const me = requireLogin(req);
    const row: any = await this.col().findOne({ _id: id as any, ownerId: me.userId });
    if (!row) throw new BadRequestException("not-found");
    if (row.sharedFrom && me.role === "student") {
      throw new BadRequestException("Coach-shared entries can't be edited. Duplicate first to make your own copy.");
    }

    // Build the patch. Every field is optional; unspecified fields are left
    // untouched. Validation reuses the same normalisers the create path uses.
    const patch: any = { updatedAt: new Date() };
    if (body?.name !== undefined)  patch.name  = normalizeName(body.name);
    if (body?.notes !== undefined) patch.notes = body.notes ? String(body.notes).slice(0, NOTES_MAX) : null;
    if (body?.sans !== undefined) {
      // Only meaningful for kind=line. Corpus entries silently ignore sans
      // edits (they're a bookmark, not a hand-played sequence).
      if (row.kind === "line") patch.sans = normalizeSans(body.sans);
    }
    if (body?.tree !== undefined) {
      // Same rule as create: only persist the tree when it carries at least
      // one branch, else drop it so old readers keep working on `sans`.
      const nextTree = normalizeTree(body.tree);
      const hasVar = nextTree ? nextTree.some(function has(n: TreeNode): boolean {
        return n.children.length > 1 || n.children.some(has);
      }) : false;
      if (hasVar) patch.tree = nextTree;
      else patch.tree = null;  // explicit clear
    }
    if (body?.forceTrain !== undefined) patch.forceTrain = !!body.forceTrain;

    // Guard against a payload that patches nothing (would be a wasted write).
    const changed = Object.keys(patch).filter((k) => k !== "updatedAt");
    if (!changed.length) return { ok: true, changed: 0 };

    // Apply. Also $unset tree when we explicitly cleared it (patch.tree null).
    const set: any = { ...patch };
    const unset: any = {};
    if (patch.tree === null) { delete set.tree; unset.tree = ""; }
    const op: any = { $set: set };
    if (Object.keys(unset).length) op.$unset = unset;
    await this.col().updateOne({ _id: id as any, ownerId: me.userId }, op);

    // Propagation — ONLY when the coach edits their own original (not a
    // sharedFrom copy) AND is a coach/owner. Find every student copy that
    // came from this doc, apply the same set/unset, then fan out a push
    // + inbox notification tagged "update".
    let propagated = 0;
    if (!row.sharedFrom && (me.role === "coach" || me.role === "academy_owner")) {
      const copyFilter = { sourceId: String(id), sharedFrom: me.userId };
      const copies: any[] = await this.col().find(copyFilter, { projection: { _id: 1, ownerId: 1 } }).toArray();
      if (copies.length) {
        await this.col().updateMany(copyFilter, op);
        propagated = copies.length;
        const coach: any = await this.conn.db!.collection("users").findOne(
          { _id: me.userId as any }, { projection: { name: 1, username: 1 } },
        );
        const coachName = coach?.name || coach?.username || "Your coach";
        const nextName = (patch.name as string) || row.name;
        await this.notifyRecipients(copies.map((c) => String(c.ownerId)), coachName, nextName, "update");
      }
    }

    const fresh: any = await this.col().findOne({ _id: id as any });
    return { ok: true, changed: changed.length, propagated, entry: fresh };
  }

  /** POST /api/my/repertoire/:id/duplicate — clone an entry the caller owns
   *  under their own ownership. Copy loses `sharedFrom` + `sourceId` (it's
   *  a fresh independent entry) and gets `name: "Copy of X"` unless the
   *  caller overrides via body.name. Students may duplicate a coach-shared
   *  entry — that's how they get an editable personal fork without losing
   *  the coach-suggested original. Owner ask 2026-08-25. */
  @Post(":id/duplicate")
  async duplicate(@Req() req: any, @Param("id") id: string, @Body() body: any) {
    const me = requireLogin(req);
    const src: any = await this.col().findOne({ _id: id as any, ownerId: me.userId });
    if (!src) throw new BadRequestException("not-found");
    const overrideName = body?.name ? String(body.name).slice(0, NAME_MAX).trim() : "";
    const dupName = overrideName || `Copy of ${src.name}`.slice(0, NAME_MAX);
    const doc: any = {
      _id: newId(),
      ownerId: me.userId,
      academyId: me.academyId,
      kind: src.kind,
      name: dupName,
      slug: src.slug ?? undefined,
      sans: src.sans ?? undefined,
      tree: src.tree ?? undefined,
      notes: src.notes ?? undefined,
      createdAt: new Date(),
      // Fresh entry — no sharedFrom / sourceId, no forceTrain lock.
    };
    await this.col().insertOne(doc);
    return { ok: true, entry: doc };
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
