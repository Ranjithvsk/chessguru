// User-created studies (Slice 1): the classroom notebook.
//
// A Study is a container. Each Study has 1..N Chapters. A Chapter is a
// starting position + a move-tree + optional per-move comments/shapes/NAGs.
//
// Data model — two Mongo collections:
//
//   `studies`      : one doc per study (owner, title, intent, visibility)
//   `studyChapters`: one doc per chapter (studyId → moves array)
//
// Move tree is stored FLAT (each node has parentId) rather than deeply
// nested. Flat is easier to CRUD and easier to reason about when applying
// edits (jump-to-any-move, branch-a-variation, delete-a-subtree).
//
// Auth model:
//   - Any signed-in user in an academy can CREATE/READ/UPDATE their own studies.
//   - Studies can be shared with specific users (coach access) or made
//     "academy-visible" or "public". Owner is the source of truth for edits.
//   - Slice 1: no real-time collab (single-writer). Slice 2+ adds websockets.

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { randomBytes } from "crypto";
import { Chess } from "chess.js";
import { BooksService } from "../books/books.service";
import { RevisionsService } from "../revisions/revisions.service";

const MAX_TITLE = 140;
const MAX_COMMENT = 4000;
const MAX_MOVES = 2000; // largest reasonable study chapter (deep opening prep)
const MAX_CHAPTERS = 60;

// Intent picker on the create-study screen — decides how the editor opens.
const INTENTS = new Set(["game", "puzzle", "concept", "opening", "endgame", "notebook", "book"]);
const VISIBILITIES = new Set(["private", "shared", "academy", "public"]);

function shortId(bytes = 8): string {
  return randomBytes(bytes).toString("base64url");
}

export interface Shape {
  brush: "green" | "red" | "blue" | "yellow";
  orig: string;         // square, e.g. "e4"
  dest?: string;        // present for arrows, absent for circles
}

export interface MoveNode {
  id: string;
  parentId: string | null; // null = child of starting position
  ply: number;             // 1 = first move (White), 2 = second (Black), ...
  san: string;             // "e4", "O-O", "Nxe5+"
  uci: string;             // "e2e4", "e1g1"
  fenAfter: string;
  comment?: string;
  nag?: number;            // 1=!, 2=?, 3=!!, 4=??, 5=!?, 6=?!
  shapes?: Shape[];
  isRevisePoint?: boolean; // ⭐ flag → feeds spaced-repetition queue
  isMainLine: boolean;     // true when this node is on the main line
}

export interface SourceBook {
  bookId: string;
  chapterNumber?: number;
  topicTags?: string[];  // snapshot of chapter.tags at link time, freezes intent even if book edits later
}

