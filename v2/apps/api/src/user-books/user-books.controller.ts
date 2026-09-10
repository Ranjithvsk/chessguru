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
import { Body, Controller, Get, Param, Post, Req, Res, BadRequestException, NotFoundException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { appendFileSync, createReadStream, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const STORE = "/var/lib/chessguru/user-books";
// Whose Drive the book host is pointed at. One library, one owner —
// these are copyrighted books belonging to a specific person.
const LIBRARY_OWNER = process.env.CHESSGURU_LIBRARY_OWNER ?? "ranjith_vsk";

type Diagram = { page: number; bbox: number[] | null; fen: string; conf?: number; corrected?: boolean; disputed?: boolean };

function bookDir(id: string): string {
  // Defend the path: an id is an opaque handle, never a traversal.
  const dir = resolve(STORE, id);
  if (!dir.startsWith(STORE + "/")) throw new NotFoundException("book not found");
  return dir;
}

/** A diagram's identity that SURVIVES a cleanup.
 *
 *  Feedback used to reference the array index ("#8"). Then a de-duplication
 *  pass and a sanity pass took the book from 126 diagrams to 86, every index
 *  shifted, and both the stored records and the coach's own notes pointed at
 *  the wrong board — owner: "position 8 is not a position" about a diagram that
 *  had already been removed, while the current #8 was fine.
 *
 *  Page plus the board's centre, rounded to 10px, does not move when other
 *  diagrams are deleted. */
function diagramKey(d: { page: number; bbox: number[] | null }): string {
  const b = d.bbox;
  if (!b || b.length < 4) return `p${d.page}`;
  // FLOOR, not round. Math.round and Python's round() disagree on exact halves
  // — JS rounds half up, Python rounds half to even — so a board centred on
  // x=605 keyed as p18_610_260 from the API and p18_600_260 from the analysis
  // scripts, and a real correction looked like it belonged to no diagram at
  // all. floor() means the same thing in every language.
  const cx = Math.floor(((b[0]! + b[2]!) / 2) / 10) * 10;
  const cy = Math.floor(((b[1]! + b[3]!) / 2) / 10) * 10;
  return `p${d.page}_${cx}_${cy}`;
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
  async list(@Req() req: any) {
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
      // Own books only, and FAIL CLOSED. This used to treat a missing owner as
      // "shared seed content", which meant every book without one was visible to
      // any signed-in coach or student — including a coach's own copyrighted
      // library. These are books someone owns a copy of; we are giving them a
      // better way to read it, not publishing it.
      .filter((b) => b.owner === uid);
    // A book read on Vinayaka is as much "my book" as one read here; where it
    // was processed is an implementation detail the shelf should not expose.
    const remote = await this.remoteBooks(uid);
    const localIds = new Set(books.map((b) => b.id));
    return { books: [...books, ...remote.filter((r) => !localIds.has(r.id))] };
  }

  /** Books that live on Vinayaka, in the same shape as the local ones.
   *
   *  Returns [] rather than throwing: the book host being down must not take
   *  the shelf with it, because the locally-held books are still readable. */
  private async remoteBooks(uid: string): Promise<any[]> {
    try {
      const j = await this.bookHost("/books");
      return (j.books ?? [])
        // The book's OWN owner decides, exactly as for a local book. Being the
        // library owner grants no access to someone else's book.
        .filter((b: any) => b.owner === uid)
        .map((b: any) => ({ ...b, remote: true }));
    } catch {
      return [];
    }
  }

  /** The owner's Drive library, and the ingest queue, both living on Vinayaka.
   *
   *  Vinayaka holds the books and the GPU, so rendering and reading a book
   *  belongs there; this box stays free to serve classes and scans. The book
   *  host binds 127.0.0.1 only and does NO auth of its own — reachable solely
   *  through the reverse tunnel, with the session check and ownership enforced
   *  HERE. Copyrighted books must never be reachable without going through it.
   */
  private async bookHost(path: string, init?: any): Promise<any> {
    const r = await fetch(`http://127.0.0.1:8791${path}`, {
      ...init,
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) throw new ServiceUnavailableException("book host unavailable");
    return r.json();
  }

  @Get("library/catalogue")
  async catalogue(@Req() req: any) {
    const uid = this.requireUser(req);
    if (uid !== LIBRARY_OWNER) throw new NotFoundException("no library");
    return this.bookHost("/catalogue");
  }

  @Get("library/queue")
  async queue(@Req() req: any) {
    const uid = this.requireUser(req);
    if (uid !== LIBRARY_OWNER) throw new NotFoundException("no library");
    return this.bookHost("/queue");
  }

  @Post("library/queue")
  async enqueue(@Body() body: { ids?: string[] }, @Req() req: any) {
    const uid = this.requireUser(req);
    if (uid !== LIBRARY_OWNER) throw new NotFoundException("no library");
    const ids = Array.isArray(body?.ids) ? body.ids.slice(0, 50) : [];
    if (!ids.length) throw new BadRequestException("no books chosen");
    return this.bookHost("/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
  }

  @Get(":id")
  async detail(@Param("id") id: string, @Req() req: any, @Res({ passthrough: true }) res?: any) {
    // NEVER cache this. Diagrams change under the reader — a coach corrects a
    // position, a de-duplication pass removes phantom entries — and a browser
    // reusing an old body shows positions the book no longer has. Owner saw
    // exactly that: "SAME 14, 15 HIGHLIGHT SAME POSITION" persisting after the
    // duplicates were already gone from disk. The page IMAGES are still cached
    // hard, because those really are immutable once rendered.
    res?.setHeader?.("Cache-Control", "no-store");
    const uid = this.requireUser(req);
    const dir = bookDir(id);
    if (!existsSync(dir)) return this.remoteDetail(id, uid);
    const meta = readJson<any>(join(dir, "meta.json"), {});
    if (meta.owner !== uid) throw new NotFoundException("book not found");
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
      diagrams: diagrams.map((d, i) => ({ n: i + 1, key: diagramKey(d), ...d })),
    };
  }

  /** One book, read on Vinayaka and served through here.
   *
   *  Same response as a local book, so the reader cannot tell the difference —
   *  which is the point: the page images stay on the machine that made them
   *  instead of being copied to a second store that can drift out of step. */
  private async remoteDetail(id: string, uid: string) {
    let meta: any, status: any, diagrams: any[];
    try {
      [meta, status, diagrams] = await Promise.all([
        this.bookHost(`/book/${encodeURIComponent(id)}/meta`),
        this.bookHost(`/book/${encodeURIComponent(id)}/status`),
        this.bookHost(`/book/${encodeURIComponent(id)}/diagrams`),
      ]);
    } catch {
      throw new NotFoundException("book not found");
    }
    if (!meta || meta.owner !== uid) throw new NotFoundException("book not found");
    return {
      id,
      title: meta.title || id,
      pages: status?.pages ?? 0,
      state: status?.state ?? "unknown",
      done: status?.done ?? 0,
      seconds: status?.seconds ?? null,
      remote: true,
      diagrams: (diagrams ?? []).map((d: any, i: number) => ({
        n: i + 1, key: diagramKey(d), ...d,
        // The ingest writes modelConf; the reader reads conf. Without this the
        // confidence highlight is blank on every remotely-read book.
        conf: d.conf ?? d.modelConf ?? null,
      })),
    };
  }

  /** Is this remote book mine? Checked before every remote page is served. */
  private async remoteOwns(id: string, uid: string): Promise<boolean> {
    try {
      const meta = await this.bookHost(`/book/${encodeURIComponent(id)}/meta`);
      return !!meta && meta.owner === uid;
    } catch {
      return false;
    }
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
  async correct(@Param("id") id: string, @Param("n") n: string,
          @Body() body: { fen?: string; action?: "correct" | "confirm" | "reject" },
          @Req() req: any) {
    const uid = this.requireUser(req);
    const dir = bookDir(id);
    const isRemote = !existsSync(dir);
    if (!isRemote) {
      const meta = readJson<any>(join(dir, "meta.json"), {});
      if (meta.owner !== uid) throw new NotFoundException("book not found");
    }

    const action = body?.action === "reject" ? "reject"
                 : body?.action === "confirm" ? "confirm" : "correct";
    const fen = String(body?.fen || "").trim();
    // Board field only: 8 ranks of pieces and run-lengths. Anything else is a
    // client bug or someone poking at the endpoint.
    const board = fen.split(" ")[0] || "";
    // A rejection says "this is not a board at all", so it carries no position
    // to validate — that is the whole point of the action.
    if (action !== "reject"
        && !/^([1-8pnbrqkPNBRQK]+\/){7}[1-8pnbrqkPNBRQK]+$/.test(board)) {
      throw new BadRequestException("not a board position");
    }
    const idx = Number(n) - 1;             // the reader numbers them from 1
    if (isRemote) {
      // The book lives on Vinayaka, so the correction belongs beside it. Written
      // here it would land next to a book that does not exist on this box and be
      // silently lost — and a coach's fix is the best label the model ever gets.
      if (!(await this.remoteOwns(id, uid))) throw new NotFoundException("book not found");
      try {
        return await this.bookHost(
          `/book/${encodeURIComponent(id)}/diagram/${idx + 1}`,
          { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fen, action, by: uid }) });
      } catch {
        throw new ServiceUnavailableException("could not save — the book host is not reachable");
      }
    }
    const diagrams = readJson<Diagram[]>(join(dir, "diagrams.json"), []);
    if (!Number.isInteger(idx) || idx < 0 || idx >= diagrams.length) {
      throw new NotFoundException("diagram not found");
    }
    const before = diagrams[idx] as Diagram;
    const wasFen = String(before?.fen ?? "");
    const key = diagramKey(before);
    if (action === "reject") {
      // Not a board. Drop it from the reader, and keep the region on record —
      // a rejected crop is a NEGATIVE example for the extractor, which is a
      // different model from the one that reads the squares.
      diagrams.splice(idx, 1);
    } else {
      diagrams[idx] = { ...before, fen, conf: 1, corrected: action === "correct" } as Diagram;
    }
    try {
      writeFileSync(join(dir, "diagrams.json"), JSON.stringify(diagrams));
      appendFileSync(join(dir, "corrections.jsonl"),
        JSON.stringify({ key, action, n: idx + 1, page: before?.page,
                         bbox: before?.bbox ?? null, was: wasFen,
                         now: action === "reject" ? null : fen,
                         by: uid, at: new Date().toISOString() }) + "\n");
    } catch (e: any) {
      // Say WHY. A book ingested by the wrong unix user is readable but not
      // writable by the API, and the coach saw only "Save failed" while the
      // real cause — EACCES on diagrams.json — sat in a log they cannot read.
      const code = e?.code === "EACCES" || e?.code === "EPERM"
        ? "this book is not writable by the server — its files were created by a different user"
        : `could not write the correction (${e?.code || "unknown error"})`;
      throw new ServiceUnavailableException(code);
    }
    return { ok: true, key, action, n: idx + 1, was: wasFen,
             now: action === "reject" ? null : fen };
  }

  @Get(":id/page/:n")
  async page(@Param("id") id: string, @Param("n") n: string, @Req() req: any, @Res() res: any) {
    const uid = this.requireUser(req);
    const dir = bookDir(id);
    const idx = Number(n);
    if (!Number.isInteger(idx) || idx < 0 || idx > 9999) throw new NotFoundException("page not found");
    if (!existsSync(dir)) return this.remotePage(id, idx, uid, res);
    const meta = readJson<any>(join(dir, "meta.json"), {});
    if (meta.owner !== uid) throw new NotFoundException("page not found");
    const file = join(dir, "pages", `p${String(idx).padStart(4, "0")}.jpg`);
    if (!existsSync(file)) throw new NotFoundException("page not found");
    // Page images never change once ingested, so let the browser keep them —
    // this is what makes scrolling a book feel like a book.
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "private, max-age=86400");
    createReadStream(file).pipe(res);
  }

  /** A page image held on Vinayaka, passed through with the session checked.
   *
   *  The book host answers anything that reaches it, so the ownership check
   *  here is the ONLY thing standing between a signed-in stranger and someone
   *  else's copyrighted book. It runs before a single byte is fetched. */
  private async remotePage(id: string, idx: number, uid: string, res: any) {
    if (!(await this.remoteOwns(id, uid))) throw new NotFoundException("page not found");
    let r: Response;
    try {
      r = await fetch(
        `http://127.0.0.1:8791/book/${encodeURIComponent(id)}/page/${idx}`,
        { signal: AbortSignal.timeout(30_000) },
      );
    } catch {
      throw new ServiceUnavailableException("the book host is not reachable");
    }
    if (!r.ok) throw new NotFoundException("page not found");
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Content-Length", String(buf.length));
    // Same as a local page: once rendered it never changes, and this is what
    // makes turning a page feel like a book rather than a network round trip.
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.end(buf);
  }
}
