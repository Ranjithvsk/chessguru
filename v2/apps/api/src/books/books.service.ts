// Chess-book library — the "which real book / chapter is this study from?"
// dimension. Two collections:
//
//   `books`         — one doc per book. Seeded books ship with the platform
//                     (visible to everyone). User-added books are scoped by
//                     addedByUserId + academyId.
//   `bookProgress`  — per-user progress: which chapters completed, which
//                     studies were spawned from which chapter.
//
// On module boot we upsert the SEED_BOOKS catalogue so the starter library
// is always fresh. Coach edits (title, chapters, tags) only apply to
// user-added books — we NEVER overwrite user edits by re-seeding.

import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException, OnModuleInit } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { randomBytes } from "crypto";
import { SEED_BOOKS, type SeedBook } from "./books.seed";
import {
  academyInScope,
  academyScopeFilter,
  attachAcademyNames,
  resolveReadScope,
} from "../lib/academy-scope";

const MAX_TITLE = 200;
const MAX_AUTHOR = 120;
const MAX_CHAPTERS = 200;
const MAX_CHAPTER_TITLE = 200;
const MAX_TAG = 40;
const MAX_TAGS_PER_CHAPTER = 20;

function shortId(): string { return randomBytes(8).toString("base64url"); }

export interface Chapter {
  number: number;
  title: string;
  tags: string[];
}

export interface BookDoc {
  _id: string;
  title: string;
  author: string;
  publisher?: string;
  year?: number;
  coverImageUrl?: string;
  pdfUrl?: string;               // static-served PDF, e.g. /book-files/<slug>.pdf
  chapters: Chapter[];
  isSeeded: boolean;
  /** The id of the same book on the Vinayaka library host, when this row was
   *  created by attaching a study to a library book. */
  hostBookId?: string;
  /** Which shelf the library filed it under (Openings, Endgames, ...). */
  shelf?: string;
  addedByUserId?: string;
  academyId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BookProgressDoc {
  _id: string;                 // `${userId}:${bookId}`
  userId: string;
  bookId: string;
  chaptersCompleted: number[]; // chapter.number values
  studiesLinked: string[];     // studyIds spawned from this book
  notes?: string;
  updatedAt: Date;
}

@Injectable()
export class BooksService implements OnModuleInit {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  private books() { return this.conn.db!.collection<BookDoc>("books"); }
  private progress() { return this.conn.db!.collection<BookProgressDoc>("bookProgress"); }

  private ensureUser(session: any): { userId: string; academyId: string | null } {
    const userId = session?.userId;
    if (!userId) throw new UnauthorizedException("sign in first");
    return { userId: String(userId), academyId: session?.academyId ?? null };
  }

  /** Upsert every SEED_BOOKS entry with isSeeded: true. Only touches title/
   *  author/publisher/year/chapters (never overwrites user-added books). Runs
   *  on boot and is cheap enough to always run (30 upserts). */
  async onModuleInit() {
    try {
      for (const s of SEED_BOOKS) {
        const set: any = {
          title: s.title,
          author: s.author,
          publisher: s.publisher,
          year: s.year,
          chapters: s.chapters,
          isSeeded: true,
          updatedAt: new Date(),
        };
        const unset: any = {};
        if (s.pdfUrl) set.pdfUrl = s.pdfUrl; else unset.pdfUrl = "";
        if (s.coverImageUrl) set.coverImageUrl = s.coverImageUrl; else unset.coverImageUrl = "";
        const update: any = { $set: set, $setOnInsert: { createdAt: new Date() } };
        if (Object.keys(unset).length) update.$unset = unset;
        await this.books().updateOne({ _id: s._id }, update, { upsert: true });
      }
    } catch (e) {
      console.error("[books] seed upsert failed:", (e as any)?.message || e);
    }
  }

