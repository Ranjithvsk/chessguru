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
import { Body, Controller, ForbiddenException, Get, Logger, Param, Post, Query, Req, Res, BadRequestException, NotFoundException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** Who may open this book.
 *
 *  One stored copy can now belong to several coaches. When two of them upload
 *  the same file we keep ONE copy and list them both here, rather than storing
 *  and re-rendering 28 MB and 260 pages a second time (Guna Chess did exactly
 *  that with the Sharpest Sicilian, twice in six minutes).
 *
 *  This is dedup of STORAGE only — a coach still has to upload a book to get it.
 *  Nobody gains access to a book they did not bring themselves, which is what
 *  keeps a private shelf from turning into a shared library of other people's
 *  copyrighted PDFs.
 *
 *  FAILS CLOSED: no owner recorded => nobody owns it => it is not listed or
 *  served. A missing meta.owner used to make a book visible to everyone. */
const ownsBook = (meta: any, uid: string): boolean =>
  !!uid && (meta?.owner === uid || (Array.isArray(meta?.owners) && meta.owners.includes(uid)));

const STORE = "/var/lib/chessguru/user-books";
// Whose Drive the book host is pointed at. One library, one owner —
// these are copyrighted books belonging to a specific person.
const LIBRARY_OWNER = process.env.CHESSGURU_LIBRARY_OWNER ?? "ranjith_vsk";

// The local vision service (France, always-on) renders a PDF's pages and
// extracts its diagrams straight into STORE/<id>/, reporting through
// GET /book/status/<id>. This is what lets a coach's uploaded book live on
// France and be readable in seconds, instead of depending on the owner's PC
// (the Vinayaka book host) being awake. Rendering needs no GPU — only the
// diagram/position pass does, and that streams in as it completes.
const VISION_URL = process.env.CHESSGURU_VISION_URL ?? "http://127.0.0.1:5100";

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

/** How many DIFFERENT coaches vouch for each position, from corrections.jsonl.
 *
 *  One stored copy is now read by several coaches, and their corrections land in
 *  the same book. That is the point — a position three coaches independently
 *  agree on is worth more than one the extractor guessed at 0.46 confidence, and
 *  the reader should be able to say so.
 *
 *  Counted by DISTINCT user, latest verdict each. Guna Chess confirmed the same
 *  diagram twice within four seconds (a double-click on p8 of Mastering
 *  Checkmates); that is one coach agreeing, not two, and counting the lines
 *  instead of the people would have read as consensus that does not exist.
 *
 *  A coach whose latest verdict differs from the FEN the book currently holds is
 *  a DISAGREEMENT, which is the signal actually worth surfacing: two people who
 *  looked at the same board and read it differently. */
type Verdict = { agree: Set<string>; disagree: Set<string>; rejected: Set<string>; lastBy?: string; lastAt?: string };
function readConsensus(dir: string): Map<string, Verdict> {
  const out = new Map<string, Verdict>();
  const raw = ((): string => { try { return readFileSync(join(dir, "corrections.jsonl"), "utf8"); } catch { return ""; } })();
  if (!raw) return out;
  // Latest verdict per (key, user) — a coach may revisit a board and change their mind.
  const latest = new Map<string, any>();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let r: any; try { r = JSON.parse(line); } catch { continue; }
    if (!r?.key || !r?.by) continue;
    const prev = latest.get(`${r.key}|${r.by}`);
    if (!prev || String(r.at ?? "") >= String(prev.at ?? "")) latest.set(`${r.key}|${r.by}`, r);
  }
  for (const r of latest.values()) {
    const v = out.get(r.key) ?? { agree: new Set<string>(), disagree: new Set<string>(), rejected: new Set<string>() };
    if (r.action === "reject") v.rejected.add(r.by);
    else v.agree.add(r.by);           // resolved against the live FEN by the caller
    if (!v.lastAt || String(r.at ?? "") >= v.lastAt) { v.lastAt = r.at; v.lastBy = r.by; }
    // Remember what each coach actually settled on, so the caller can compare it
    // with the FEN the book holds now.
    (v as any).fens = (v as any).fens ?? new Map<string, string>();
    (v as any).fens.set(r.by, r.action === "reject" ? "" : String(r.now ?? ""));
    out.set(r.key, v);
  }
  return out;
}

