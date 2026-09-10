// "My Books" — a coach's own PDF, read once by the vision pipeline and served
// back as playable positions.
//
//   GET /api/user-books              — my books
//   GET /api/user-books/:id          — one book + every diagram in it
//   GET /api/user-books/:id/page/:n  — a rendered page image
//
// Ingest itself lives in the vision service (POST :5100/book/ingest); it takes
// ~115s for a 29-page book and writes pages/ + diagrams.json under STORE. That
// cost is paid ONCE per book, which is the whole reason the reader can feel
// instant: turning a page is a static image fetch, not a scan.
//
// Books are private to their uploader. These are copyrighted works a coach
// owns a copy of — we are giving them a better way to read it, not building a
// library, so there is no public listing and no cross-user access.
import { Body, Controller, Get, Param, Post, Req, Res, BadRequestException, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { appendFileSync, createReadStream, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const STORE = "/var/lib/chessguru/user-books";

type Diagram = { page: number; bbox: number[] | null; fen: string; conf?: number; corrected?: boolean };

function bookDir(id: string): string {
  // Defend the path: an id is an opaque handle, never a traversal.
  const dir = resolve(STORE, id);
  if (!dir.startsWith(STORE + "/")) throw new NotFoundException("book not found");
  return dir;
}

function readJson<T>(p: string, fallback: T): T {
  try { return JSON.parse(readFileSync(p, "utf8")) as T; } catch { return fallback; }
}

@Controller("user-books")
export class UserBooksController {
  private requireUser(req: any): string {
    const uid = req?.session?.userId;
    if (!uid) throw new UnauthorizedException("login required");
    return String(uid);
  }

  @Get()
  list(@Req() req: any) {
    const uid = this.requireUser(req);
    if (!existsSync(STORE)) return { books: [] };
    const books = readdirSync(STORE)
      .filter((id) => statSync(join(STORE, id)).isDirectory())
      .map((id) => {
        const dir = join(STORE, id);
        const meta = readJson<any>(join(dir, "meta.json"), {});
        const status = readJson<any>(join(dir, "status.json"), {});
        const diagrams = readJson<Diagram[]>(join(dir, "diagrams.json"), []);
        return {
          id,
          title: meta.title || id,
          owner: meta.owner ?? null,
          pages: status.pages ?? 0,
          diagrams: diagrams.length,
          state: status.state ?? "unknown",
          done: status.done ?? 0,
        };
      })
      // Own books only. A book with no recorded owner is treated as shared
      // seed content rather than someone else's private upload.
      .filter((b) => b.owner === null || b.owner === uid);
    return { books };
  }

  @Get(":id")
  detail(@Param("id") id: string, @Req() req: any) {
    const uid = this.requireUser(req);
    const dir = bookDir(id);
    if (!existsSync(dir)) throw new NotFoundException("book not found");
    const meta = readJson<any>(join(dir, "meta.json"), {});
    if (meta.owner && meta.owner !== uid) throw new NotFoundException("book not found");
    const status = readJson<any>(join(dir, "status.json"), {});
    const diagrams = readJson<Diagram[]>(join(dir, "diagrams.json"), []);
    return {
      id,
      title: meta.title || id,
      pages: status.pages ?? 0,
      state: status.state ?? "unknown",
      done: status.done ?? 0,
      seconds: status.seconds ?? null,
      // Numbered in reading order so the reader can label them "position 12"
      // the way the book labels its problems.
      diagrams: diagrams.map((d, i) => ({ n: i + 1, ...d })),
    };
  }

  /** Correct one diagram, from the reader.
   *
   *  A coach fixing a square while looking at the printed diagram beside it is
   *  the most reliable label we will ever get — better than the chess
   *  constraint pass, which proves legality but cannot know what was PRINTED.
   *  Before this, that correction lived only in their browser: the stored
   *  diagram kept the misread, reopening the book lost the fix, and the
   *  training set never heard about it.
   *
   *  Appends to corrections.jsonl as well as updating the diagram, because the
   *  ORIGINAL matters — a wrong read paired with its human fix is exactly the
   *  example worth training on, and overwriting it would throw that away.
   */
  @Post(":id/diagram/:n")
  correct(@Param("id") id: string, @Param("n") n: string,
          @Body() body: { fen?: string }, @Req() req: any) {
    const uid = this.requireUser(req);
    const dir = bookDir(id);
    if (!existsSync(dir)) throw new NotFoundException("book not found");
    const meta = readJson<any>(join(dir, "meta.json"), {});
    if (meta.owner && meta.owner !== uid) throw new NotFoundException("book not found");

    const fen = String(body?.fen || "").trim();
    // Board field only: 8 ranks of pieces and run-lengths. Anything else is a
    // client bug or someone poking at the endpoint.
    const board = fen.split(" ")[0] || "";
    if (!/^([1-8pnbrqkPNBRQK]+\/){7}[1-8pnbrqkPNBRQK]+$/.test(board)) {
      throw new BadRequestException("not a board position");
    }
    const idx = Number(n) - 1;             // the reader numbers them from 1
    const diagrams = readJson<Diagram[]>(join(dir, "diagrams.json"), []);
    if (!Number.isInteger(idx) || idx < 0 || idx >= diagrams.length) {
      throw new NotFoundException("diagram not found");
    }
    const before = diagrams[idx];
    const wasFen = String(before?.fen ?? "");
    diagrams[idx] = { ...(before as Diagram), fen, conf: 1, corrected: true } as Diagram;
    writeFileSync(join(dir, "diagrams.json"), JSON.stringify(diagrams));
    appendFileSync(join(dir, "corrections.jsonl"),
      JSON.stringify({ n: idx + 1, page: before?.page, was: wasFen, now: fen,
                       by: uid, at: new Date().toISOString() }) + "\n");
    return { ok: true, n: idx + 1, was: wasFen, now: fen };
  }

  @Get(":id/page/:n")
  page(@Param("id") id: string, @Param("n") n: string, @Req() req: any, @Res() res: any) {
    const uid = this.requireUser(req);
    const dir = bookDir(id);
    const meta = readJson<any>(join(dir, "meta.json"), {});
    if (meta.owner && meta.owner !== uid) throw new NotFoundException("page not found");
    const idx = Number(n);
    if (!Number.isInteger(idx) || idx < 0 || idx > 9999) throw new NotFoundException("page not found");
    const file = join(dir, "pages", `p${String(idx).padStart(4, "0")}.jpg`);
    if (!existsSync(file)) throw new NotFoundException("page not found");
    // Page images never change once ingested, so let the browser keep them —
    // this is what makes scrolling a book feel like a book.
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "private, max-age=86400");
    createReadStream(file).pipe(res);
  }
}