  /* ─── super-admin cross-academy READ override ──────────────────────────
   *
   * Owner ask 2026-09-11 ("study and online book ... i need option to view").
   * READS ONLY: list + get accept ?academy=<slug|__all__|__platform__> from an
   * admin. Every write below (create/update/remove/markChapterDone) still
   * stamps and checks the caller's OWN session.academyId, so an admin can read
   * another academy's library but can never add to or edit it.
   *
   * Two things stay deliberately un-scoped:
   *   - SEEDED books are platform-wide (30 of the 32 rows, academyId absent by
   *     design) and every academy already sees all of them, so they stay in the
   *     result under an override too. Dropping them would make the screen look
   *     broken, and they are not any academy's private data.
   *   - PROGRESS (`bookProgress`, keyed `${userId}:${bookId}` with no academy
   *     field) remains the CALLER's own. Viewing Guna's library shows Ranjith's
   *     own reading progress, not Guna's. Showing the academy's actual reading
   *     would need a roster join, which is a different ask — raise it with the
   *     owner rather than guessing here.
   *
   * The null/absent-academyId rule matches studies: a book with no academyId
   * belongs to the __platform__ bucket. In practice only seeded books are in
   * that state today; both user-added books are correctly stamped.
   */

  /** List every book visible to the caller: seeded + own-added + academy-added.
   *  Admins may pass ?academy=<slug|__all__|__platform__> to see THAT academy's
   *  added books instead of their own; everyone else's result is unchanged. */
  async list(session: any, opts: { academy?: string } = {}) {
    const { userId, academyId } = this.ensureUser(session);
    const scope = resolveReadScope(session, opts);
    if (scope.viewingOther) {
      // Admin override: platform-wide seeded books + the target academy's own
      // additions. The caller's personal `addedByUserId` clause is dropped —
      // his own books are not part of the academy he asked to look at.
      const items = await this.books()
        .find({ $or: [{ isSeeded: true }, { ...academyScopeFilter(scope), isSeeded: false }] }, { projection: { chapters: 0 } })
        .sort({ isSeeded: -1, title: 1 })
        .limit(500)
        .toArray();
      // __all__ mixes academies together, so label every row.
      return { items: await attachAcademyNames(this.conn, items) };
    }
    const or: any[] = [
      { isSeeded: true },
      { addedByUserId: userId },
    ];
    if (academyId) or.push({ academyId, isSeeded: false });
    const items = await this.books()
      .find({ $or: or }, { projection: { chapters: 0 } })
      .sort({ isSeeded: -1, title: 1 })
      .limit(500)
      .toArray();
    return { items };
  }

  async get(session: any, bookId: string, opts: { academy?: string } = {}) {
    const { userId, academyId } = this.ensureUser(session);
    const scope = resolveReadScope(session, opts);
    const book = await this.books().findOne({ _id: bookId });
    if (!book) throw new NotFoundException("no such book");
    // Admin cross-academy override grants read on seeded books and on any book
    // inside the requested scope. A book OUTSIDE that scope falls through to
    // the ordinary rule below, so a wrong ?academy= never widens access.
    const overrideGrantsRead = scope.viewingOther && (book.isSeeded || academyInScope(book.academyId, scope));
    // Non-seeded books: only visible to their creator or same-academy members.
    if (!overrideGrantsRead && !book.isSeeded && book.addedByUserId !== userId && (!book.academyId || book.academyId !== academyId)) {
      throw new ForbiddenException("no access");
    }
    // Attach caller's progress in the same round-trip so the UI has everything.
    // Under an override this is still the ADMIN's own progress — see the note
    // on the override block above.
    const prog = await this.progress().findOne({ _id: `${userId}:${bookId}` });
    if (scope.viewingOther) {
      const [labelled] = await attachAcademyNames(this.conn, [book as any]);
      return {
        book: labelled,
        progress: prog ?? { userId, bookId, chaptersCompleted: [], studiesLinked: [] },
      };
    }
    return {
      book,
      progress: prog ?? { userId, bookId, chaptersCompleted: [], studiesLinked: [] },
    };
  }