/** The review state of one diagram, as a coach should read it. */
function reviewOf(v: Verdict | undefined, currentFen: string): {
  agreeCount: number; disagreeCount: number; rejectedCount: number;
  reviewers: number; disputed: boolean; lastBy?: string; lastAt?: string;
} | null {
  if (!v) return null;
  const fens: Map<string, string> = (v as any).fens ?? new Map();
  const agree = new Set<string>(), disagree = new Set<string>();
  for (const [by, fen] of fens) {
    if (v.rejected.has(by)) continue;
    // Compare the board only — side-to-move and clocks are not what a coach fixed.
    if ((fen || "").split(" ")[0] === (currentFen || "").split(" ")[0]) agree.add(by);
    else disagree.add(by);
  }
  return {
    agreeCount: agree.size, disagreeCount: disagree.size, rejectedCount: v.rejected.size,
    reviewers: new Set([...agree, ...disagree, ...v.rejected]).size,
    disputed: disagree.size > 0 || (v.rejected.size > 0 && agree.size > 0),
    lastBy: v.lastBy, lastAt: v.lastAt,
  };
}

// Where each reader left off. Kept OUTSIDE the book directories on purpose: a book
// dir IS the book — pages, diagrams, meta — and is the same for everyone who can
// open it, while "which page was I on" belongs to one person. Keeping it separate
// also means it works for remote (Vinayaka-hosted) books, which have no local dir
// at all, and a re-ingest that rewrites a book dir cannot wipe anyone's place.
//
// The listing at GET / fails closed on a missing meta.owner, so this directory
// never shows up as a book.
const PROGRESS_DIR = join(STORE, "_progress");

function progressPath(uid: string): string {
  // A user id reaches us from the session, but it still becomes a FILENAME here.
  const safe = String(uid).replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 64) || "_";
  return join(PROGRESS_DIR, `${safe}.json`);
}

function readProgress(uid: string): Record<string, number> {
  return readJson<Record<string, number>>(progressPath(uid), {});
}

function writeProgress(uid: string, bookId: string, page: number): void {
  mkdirSync(PROGRESS_DIR, { recursive: true });
  const all = readProgress(uid);
  all[bookId] = page;
  writeFileSync(progressPath(uid), JSON.stringify(all));
}

/** The page to open at: where they left off, clamped in case the book has since
 *  been re-ingested shorter. 0 for a book never opened. */
function resumePage(uid: string, bookId: string, pages: number): number {
  const saved = readProgress(uid)[bookId];
  if (!Number.isInteger(saved) || saved! < 0) return 0;
  if (Number.isInteger(pages) && pages > 0) return Math.min(saved!, pages - 1);
  return saved!;
}

