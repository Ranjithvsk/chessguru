// Opening move notes — on-demand authored per-move explanations.
//
// Model: (openingSlug, ply) → note. Students see notes on the OpeningDetail
// page as "why?" tooltips per move. Coach/owner authors on-demand: when a
// student clicks "why?" on an un-noted move, they can request; the coach
// (or owner) writes the note and every student sees it forever.
//
// Storage: `openingMoveNotes` collection, one doc per (slug, ply) pair.
// Owner ask 2026-08-12 (path C): "when user asks for move reason develop
// for that opening, make provision".

import { Injectable, BadRequestException, ForbiddenException } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";

const SLUG_RE = /^[a-z0-9-]{1,80}$/;
const MAX_NOTE_CHARS = 5000;

@Injectable()
export class OpeningNotesService {
  constructor(@InjectConnection() private readonly conn: Connection) {}
  private col() { return this.conn.db!.collection("openingMoveNotes"); }
  private reqs() { return this.conn.db!.collection("openingMoveNoteRequests"); }

  /** Public: read all notes for an opening (small — one opening has at most
   *  ~40 plies). Returns a plies → note map for fast client rendering. */
  async listForOpening(slug: string) {
    if (!SLUG_RE.test(slug)) throw new BadRequestException("bad slug");
    const rows = await this.col().find({ openingSlug: slug }).toArray();
    const byPly: Record<string, { note: string; authorName: string; updatedAt: Date }> = {};
    for (const r of rows as any[]) {
      byPly[String(r.ply)] = { note: r.note, authorName: r.authorName || "coach", updatedAt: r.updatedAt || r.authoredAt };
    }
    // Also return pending requests (with counts) so the coach's UI can prioritise.
    const requests = await this.reqs().aggregate([
      { $match: { openingSlug: slug, resolvedAt: { $exists: false } } },
      { $group: { _id: "$ply", count: { $sum: 1 } } },
    ]).toArray();
    const pending: Record<string, number> = {};
    for (const r of requests as any[]) pending[String(r._id)] = r.count;
    return { slug, notes: byPly, pendingRequests: pending };
  }

  /** Coach / academy_owner: author (upsert) a note for one move. */
  async upsertNote(session: any, slug: string, ply: number, note: string) {
    const me = session?.userId;
    const role = session?.role;
    const username = session?.username;
    if (!me) throw new ForbiddenException("sign in first");
    if (role !== "coach" && role !== "academy_owner" && !session?.admin) throw new ForbiddenException("coach/owner only");
    if (!SLUG_RE.test(slug)) throw new BadRequestException("bad slug");
    const p = Number(ply);
    if (!Number.isInteger(p) || p < 1 || p > 200) throw new BadRequestException("bad ply");
    const txt = String(note || "").trim();
    if (!txt) throw new BadRequestException("empty note");
    const clipped = txt.slice(0, MAX_NOTE_CHARS);
    const now = new Date();
    await this.col().updateOne(
      { openingSlug: slug, ply: p } as any,
      {
        $set: { note: clipped, authorId: me, authorName: username || me, updatedAt: now },
        $setOnInsert: { openingSlug: slug, ply: p, authoredAt: now },
      },
      { upsert: true },
    );
    // Resolve any outstanding requests for this ply so the coach's queue clears.
    await this.reqs().updateMany(
      { openingSlug: slug, ply: p, resolvedAt: { $exists: false } },
      { $set: { resolvedAt: now, resolvedBy: me } },
    );
    return { ok: true };
  }

  /** Any signed-in student: request an explanation for a move. Dedup per
   *  (user, slug, ply) so a student mashing "?" doesn't inflate the count. */
  async requestNote(session: any, slug: string, ply: number) {
    const me = session?.userId;
    if (!me) throw new ForbiddenException("sign in first");
    if (!SLUG_RE.test(slug)) throw new BadRequestException("bad slug");
    const p = Number(ply);
    if (!Number.isInteger(p) || p < 1 || p > 200) throw new BadRequestException("bad ply");
    await this.reqs().updateOne(
      { openingSlug: slug, ply: p, userId: me } as any,
      { $setOnInsert: { openingSlug: slug, ply: p, userId: me, requestedAt: new Date() } },
      { upsert: true },
    );
    return { ok: true };
  }

  /** Coach queue: openings with pending explanation requests, grouped. */
  async coachPending(session: any) {
    const me = session?.userId;
    const role = session?.role;
    if (!me) throw new ForbiddenException("sign in first");
    if (role !== "coach" && role !== "academy_owner" && !session?.admin) throw new ForbiddenException("coach/owner only");
    const rows = await this.reqs().aggregate([
      { $match: { resolvedAt: { $exists: false } } },
      { $group: { _id: { slug: "$openingSlug", ply: "$ply" }, count: { $sum: 1 }, latest: { $max: "$requestedAt" } } },
      { $sort: { count: -1, latest: -1 } },
      { $limit: 200 },
    ]).toArray();
    return rows.map((r: any) => ({ slug: r._id.slug, ply: r._id.ply, count: r.count, latest: r.latest }));
  }
}