  /** Create a user-added book (falls into "not seeded"). */
  async create(session: any, body: any) {
    const { userId, academyId } = this.ensureUser(session);
    const b = this.sanitizeBook(body);
    const now = new Date();
    const id = shortId();
    await this.books().insertOne({
      _id: id,
      title: b.title,
      author: b.author,
      publisher: b.publisher,
      year: b.year,
      coverImageUrl: b.coverImageUrl,
      chapters: b.chapters,
      isSeeded: false,
      addedByUserId: userId,
      academyId,
      createdAt: now,
      updatedAt: now,
    });
    return { bookId: id };
  }

  /** Edit a user-added book. Seeded books are immutable via this endpoint. */
  async update(session: any, bookId: string, body: any) {
    const { userId } = this.ensureUser(session);
    const book = await this.books().findOne({ _id: bookId });
    if (!book) throw new NotFoundException("no such book");
    if (book.isSeeded) throw new ForbiddenException("seeded books can't be edited");
    if (book.addedByUserId !== userId) throw new ForbiddenException("only the creator can edit");
    const b = this.sanitizeBook(body);
    await this.books().updateOne(
      { _id: bookId },
      { $set: { ...b, updatedAt: new Date() } },
    );
    return { ok: true };
  }

  async remove(session: any, bookId: string) {
    const { userId } = this.ensureUser(session);
    const book = await this.books().findOne({ _id: bookId });
    if (!book) throw new NotFoundException("no such book");
    if (book.isSeeded) throw new ForbiddenException("seeded books can't be removed");
    if (book.addedByUserId !== userId) throw new ForbiddenException("only the creator can remove");
    await this.books().deleteOne({ _id: bookId });
    await this.progress().deleteMany({ bookId });
    return { ok: true };
  }

  /* ── progress ────────────────────────────────────────────────────────── */

  async markChapterDone(session: any, bookId: string, chapterNumber: number, done: boolean) {
    const { userId } = this.ensureUser(session);
    const book = await this.books().findOne({ _id: bookId }, { projection: { chapters: 1, isSeeded: 1, addedByUserId: 1, academyId: 1 } });
    if (!book) throw new NotFoundException("no such book");
    const chNum = Number(chapterNumber);
    if (!book.chapters.find((c) => c.number === chNum)) throw new NotFoundException("no such chapter");

    const pid = `${userId}:${bookId}`;
    if (done) {
      await this.progress().updateOne(
        { _id: pid },
        {
          $addToSet: { chaptersCompleted: chNum },
          $set: { updatedAt: new Date() },
          $setOnInsert: { userId, bookId, studiesLinked: [] },
        },
        { upsert: true },
      );
    } else {
      await this.progress().updateOne(
        { _id: pid },
        { $pull: { chaptersCompleted: chNum }, $set: { updatedAt: new Date() } },
      );
    }
    return { ok: true };
  }

  /** Called by StudiesService when a study is created that references a book. */
  async linkStudy(userId: string, bookId: string, studyId: string) {
    const pid = `${userId}:${bookId}`;
    await this.progress().updateOne(
      { _id: pid },
      {
        $addToSet: { studiesLinked: studyId },
        $set: { updatedAt: new Date() },
        $setOnInsert: { userId, bookId, chaptersCompleted: [] },
      },
      { upsert: true },
    );
  }

  /* ── helpers ─────────────────────────────────────────────────────────── */