export interface StudyDoc {
  _id: string;
  ownerId: string;
  academyId: string | null;
  title: string;
  intent: "game" | "puzzle" | "concept" | "opening" | "endgame" | "notebook" | "book";
  visibility: "private" | "shared" | "academy" | "public";
  sharedWithUserIds: string[];
  chapterCount: number;
  sourceBook?: SourceBook;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChapterDoc {
  _id: string;
  studyId: string;
  order: number;
  title: string;
  startingFen: string;
  moves: MoveNode[];
  headers?: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class StudiesService {
  constructor(
    @InjectConnection() private readonly conn: Connection,
    private readonly books: BooksService,
    private readonly revisions: RevisionsService,
  ) {}

  private studies() { return this.conn.db!.collection<StudyDoc>("studies"); }
  private chapters() { return this.conn.db!.collection<ChapterDoc>("studyChapters"); }

  /** Extract userId from session; throw 401 if missing. */
  private ensureUser(session: any): { userId: string; academyId: string | null } {
    const userId = session?.userId;
    if (!userId) throw new UnauthorizedException("sign in first");
    return { userId: String(userId), academyId: session?.academyId ?? null };
  }

  /** Fetch a study + assert the caller can READ it. Everyone in an academy
   *  can see academy/public studies; owner + explicit shares can see private
   *  and shared. */
  private async loadForRead(studyId: string, userId: string, academyId: string | null): Promise<StudyDoc> {
    const s = await this.studies().findOne({ _id: studyId });
    if (!s) throw new NotFoundException("no such study");
    if (s.ownerId === userId) return s;
    if (s.visibility === "public") return s;
    if (s.visibility === "academy" && s.academyId && s.academyId === academyId) return s;
    if (s.visibility === "shared" && s.sharedWithUserIds.includes(userId)) return s;
    throw new ForbiddenException("no access");
  }

  /** Fetch a study + assert the caller OWNS it. Only owner can mutate in Slice 1. */
  private async loadForWrite(studyId: string, userId: string): Promise<StudyDoc> {
    const s = await this.studies().findOne({ _id: studyId });
    if (!s) throw new NotFoundException("no such study");
    if (s.ownerId !== userId) throw new ForbiddenException("only the owner can edit this study");
    return s;
  }

  /* ─── list / create / meta ─────────────────────────────────────────────── */

  /** List studies the caller can see (own + shared + academy-visible). */
  async listMine(session: any) {
    const { userId, academyId } = this.ensureUser(session);
    const or: any[] = [
      { ownerId: userId },
      { sharedWithUserIds: userId },
    ];
    if (academyId) or.push({ visibility: "academy", academyId });
    const rows = await this.studies()
      .find({ $or: or }, { projection: { moves: 0 } })
      .sort({ updatedAt: -1 })
      .limit(200)
      .toArray();
    return { items: rows };
  }

  async create(session: any, body: any) {
    const { userId, academyId } = this.ensureUser(session);
    const b: any = body ?? {};
    const title = String(b.title || "").trim().slice(0, MAX_TITLE) || "Untitled study";
    const intent = INTENTS.has(String(b.intent)) ? String(b.intent) : "notebook";
    const visibility = VISIBILITIES.has(String(b.visibility)) ? String(b.visibility) : "private";
    const startingFen = this.normalizeFen(b.startingFen);
    const chapterTitle = String(b.chapterTitle || "").trim().slice(0, MAX_TITLE) || "Chapter 1";

    const now = new Date();
    const studyId = shortId(10);
    const chapterId = shortId(10);

    // If body.pgn is present, parse it into the first chapter's moves.
    let moves: MoveNode[] = [];
    let headers: Record<string, string> | undefined;
    if (typeof b.pgn === "string" && b.pgn.trim()) {
      const parsed = this.parsePgn(b.pgn, startingFen);
      moves = parsed.moves;
      headers = parsed.headers;
    }

    const sourceBook = this.sanitizeSourceBook(b.sourceBook);

    await this.studies().insertOne({
      _id: studyId,
      ownerId: userId,
      academyId,
      title,
      intent: intent as any,
      visibility: visibility as any,
      sharedWithUserIds: [],
      chapterCount: 1,
      sourceBook,
      createdAt: now,
      updatedAt: now,
    });
    if (sourceBook) {
      try { await this.books.linkStudy(userId, sourceBook.bookId, studyId); } catch { /* non-fatal */ }
    }
    await this.chapters().insertOne({
      _id: chapterId,
      studyId,
      order: 0,
      title: chapterTitle,
      startingFen,
      moves,
      headers,
      createdAt: now,
      updatedAt: now,
    });
    return { studyId, chapterId };
  }

  async get(session: any, studyId: string) {
    const { userId, academyId } = this.ensureUser(session);
    const s = await this.loadForRead(studyId, userId, academyId);
    const chapters = await this.chapters()
      .find({ studyId: s._id }, { projection: { moves: 0 } })
      .sort({ order: 1 })
      .toArray();
    return { study: s, chapters };
  }

  async updateMeta(session: any, studyId: string, body: any) {
    const { userId } = this.ensureUser(session);
    const s = await this.loadForWrite(studyId, userId);
    const b: any = body ?? {};
    const set: any = { updatedAt: new Date() };
    const unset: any = {};
    if (typeof b.title === "string") set.title = b.title.trim().slice(0, MAX_TITLE) || s.title;
    if (VISIBILITIES.has(String(b.visibility))) set.visibility = b.visibility;
    if (Array.isArray(b.sharedWithUserIds)) {
      set.sharedWithUserIds = b.sharedWithUserIds.filter((x: any) => typeof x === "string").slice(0, 40);
    }
    // sourceBook: null → unlink; object → sanitize + link (and cross-write progress).
    if ("sourceBook" in b) {
      if (b.sourceBook === null) {
        unset.sourceBook = "";
      } else {
        const sb = this.sanitizeSourceBook(b.sourceBook);
        if (sb) {
          set.sourceBook = sb;
          try { await this.books.linkStudy(userId, sb.bookId, s._id); } catch { /* non-fatal */ }
        }
      }
    }
    const update: any = { $set: set };
    if (Object.keys(unset).length) update.$unset = unset;
    await this.studies().updateOne({ _id: s._id }, update);
    return { ok: true };
  }

  private sanitizeSourceBook(raw: any): SourceBook | undefined {
    if (!raw || typeof raw !== "object") return undefined;
    const bookId = String(raw.bookId || "").trim().slice(0, 60);
    if (!bookId) return undefined;
    const chapterNumber = Number.isFinite(Number(raw.chapterNumber)) ? Number(raw.chapterNumber) : undefined;
    const topicTags = Array.isArray(raw.topicTags)
      ? raw.topicTags.map((t: any) => String(t).trim().slice(0, 40)).filter(Boolean).slice(0, 20)
      : undefined;
    return { bookId, chapterNumber, topicTags };
  }

  async remove(session: any, studyId: string) {
    const { userId } = this.ensureUser(session);
    await this.loadForWrite(studyId, userId);
    await this.chapters().deleteMany({ studyId });
    await this.studies().deleteOne({ _id: studyId });
    return { ok: true };
  }

  /* ─── chapters ─────────────────────────────────────────────────────────── */

  async getChapter(session: any, studyId: string, chapterId: string) {
    const { userId, academyId } = this.ensureUser(session);
    await this.loadForRead(studyId, userId, academyId);
    const c = await this.chapters().findOne({ _id: chapterId, studyId });
    if (!c) throw new NotFoundException("no such chapter");
    return c;
  }

  async addChapter(session: any, studyId: string, body: any) {
    const { userId } = this.ensureUser(session);
    const s = await this.loadForWrite(studyId, userId);
    if (s.chapterCount >= MAX_CHAPTERS) throw new BadRequestException("chapter limit reached");
    const b: any = body ?? {};
    const title = String(b.title || "").trim().slice(0, MAX_TITLE) || `Chapter ${s.chapterCount + 1}`;
    const startingFen = this.normalizeFen(b.startingFen);
    let moves: MoveNode[] = [];
    let headers: Record<string, string> | undefined;
    if (typeof b.pgn === "string" && b.pgn.trim()) {
      const parsed = this.parsePgn(b.pgn, startingFen);
      moves = parsed.moves;
      headers = parsed.headers;
    }
    const now = new Date();
    const chapterId = shortId(10);
    await this.chapters().insertOne({
      _id: chapterId,
      studyId,
      order: s.chapterCount,
      title,
      startingFen,
      moves,
      headers,
      createdAt: now,
      updatedAt: now,
    });
    await this.studies().updateOne(
      { _id: studyId },
      { $inc: { chapterCount: 1 }, $set: { updatedAt: now } },
    );
    return { chapterId };
  }

  async saveChapter(session: any, studyId: string, chapterId: string, body: any) {
    const { userId } = this.ensureUser(session);
    await this.loadForWrite(studyId, userId);
    const c = await this.chapters().findOne({ _id: chapterId, studyId });
    if (!c) throw new NotFoundException("no such chapter");

    const b: any = body ?? {};
    const set: any = { updatedAt: new Date() };
    if (typeof b.title === "string") set.title = b.title.trim().slice(0, MAX_TITLE) || c.title;
    if (typeof b.startingFen === "string") set.startingFen = this.normalizeFen(b.startingFen);
    if (Array.isArray(b.moves)) {
      set.moves = this.validateMoves(b.moves, set.startingFen ?? c.startingFen);
    }
    if (b.headers && typeof b.headers === "object") {
      set.headers = this.cleanHeaders(b.headers);
    }
    await this.chapters().updateOne({ _id: chapterId, studyId }, { $set: set });
    await this.studies().updateOne({ _id: studyId }, { $set: { updatedAt: new Date() } });
    // Sync owner's revision queue when moves change (⭐ flags may have flipped).
    // Non-fatal: revision system is best-effort — never block the save.
    try { await this.revisions.syncFromChapter(userId, studyId, chapterId); } catch (e) {
      console.error("[studies] revision sync failed:", (e as any)?.message || e);
    }
    return { ok: true };
  }

  async deleteChapter(session: any, studyId: string, chapterId: string) {
    const { userId } = this.ensureUser(session);
    await this.loadForWrite(studyId, userId);
    const r = await this.chapters().deleteOne({ _id: chapterId, studyId });
    if (!r.deletedCount) throw new NotFoundException("no such chapter");
    await this.studies().updateOne({ _id: studyId }, { $inc: { chapterCount: -1 }, $set: { updatedAt: new Date() } });
    return { ok: true };
  }

  /* ─── PGN parse + validation helpers ───────────────────────────────────── */

  /** Return a valid FEN string. Accepts "startpos" | undefined | any FEN;
   *  rejects malformed FENs early so we never store garbage. */
  private normalizeFen(input: any): string {
    const s = String(input || "").trim();
    if (!s || s.toLowerCase() === "startpos") {
      return "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    }
    // chess.js constructor throws on invalid FEN — catch, re-throw as 400.
    try {
      new Chess(s);
      return s;
    } catch {
      throw new BadRequestException("bad FEN");
    }
  }

  /** Turn a PGN string into a validated flat move tree. Handles variations
   *  by recursing into RAV blocks. Comments (curly braces) get attached to
   *  the move they follow. */
  parsePgn(pgn: string, startingFen: string): { moves: MoveNode[]; headers?: Record<string, string> } {
    const game = new Chess(startingFen);
    let headers: Record<string, string> | undefined;
    try {
      game.loadPgn(pgn, { strict: false });
      const hdr = (game as any).header?.() as Record<string, string> | undefined;
      if (hdr) headers = this.cleanHeaders(hdr);
    } catch (e: any) {
      throw new BadRequestException(`bad PGN: ${String(e?.message || e).slice(0, 200)}`);
    }
    const history = game.history({ verbose: true }) as any[];
    if (history.length > MAX_MOVES) throw new BadRequestException("PGN too long");
    // chess.js main-line only — reset + replay to capture fenAfter per ply.
    const replay = new Chess(startingFen);
    const moves: MoveNode[] = [];
    let parentId: string | null = null;
    let ply = 0;
    for (const h of history) {
      ply += 1;
      const m = replay.move({ from: h.from, to: h.to, promotion: h.promotion });
      if (!m) throw new BadRequestException("PGN replay failed at " + h.san);
      const id = shortId(6);
      moves.push({
        id,
        parentId,
        ply,
        san: m.san,
        uci: m.from + m.to + (m.promotion || ""),
        fenAfter: replay.fen(),
        isMainLine: true,
      });
      parentId = id;
    }
    return { moves, headers };
  }

  /** Validate a client-supplied moves array by REPLAYING it move-by-move.
   *  Prevents garbage from ever landing in the DB — one bad move short-circuits.
   *  Variations replay from their parent's fenAfter (or startingFen if root). */
  private validateMoves(rawMoves: any[], startingFen: string): MoveNode[] {
    if (!Array.isArray(rawMoves)) throw new BadRequestException("moves must be array");
    if (rawMoves.length > MAX_MOVES) throw new BadRequestException("too many moves");
    const byId = new Map<string, MoveNode>();
    const clean: MoveNode[] = [];

    // Build a lookup so we can compute a node's starting FEN by walking to its parent.
    const raw: Map<string, any> = new Map();
    for (const r of rawMoves) if (r && typeof r === "object" && r.id) raw.set(String(r.id), r);

    // Compute a node's parent fenAfter (or startingFen for root children).
    const fenBefore = (m: any): string => {
      if (!m.parentId) return startingFen;
      const p = byId.get(String(m.parentId));
      if (p) return p.fenAfter;
      // parent not processed yet — should not happen because we sort by ply.
      throw new BadRequestException("orphan move: parent " + m.parentId + " missing");
    };

    // Process in order of ply so parents land before children.
    const sorted = [...rawMoves].sort((a, b) => (a.ply || 0) - (b.ply || 0));
    for (const m of sorted) {
      const uci = String(m.uci || "").trim();
      if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) throw new BadRequestException("bad UCI: " + uci);
      const board = new Chess(fenBefore(m));
      const from = uci.slice(0, 2);
      const to = uci.slice(2, 4);
      const promotion = uci.slice(4) || undefined;
      const played = board.move({ from, to, promotion } as any);
      if (!played) throw new BadRequestException("illegal move: " + uci);
      const node: MoveNode = {
        id: String(m.id || shortId(6)).slice(0, 32),
        parentId: m.parentId ? String(m.parentId) : null,
        ply: Number(m.ply) || (byId.get(String(m.parentId))?.ply ?? 0) + 1,
        san: played.san,
        uci: played.from + played.to + (played.promotion || ""),
        fenAfter: board.fen(),
        isMainLine: !!m.isMainLine,
      };
      if (typeof m.comment === "string" && m.comment.trim()) node.comment = m.comment.slice(0, MAX_COMMENT);
      if (typeof m.nag === "number" && m.nag >= 1 && m.nag <= 6) node.nag = m.nag;
      if (Array.isArray(m.shapes)) node.shapes = m.shapes.slice(0, 40).map((s: any) => ({
        brush: ["green", "red", "blue", "yellow"].includes(s.brush) ? s.brush : "green",
        orig: String(s.orig || "").slice(0, 4),
        dest: s.dest ? String(s.dest).slice(0, 4) : undefined,
      }));
      if (m.isRevisePoint) node.isRevisePoint = true;
      byId.set(node.id, node);
      clean.push(node);
    }
    return clean;
  }

  private cleanHeaders(h: any): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(h)) {
      if (typeof k !== "string" || typeof v !== "string") continue;
      const key = k.slice(0, 40);
      const val = v.slice(0, 200);
      if (!key || !val) continue;
      out[key] = val;
    }
    return out;
  }
}