@Controller("user-books")
export class UserBooksController {
  private readonly log = new Logger("user-books");
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
      // Own books only, and FAIL CLOSED. This used to treat a missing owner as
      // "shared seed content", which meant every book without one was visible to
      // any signed-in coach or student — including a coach's own copyrighted
      // library. These are books someone owns a copy of; we are giving them a
      // better way to read it, not publishing it.
      //
      // Filtered on the META, before mapping: one stored copy can belong to
      // several coaches now, and the full owners list must never leave this box —
      // a coach has no business knowing who else uploaded the same book.
      .filter((id) => ownsBook(readJson<any>(join(STORE, id, "meta.json"), {}), uid))
      .map((id) => {
        const dir = join(STORE, id);
        const meta = readJson<any>(join(dir, "meta.json"), {});
        const status = readJson<any>(join(dir, "status.json"), {});
        const diagrams = readJson<Diagram[]>(join(dir, "diagrams.json"), []);
        return {
          id,
          title: meta.title || id,
          owner: uid,
          coverPage: Number.isInteger(meta.coverPage) ? meta.coverPage : 0,
          pages: status.pages ?? 0,
          diagrams: diagrams.length,
          state: status.state ?? "unknown",
          done: status.done ?? 0,
          // Only one book renders at a time across the whole academy, so a queued
          // book needs to say where it is in line and roughly how long — a coach
          // who can see "3rd, about 25 minutes" does not re-upload, which is how
          // the same Sicilian ended up rendering twice.
          queuePosition: status.queuePosition ?? null,
          etaSeconds: status.etaSeconds ?? null,
          etaReadyAt: status.etaReadyAt ?? null,
        };
      });
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
        .map((b: any) => ({ ...b, coverPage: b.coverPage ?? 0, remote: true }));
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
    if (!ownsBook(meta, uid)) throw new NotFoundException("book not found");
    const status = readJson<any>(join(dir, "status.json"), {});
    const diagrams = readJson<Diagram[]>(join(dir, "diagrams.json"), []);
    return {
      id,
      title: meta.title || id,
      pages: status.pages ?? 0,
      state: status.state ?? "unknown",
      done: status.done ?? 0,
      seconds: status.seconds ?? null,
      queuePosition: status.queuePosition ?? null,
      etaSeconds: status.etaSeconds ?? null,
      etaReadyAt: status.etaReadyAt ?? null,
      // Numbered in reading order so the reader can label them "position 12"
      // the way the book labels its problems.
      analysis: readJson<Record<string, any>>(join(dir, "analysis.json"), {}),
      // Each position carries how many DIFFERENT coaches have vouched for it, so
      // the reader can put the well-reviewed ones forward and flag the ones two
      // coaches read differently.
      diagrams: (() => {
        const consensus = readConsensus(dir);
        return diagrams.map((d, i) => {
          const key = diagramKey(d);
          return { n: i + 1, key, ...d, review: reviewOf(consensus.get(key), String(d.fen ?? "")) };
        });
      })(),
      lastPage: resumePage(uid, id, status.pages ?? 0),
      // Book-level review quality: how much of this book has actually been
      // looked at by a human, and where coaches disagree with each other.
      review: (() => {
        const c = readConsensus(dir);
        let reviewed = 0, multi = 0, disputed = 0;
        const people = new Set<string>();
        for (const d of diagrams) {
          const r = reviewOf(c.get(diagramKey(d)), String(d.fen ?? ""));
          if (!r) continue;
          reviewed++;
          if (r.reviewers > 1) multi++;
          if (r.disputed) disputed++;
        }
        for (const v of c.values()) for (const by of [...v.agree, ...v.rejected]) people.add(by);
        return { positions: diagrams.length, reviewed, byTwoOrMore: multi, disputed, coaches: people.size };
      })(),
    };
  }

  /** Remember where the reader got to. Reopening a book used to start at page 1
   *  every time, which on a 400-page endgame manual means finding your place by
   *  hand on every visit. Best-effort by design: a failed save must never block
   *  turning a page, so the client fires and forgets. */
  @Post(":id/progress")
  async saveProgress(@Param("id") id: string, @Req() req: any, @Body() body: { page?: number }) {
    const uid = this.requireUser(req);
    const n = Number(body?.page);
    if (!Number.isFinite(n) || n < 0) throw new BadRequestException("page must be a non-negative number");
    writeProgress(uid, id, Math.floor(n));
    return { ok: true, page: Math.floor(n) };
  }

  /** One book, read on Vinayaka and served through here.
   *
   *  Same response as a local book, so the reader cannot tell the difference —
   *  which is the point: the page images stay on the machine that made them
   *  instead of being copied to a second store that can drift out of step. */
  private async remoteDetail(id: string, uid: string) {
    let meta: any, status: any, diagrams: any[], analysis: any;
    try {
      [meta, status, diagrams, analysis] = await Promise.all([
        this.bookHost(`/book/${encodeURIComponent(id)}/meta`),
        this.bookHost(`/book/${encodeURIComponent(id)}/status`),
        this.bookHost(`/book/${encodeURIComponent(id)}/diagrams`),
        this.bookHost(`/book/${encodeURIComponent(id)}/analysis`).catch(() => ({})),
      ]);
    } catch {
      throw new NotFoundException("book not found");
    }
    if (!meta || !ownsBook(meta, uid)) throw new NotFoundException("book not found");
    return {
      id,
      title: meta.title || id,
      pages: status?.pages ?? 0,
      state: status?.state ?? "unknown",
      done: status?.done ?? 0,
      seconds: status?.seconds ?? null,
      remote: true,
      // Progress is stored locally for remote books too — they have no dir here.
      lastPage: resumePage(uid, id, status?.pages ?? 0),
      analysis: analysis ?? {},
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
      return !!meta && ownsBook(meta, uid);
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
      if (!ownsBook(meta, uid)) throw new NotFoundException("book not found");
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

  /** Choose which page the shelf shows as the cover.
   *
   *  Page 0 is usually the front cover, but not always: one scan opens on a
   *  nearly blank half-title, another on a two-page spread. Rather than guess
   *  harder, let the owner point at the right page. */
  @Post(":id/cover")
  async setCover(@Param("id") id: string, @Body() body: { page?: number }, @Req() req: any) {
    const uid = this.requireUser(req);
    const page = Number(body?.page);
    if (!Number.isInteger(page) || page < 0 || page > 9999) {
      throw new BadRequestException("page must be a page number in this book");
    }
    const dir = bookDir(id);
    if (!existsSync(dir)) {
      // Held on Vinayaka: the choice belongs next to the book, like corrections.
      if (!(await this.remoteOwns(id, uid))) throw new NotFoundException("book not found");
      try {
        return await this.bookHost(`/book/${encodeURIComponent(id)}/cover`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ page }),
        });
      } catch {
        throw new ServiceUnavailableException("could not save — the book host is not reachable");
      }
    }
    const metaPath = join(dir, "meta.json");
    const meta = readJson<any>(metaPath, {});
    if (!ownsBook(meta, uid)) throw new NotFoundException("book not found");
    try {
      writeFileSync(metaPath, JSON.stringify({ ...meta, coverPage: page }));
    } catch (e: any) {
      throw new ServiceUnavailableException(
        e?.code === "EACCES" || e?.code === "EPERM"
          ? "this book is not writable by the server — its files were created by a different user"
          : `could not save the cover (${e?.code || "unknown error"})`);
    }
    return { ok: true, coverPage: page };
  }

  /** The book's own table of contents, when the PDF carries one. */
  @Get(":id/toc")
  async toc(@Param("id") id: string, @Req() req: any) {
    const uid = this.requireUser(req);
    if (!(await this.ownsBook(id, uid))) throw new NotFoundException("book not found");
    try {
      return await this.bookHost(`/book/${encodeURIComponent(id)}/toc`);
    } catch { return { toc: [] }; }
  }

  /** Full-text search across one book. */
  @Get(":id/search")
  async search(@Param("id") id: string, @Query("q") q: string, @Req() req: any) {
    const uid = this.requireUser(req);
    if (!(await this.ownsBook(id, uid))) throw new NotFoundException("book not found");
    const needle = String(q ?? "").trim();
    if (needle.length < 2) return { hits: [] };
    try {
      return await this.bookHost(
        `/book/${encodeURIComponent(id)}/search?q=${encodeURIComponent(needle)}`);
    } catch { return { hits: [] }; }
  }

  /** Is this book mine, wherever it is held? */
  private async ownsBook(id: string, uid: string): Promise<boolean> {
    const dir = bookDir(id);
    if (existsSync(dir)) {
      return ownsBook(readJson<any>(join(dir, "meta.json"), {}), uid);
    }
    return this.remoteOwns(id, uid);
  }

  /** Lines worked out on a position, saved beside the book.
   *
   *  Keyed by the diagram's stable page-plus-centre key rather than its index:
   *  a de-duplication pass renumbers diagrams, and index-keyed notes then point
   *  at the wrong board — which has already happened once with corrections. */
  @Post(":id/diagram/:n/analysis")
  async saveAnalysis(@Param("id") id: string, @Param("n") n: string,
                     @Body() body: { tree?: unknown; startFen?: string }, @Req() req: any) {
    const uid = this.requireUser(req);
    const idx = Number(n) - 1;
    if (!Number.isInteger(idx) || idx < 0) throw new BadRequestException("bad diagram");
    const tree = Array.isArray(body?.tree) ? body.tree : null;
    const dir = bookDir(id);

    if (!existsSync(dir)) {
      if (!(await this.remoteOwns(id, uid))) throw new NotFoundException("book not found");
      const dg = await this.bookHost(`/book/${encodeURIComponent(id)}/diagrams`);
      const d = (dg ?? [])[idx];
      if (!d) throw new NotFoundException("diagram not found");
      try {
        return await this.bookHost(
          `/book/${encodeURIComponent(id)}/analysis/${encodeURIComponent(diagramKey(d))}`,
          { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tree, startFen: body?.startFen ?? "", by: uid }) });
      } catch {
        throw new ServiceUnavailableException("could not save — the book host is not reachable");
      }
    }

    const meta = readJson<any>(join(dir, "meta.json"), {});
    if (!ownsBook(meta, uid)) throw new NotFoundException("book not found");
    const diagrams = readJson<Diagram[]>(join(dir, "diagrams.json"), []);
    const d = diagrams[idx];
    if (!d) throw new NotFoundException("diagram not found");
    const key = diagramKey(d);
    const path = join(dir, "analysis.json");
    const all = readJson<Record<string, any>>(path, {});
    if (!tree || !tree.length) delete all[key];
    else all[key] = { tree, startFen: body?.startFen ?? "", by: uid, at: new Date().toISOString() };
    try {
      writeFileSync(path, JSON.stringify(all));
    } catch (e: any) {
      throw new ServiceUnavailableException(
        e?.code === "EACCES" || e?.code === "EPERM"
          ? "this book is not writable by the server — its files were created by a different user"
          : `could not save (${e?.code || "unknown error"})`);
    }
    return { ok: true, key, saved: !!(tree && tree.length) };
  }

  /** A coach uploading their own book.
   *
   *  Checks the library FIRST. If we already have the book, the useful answer
   *  is the one we have already read — with its pages and positions — not a
   *  second copy of the same PDF sitting in the queue for fifteen minutes.
   *  Matching is on the cleaned title, so the same book uploaded under a
   *  dump-site filename still matches.
   *
   *  Coaches only: reading a book costs GPU time on a shared machine, and the
   *  library is one person's copyrighted collection.
   */
  @Post("upload")
  async upload(@Query("title") title: string, @Req() req: any) {
    const uid = this.requireUser(req);
    const role = String(req?.session?.role ?? "");
    if (role !== "coach" && role !== "academy_owner") {
      throw new ForbiddenException("only coaches can add books");
    }
    const name = String(title ?? "").trim();
    // Say WHY an upload was refused, in the log as well as to the browser. A
    // coach reports "it failed" and the reason is gone: a 400 leaves no trace on
    // this box, so the same guessing starts over every time. Guna Chess hit this
    // twice in one morning — first nginx capping the body at 20M, then a refusal
    // here that could not be told apart from it without asking them to read the
    // screen back.
    const ctype = String(req?.headers?.["content-type"] ?? "");
    const clen = String(req?.headers?.["content-length"] ?? "?");
    const refuse: (why: string) => never = (why) => {
      this.log.warn(
        `upload refused for ${uid}: ${why} — title=${JSON.stringify(name)} ` +
        `content-type=${JSON.stringify(ctype)} content-length=${clen} ` +
        `bytes=${Buffer.isBuffer(req?.body) ? req.body.length : "not a buffer"}`);
      throw new BadRequestException(why);
    };
    if (!name) refuse("the book needs a title");
    const body: Buffer | undefined = req?.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      refuse(ctype.toLowerCase().includes("pdf")
        ? "no file received — the file may still be downloading from iCloud or Drive; open it once, then try again"
        : `no file received (the browser sent content-type ${ctype || "none"})`);
    }
    if (!body.subarray(0, 4).toString("latin1").startsWith("%PDF")) {
      const head = body.subarray(0, 16).toString("latin1").replace(/[^\x20-\x7e]/g, ".");
      refuse(`that file is not a PDF — it starts "${head}". Download sites often hand you a web page named like a PDF.`);
    }

    // Best-effort dedup against the owner's Drive library on Vinayaka. If the PC
    // is asleep we simply SKIP it and store locally — an upload must never fail
    // because a remote box is down. This check used to THROW "the library is not
    // reachable right now" and blocked every upload the moment Vinayaka went
    // offline; that outage is the reason for this rewrite.
    try {
      const r = await this.bookHost("/library/match", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: name, mb: body.length / 1e6 }),
      });
      if (r?.match) return { ok: true, alreadyHave: true, book: r.match };
    } catch { /* Vinayaka down/slow — fall through to a France-local upload */ }

    // Do we already hold this exact file? Then don't store it twice — just put
    // the coach's name on the copy we have and hand it straight back, already
    // rendered, already carrying its positions.
    //
    // Guna Chess uploaded "The Sharpest Sicilian" twice six minutes apart on
    // 18 Sep 2026 — the same 28 MB file byte for byte, the browser having named
    // the second one "(1)". Nothing objected, so the box rendered 260 pages of
    // it a SECOND time, competing for the CPU that runs live classes.
    //
    // Matched on sha256 ONLY. A same-titled but different file is a different
    // scan and gets its own copy — merging those would give a coach a book they
    // did not upload. No message is shown either way: from where the coach sits
    // the book simply appears, which is what they wanted anyway.
    const existing = this.findStoredCopy(body);
    if (existing) {
      const linked = this.addOwner(existing.id, uid);
      this.log.log(`linked ${uid} to existing copy ${existing.id} instead of a second render — title=${JSON.stringify(name)}`);
      return {
        ok: true, alreadyHave: true, local: true, linked: true,
        book: {
          id: existing.id, title: existing.meta.title || existing.id, owner: uid, by: uid,
          state: linked.state, pages: linked.pages, diagrams: linked.diagrams,
        },
      };
    }

    // Store + ingest on France (always-on). The PDF lives here; the local vision
    // service renders its pages and extracts positions straight into the same
    // store the reader already serves from. The book is readable as soon as its
    // pages render — no GPU box in the loop for reading.
    const id = this.freshBookId(name);
    const dir = bookDir(id);
    const pdfPath = join(dir, "book.pdf");
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(pdfPath, body);
      // meta.json carries OWNERSHIP. The ingest never writes it, and the shelf
      // hides any book whose meta.owner !== the viewer — so without this the
      // coach would upload a book they then couldn't see. Written before ingest
      // so it's ours from the very first status poll.
      writeFileSync(join(dir, "meta.json"), JSON.stringify({
        title: name, owner: uid, coverPage: 0,
        source: "france-upload", uploadedAt: new Date().toISOString(),
        // Content fingerprint so the NEXT upload of this same file is caught
        // without re-reading every PDF on disk.
        sha256: sha256(body), bytes: body.length,
      }));
    } catch (e: any) {
      throw new ServiceUnavailableException(
        `could not save the book (${e?.code || "write failed"})`);
    }

    // Kick off render + diagram extraction on France. The service starts a
    // background thread and returns immediately, reporting through status.json
    // (which the reader polls via GET /:id). If it's momentarily unreachable the
    // file is safely stored and shows as "queued" — re-uploading re-triggers it.
    let started = false;
    try {
      const r = await fetch(`${VISION_URL}/book/ingest`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ book_id: id, pdf_path: pdfPath }),
        signal: AbortSignal.timeout(20_000),
      });
      started = r.ok;
    } catch { /* stored anyway; the reader will show it as queued */ }
    if (!started) {
      try {
        writeFileSync(join(dir, "status.json"),
          JSON.stringify({ state: "queued", pages: 0, done: 0 }));
      } catch { /* ignore */ }
    }
    return {
      ok: true, alreadyHave: false, local: true,
      book: { id, title: name, owner: uid, by: uid,
              state: started ? "rendering" : "queued" },
    };
  }

  /** A fresh, traversal-safe book id derived from the title, unique in the
   *  store. Slug only — the read paths resolve it under STORE and reject any id
   *  that would escape, so an id is always a single safe path segment. */
  /** The stored copy of this exact file, whoever first uploaded it.
   *
   *  sha256 only — a re-upload survives the browser renaming it "(1)", which is
   *  exactly how the Sharpest Sicilian got in twice. Title is deliberately NOT
   *  matched: a same-titled but different file is a different scan and deserves
   *  its own copy, and merging on title would hand a coach a book they never
   *  uploaded.
   *
   *  Books stored before fingerprinting are hashed once, lazily, and the result
   *  written back into meta.json, so this never re-reads every PDF on disk. */
  private findStoredCopy(body: Buffer): { id: string; meta: any } | null {
    const hash = sha256(body);
    if (!existsSync(STORE)) return null;
    for (const id of readdirSync(STORE)) {
      const dir = join(STORE, id);
      const metaPath = join(dir, "meta.json");
      if (!existsSync(metaPath)) continue;
      const meta = readJson<any>(metaPath, {});
      let known: string | null = typeof meta.sha256 === "string" ? meta.sha256 : null;
      if (!known) {
        const pdf = join(dir, "book.pdf");
        if (!existsSync(pdf)) continue;
        try {
          known = sha256(readFileSync(pdf));
          writeFileSync(metaPath, JSON.stringify({ ...meta, sha256: known, bytes: statSync(pdf).size }));
        } catch { continue; }
      }
      if (known === hash) return { id, meta };
    }
    return null;
  }

  /** Add a coach to a stored book's owners, and report what they are getting.
   *
   *  `owner` (the original uploader) is left untouched so anything still reading
   *  that field keeps working; `owners` is the list ownsBook() actually honours. */
  private addOwner(id: string, uid: string): { state: string; pages: number; diagrams: number } {
    const dir = bookDir(id);
    const metaPath = join(dir, "meta.json");
    const meta = readJson<any>(metaPath, {});
    const owners: string[] = Array.isArray(meta.owners) ? meta.owners.slice() : [];
    if (meta.owner && !owners.includes(meta.owner)) owners.push(meta.owner);
    if (!owners.includes(uid)) owners.push(uid);
    try {
      writeFileSync(metaPath, JSON.stringify({ ...meta, owners }));
    } catch (e: any) {
      throw new ServiceUnavailableException(`could not add the book to your shelf (${e?.code || "write failed"})`);
    }
    const status = readJson<any>(join(dir, "status.json"), {});
    return {
      state: status.state ?? "unknown",
      pages: status.pages ?? 0,
      diagrams: readJson<Diagram[]>(join(dir, "diagrams.json"), []).length,
    };
  }

  private freshBookId(title: string): string {
    const base = title.toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "book";
    let id = base;
    for (let n = 2; existsSync(join(STORE, id)); n++) id = `${base}-${n}`;
    return id;
  }

  @Get(":id/page/:n")
  async page(@Param("id") id: string, @Param("n") n: string, @Req() req: any, @Res() res: any) {
    const uid = this.requireUser(req);
    const dir = bookDir(id);
    const idx = Number(n);
    if (!Number.isInteger(idx) || idx < 0 || idx > 9999) throw new NotFoundException("page not found");
    if (!existsSync(dir)) return this.remotePage(id, idx, uid, res);
    const meta = readJson<any>(join(dir, "meta.json"), {});
    if (!ownsBook(meta, uid)) throw new NotFoundException("page not found");
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