  private sanitizeBook(body: any): {
    title: string; author: string; publisher?: string; year?: number;
    coverImageUrl?: string; chapters: Chapter[];
  } {
    const b: any = body ?? {};
    const title = String(b.title || "").trim().slice(0, MAX_TITLE);
    const author = String(b.author || "").trim().slice(0, MAX_AUTHOR);
    // Author optional. A book added from the study picker is really just a
    // SEARCH INDEX ENTRY — a title somebody typed because it was not in the
    // list yet — and demanding an author there would block the one flow the
    // entry exists for. The full Add-a-book form still asks for one.
    if (!title) throw new BadRequestException("title required");
    const publisher = b.publisher ? String(b.publisher).trim().slice(0, 120) : undefined;
    const year = Number.isFinite(Number(b.year)) ? Number(b.year) : undefined;
    const coverImageUrl = b.coverImageUrl ? String(b.coverImageUrl).trim().slice(0, 500) : undefined;
    const rawChapters = Array.isArray(b.chapters) ? b.chapters : [];
    if (rawChapters.length > MAX_CHAPTERS) throw new BadRequestException("too many chapters");
    const chapters: Chapter[] = rawChapters.map((c: any, i: number) => ({
      number: Number.isFinite(Number(c?.number)) ? Number(c.number) : (i + 1),
      title: String(c?.title || "").trim().slice(0, MAX_CHAPTER_TITLE) || `Chapter ${i + 1}`,
      tags: Array.isArray(c?.tags)
        ? c.tags.map((t: any) => String(t).trim().slice(0, MAX_TAG)).filter(Boolean).slice(0, MAX_TAGS_PER_CHAPTER)
        : [],
    }));
    // De-dup chapter numbers.
    const seen = new Set<number>();
    for (const c of chapters) {
      if (seen.has(c.number)) throw new BadRequestException("duplicate chapter number: " + c.number);
      seen.add(c.number);
    }
    return { title, author, publisher, year, coverImageUrl, chapters };
  }

  /* ─── the owner's real library, hosted on Vinayaka ──────────────────────
   *
   * 3,032 books live on the GPU box and are already reachable through the
   * bookhost tunnel. They are NOT copied into this collection: a second copy
   * of a catalogue that someone keeps adding to would drift the day it was
   * written. Instead the picker SEARCHES the live catalogue, and a book only
   * becomes a row here once somebody actually attaches a study to it.
   *
   * The raw catalogue is 1.2 MB and every row carries the owner's Google
   * Drive path, so it is cached in memory here and only ever leaves as slim,
   * path-free matches. */
  private static libCache: { at: number; rows: Array<{ id: string; title: string; author: string; shelf: string }> } | null = null;

  private async bookHost(path: string): Promise<any> {
    const r = await fetch(`http://127.0.0.1:8791${path}`, { signal: AbortSignal.timeout(45_000) });
    if (!r.ok) throw new Error(`bookhost ${r.status}`);
    return r.json();
  }

