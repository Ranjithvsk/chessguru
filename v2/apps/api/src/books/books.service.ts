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

  /** List every book visible to the caller: seeded + own-added + academy-added. */
  async list(session: any) {
    const { userId, academyId } = this.ensureUser(session);
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

  async get(session: any, bookId: string) {
    const { userId, academyId } = this.ensureUser(session);
    const book = await this.books().findOne({ _id: bookId });
    if (!book) throw new NotFoundException("no such book");
    // Non-seeded books: only visible to their creator or same-academy members.
    if (!book.isSeeded && book.addedByUserId !== userId && (!book.academyId || book.academyId !== academyId)) {
      throw new ForbiddenException("no access");
    }
    // Attach caller's progress in the same round-trip so the UI has everything.
    const prog = await this.progress().findOne({ _id: `${userId}:${bookId}` });
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
    if (!title || !author) throw new BadRequestException("title + author required");
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
}