  /** Cached slim catalogue, with cleaned titles laid over the filename-derived
   *  ones where we have them. */
  private async libraryRows() {
    const fresh = BooksService.libCache && Date.now() - BooksService.libCache.at < 10 * 60_000;
    if (fresh) return BooksService.libCache!.rows;
    const raw = await this.bookHost("/catalogue");
    const clean = new Map<string, { title?: string; author?: string }>();
    try {
      const docs = await this.conn.db!.collection("bookTitles").find({}).toArray();
      for (const d of docs) clean.set(String(d._id), { title: (d as any).title, author: (d as any).author });
    } catch { /* overlay is optional */ }
    const rows = (raw?.books ?? []).map((b: any) => {
      const c = clean.get(b.id) || {};
      return {
        id: String(b.id),
        title: String(c.title || b.title || b.id),
        author: String(c.author || b.author || ""),
        shelf: String(b.shelf || ""),
      };
    });
    // The catalogue lists some books more than once — the same title sitting in
    // two folders, or a second scan of it. Showing "Positional Play" three
    // times in a picker is noise, so collapse on title+author and keep the
    // first. The duplicates stay in the library itself; this is display only.
    const seen = new Set<string>();
    const deduped = rows.filter((r: { title: string; author: string }) => {
      const k = (r.title + "|" + r.author).toLowerCase().replace(/\s+/g, " ").trim();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    BooksService.libCache = { at: Date.now(), rows: deduped };
    return deduped;
  }

  /** Search the library by title or author. Returns slim rows only — never the
   *  Drive path, never the full 3,032. */
  async searchLibrary(session: any, q: string, limit = 25) {
    this.ensureUser(session);
    let rows: Array<{ id: string; title: string; author: string; shelf: string }>;
    try {
      rows = await this.libraryRows();
    } catch (e: any) {
      // Loud on purpose. This reaches another machine over a tunnel, and when
      // it fails the picker can only show an empty list — which is
      // indistinguishable from "no such book". Without this line there is
      // nothing to look at afterwards.
      console.error("[books] library search FAILED for %j: %s", q, e?.message || e);
      throw new BadRequestException("library unavailable: " + (e?.message || "unknown"));
    }
    const needle = String(q || "").trim().toLowerCase();
    if (!needle) return { items: rows.slice(0, limit), total: rows.length };
    const terms = needle.split(/\s+/).filter(Boolean);
    const scored: Array<{ r: any; s: number }> = [];
    for (const r of rows) {
      const hay = (r.title + " " + r.author).toLowerCase();
      if (!terms.every((t) => hay.includes(t))) continue;
      // Prefix matches on the title first, then earlier matches.
      const idx = r.title.toLowerCase().indexOf(terms[0]!);
      scored.push({ r, s: (idx === 0 ? 0 : idx < 0 ? 500 : 100 + idx) + r.title.length / 100 });
    }
    scored.sort((a, b) => a.s - b.s);
    console.log("[books] library search %j -> %d hits of %d books", q, scored.length, rows.length);
    return { items: scored.slice(0, limit).map((x) => x.r), total: scored.length };
  }

  /** Turn a PDF outline into a usable chapter list. A raw outline is mostly
   *  front matter and sub-entries — one book here has 1,007 of them — so keep
   *  top-level entries, drop the boilerplate, and cap it. */
  private tocToChapters(toc: any[]): Chapter[] {
    const JUNK = /^(title|contents?|copyright|index|bibliography|about the author|acknowledg|preface|foreword|dedication|table of contents|symbols|introduction to the|colophon|cover)\b/i;
    const lvl1 = (Array.isArray(toc) ? toc : []).filter((t) => Number(t?.level ?? 1) === 1);
    const src = lvl1.length >= 3 ? lvl1 : (Array.isArray(toc) ? toc : []);
    const out: Chapter[] = [];
    const seen = new Set<string>();
    for (const t of src) {
      const title = String(t?.title || "").replace(/\s+/g, " ").trim();
      if (!title || title.length > 160) continue;
      if (JUNK.test(title)) continue;
      const key = title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ number: out.length + 1, title, tags: [] });
      if (out.length >= 80) break;
    }
    return out;
  }

  /** Attach a library book to this collection so a study can point at it.
   *  Idempotent: the same host book always resolves to the same row, so two
   *  people attaching the same book share it rather than making duplicates.
   *  Chapters are pulled from the book's outline at this moment — the one time
   *  it is worth asking the GPU box to open the PDF. */
  async adoptLibraryBook(session: any, hostId: string) {
    this.ensureUser(session);
    const id = String(hostId || "").trim();
    if (!id) throw new BadRequestException("hostId required");
    const existing = await this.books().findOne({ hostBookId: id } as any);
    if (existing) return { bookId: existing._id, reused: true };
    const rows = await this.libraryRows();
    const row = rows.find((r: { id: string; title: string; author: string; shelf: string }) => r.id === id);
    if (!row) throw new NotFoundException("not in the library catalogue");
    let chapters: Chapter[] = [];
    try {
      const t = await this.bookHost(`/book/${encodeURIComponent(id)}/toc`);
      chapters = this.tocToChapters(t?.toc ?? []);
    } catch { chapters = []; }
    const now = new Date();
    const bookId = "lib_" + id.slice(0, 40);
    await this.books().insertOne({
      _id: bookId,
      title: row.title,
      author: row.author,
      chapters,
      isSeeded: true,          // from the shared library, not one person's addition
      hostBookId: id,
      shelf: row.shelf,
      createdAt: now,
      updatedAt: now,
    } as any);
    return { bookId, reused: false, chapters: chapters.length };
  }

}
