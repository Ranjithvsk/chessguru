// Instagram Studio — turns what already happened inside ChessGuru into things
// worth posting. It invents nothing: every card below points at a real moment,
// a real rating move or a real puzzle, so a caption can never claim something
// the database does not hold.
//
// Owner-only (see OWNER_EMAIL). The board is drawn in the browser from the FEN
// we hand back, so nothing here renders images.
import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { promises as fs } from "fs";
import { join, basename } from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const run = promisify(execFile);
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";

/** Locked to one address, like the superadmin pages. Override per-environment. */
const OWNER_EMAIL = (process.env.INSTAGRAM_OWNER_EMAIL || "ranjith.vsk@gmail.com").toLowerCase();

/** Same shape as the coach/academy image dirs: files on disk, nginx serves them
 *  read-only at /instagram-media/, and every write goes through this service. */
const MEDIA_DIR = process.env.INSTAGRAM_MEDIA_DIR ?? "/home/ubuntu/chessguru-instagram-media";
const MEDIA_URL = "/instagram-media";

/** Backblaze B2 is where these files actually live. The local directory is only
 *  a cache so nginx can serve them fast — this box has repeatedly run its disk
 *  to zero, and losing the brand assets to that would be daft.
 *
 *  The app key is scoped to the dreamworld-backups bucket (it cannot create
 *  others), so the library lives under a prefix inside it. Credentials sit in
 *  /etc/rclone/chessguru.conf, root:ubuntu 0640 — readable by the API, not
 *  world, and outside the repo. */
const B2_REMOTE = process.env.INSTAGRAM_B2_REMOTE ?? "b2:dreamworld-backups/chessguru-instagram";
const RCLONE_CONFIG = process.env.INSTAGRAM_RCLONE_CONFIG ?? "/etc/rclone/chessguru.conf";
const RCLONE_ENV = { ...process.env, RCLONE_CONFIG };
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const MIME_EXT: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp", "image/gif": "gif",
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
};
const isVideoExt = (e: string) => e === "mp4" || e === "webm" || e === "mov";
/** A video's poster frame lives beside it as "<file>.poster.jpg". Same folder so
 *  nginx serves it with no extra route, and the suffix is excluded from the
 *  listing so a poster never shows up as a library item of its own. */
const POSTER_SUFFIX = ".poster.jpg";
const isPoster = (n: string) => n.endsWith(POSTER_SUFFIX);

export interface MediaItem {
  id: string;
  url: string;
  kind: "image" | "video";
  bytes: number;
  at: Date;
  /** Video only: a real frame from the clip. Without it a <video> tile is a
   *  black rectangle on iOS until it is touched. */
  poster: string | null;
  /** False while the copy to B2 is still in flight or has failed. The file is
   *  already on disk and serving either way — this only says whether the
   *  durable copy exists yet. */
  backedUp: boolean;
}

export interface PostCard {
  id: string;
  kind: "moment" | "climb" | "puzzle" | "leaderboard";
  /** Headline drawn on the image. */
  title: string;
  /** Second line on the image — the concrete detail that makes it true. */
  subtitle: string;
  /** Position to draw, and which way up. Null for cards with no board. */
  fen: string | null;
  orientation: "white" | "black";
  /** Square the move lands on, so the card can mark it. */
  highlight: string | null;
  caption: string;
  hashtags: string[];
  /** Where this came from, so the owner can check before posting. */
  sourceUrl: string | null;
  at: Date | null;
}

const TAGS_BASE = ["chess", "chessguru", "chessacademy", "chesstactics", "chesskids"];
const firstName = (s: string) => String(s || "").trim().split(/\s+/)[0] || s;

@Injectable()
export class InstagramService {
  constructor(@InjectConnection() private readonly conn: Connection) {}
  private col(name: string) { return this.conn.db!.collection(name); }

  /** Files written locally whose B2 copy has not been confirmed yet. Upload no
   *  longer waits for B2: the push costs ~4 s for a 31 MB video (1.1 s of that
   *  is just rclone starting and authenticating), and making the browser sit on
   *  "saving…" for it bought nothing — the file is on disk and nginx is already
   *  serving it. The copy happens right after the response, and the library
   *  shows which files are not backed up yet rather than pretending. */
  private pendingB2 = new Set<string>();
  /** syncDown is a network round-trip; doing it on every listing made the page
   *  feel slow for no gain, since nothing else writes to the bucket. */
  private lastSyncAt = 0;

  /** Throws unless the session belongs to the owner address. Checked against the
   *  user record rather than the session so a stale session cannot outlive a
   *  changed email. */
  private async ensureOwner(session: any): Promise<{ userId: string; email: string }> {
    const userId = session?.userId;
    if (!userId) throw new ForbiddenException("sign in first");
    const u: any = await this.col("users").findOne({ _id: userId as any }, { projection: { email: 1 } as any });
    const email = String(u?.email || "").toLowerCase();
    if (!email || email !== OWNER_EMAIL) throw new ForbiddenException("this page is not for this account");
    return { userId, email };
  }

  /** Is the signed-in account allowed in? Used by the page to decide whether to
   *  show the studio or the sign-in form — never as the only gate. */
  async whoami(session: any): Promise<{ ok: boolean; email: string | null }> {
    try { const { email } = await this.ensureOwner(session); return { ok: true, email }; }
    catch { return { ok: false, email: null }; }
  }

  async sources(session: any): Promise<{ ok: true; cards: PostCard[] }> {
    await this.ensureOwner(session);
    const hidden = await this.underReview();
    const cards = (await Promise.all([
      this.moments(hidden).catch(() => []),
      this.climbs(hidden).catch(() => []),
      this.puzzles().catch(() => []),
    ])).flat();
    cards.sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
    return { ok: true, cards };
  }

  /** Students the fair-play system distrusts. Their numbers must never become
   *  marketing: the biggest 30-day climb on this install belongs to an account
   *  the detector flagged, and "+2319 in a month" is exactly the post that would
   *  be embarrassing to have to walk back. Watch band counts too — a public post
   *  is not the place to be 50/50 about it. */
  private async underReview(): Promise<Set<string>> {
    const rows: any[] = await this.col("fairplay")
      .find({ $or: [{ hold: true }, { band: { $in: ["watch", "review"] } }] }, { projection: { _id: 1 } as any })
      .toArray();
    return new Set(rows.map((r) => String(r._id)));
  }

  /** The best tactical moments students actually found, newest first. */
  private async moments(hidden: Set<string>): Promise<PostCard[]> {
    const rows: any[] = await this.col("gameMotifEvents")
      .find({ found: true, points: { $gte: 3 }, userId: { $nin: Array.from(hidden) as any } }, { projection: { fen: 1, bestSan: 1, bestUci: 1, primary: 1, motifs: 1, points: 1, userId: 1, color: 1, at: 1, url: 1, label: 1 } as any })
      .sort({ at: -1 }).limit(40).toArray();
    if (!rows.length) return [];
    const names = await this.nameMap(rows.map((r) => String(r.userId)));
    return rows.map((r) => {
      const who = firstName(names.get(String(r.userId)) || String(r.userId));
      const motif = MOTIF_WORDS[r.primary] || "a tactic";
      const san = r.bestSan || r.bestUci || "";
      return {
        id: `moment:${r._id}`,
        kind: "moment" as const,
        title: `${who} found ${san}`,
        subtitle: motif,
        fen: r.fen || null,
        orientation: r.color === "black" ? "black" as const : "white" as const,
        highlight: typeof r.bestUci === "string" && r.bestUci.length >= 4 ? r.bestUci.slice(2, 4) : null,
        caption: `${who} found ${san} over the board — ${motif}.\n\nOne of ${TAGS_BASE.length ? "our" : "our"} students at ChessGuru. Spot it before you scroll. ♟️`,
        hashtags: [...TAGS_BASE, motifTag(r.primary)].filter(Boolean),
        sourceUrl: r.url || null,
        at: r.at ? new Date(r.at) : null,
      };
    });
  }

  /** Biggest puzzle-rating gains over the last 30 days — progress, not prodigies. */
  private async climbs(hidden: Set<string>): Promise<PostCard[]> {
    const since = new Date(Date.now() - 30 * 86400000);
    const rows: any[] = await this.col("rounds").aggregate([
      { $match: { k: "puzzle", d: { $gte: since }, rd: { $ne: 0 } } },
      { $group: { _id: { $arrayElemAt: [{ $split: ["$_id", ":"] }, 0] }, gain: { $sum: "$rd" }, n: { $sum: 1 }, last: { $max: "$d" }, endR: { $last: "$r" } } },
      { $match: { gain: { $gte: 60 }, n: { $gte: 20 }, _id: { $nin: Array.from(hidden) } } },
      // A huge gain on very few puzzles is not a success story, it is an
      // anomaly the fair-play window may not have caught yet. Require the
      // volume to justify the climb before it can be posted.
      { $match: { $expr: { $lte: ["$gain", { $multiply: ["$n", 12] }] } } },
      { $sort: { gain: -1 } }, { $limit: 8 },
    ]).toArray();
    if (!rows.length) return [];
    const names = await this.nameMap(rows.map((r) => String(r._id)));
    return rows.map((r) => {
      const who = firstName(names.get(String(r._id)) || String(r._id));
      const gain = Math.round(r.gain);
      return {
        id: `climb:${r._id}`,
        kind: "climb" as const,
        title: `${who} is up ${gain} points`,
        subtitle: `${r.n} puzzles in 30 days · now ${Math.round(r.endR || 0)}`,
        fen: null,
        orientation: "white" as const,
        highlight: null,
        caption: `+${gain} rating in a month, over ${r.n} puzzles.\n\nNo shortcuts — ${who} just kept showing up. That is the whole method. ♟️`,
        hashtags: [...TAGS_BASE, "chessimprovement", "chessprogress"],
        sourceUrl: null,
        at: r.last ? new Date(r.last) : null,
      };
    });
  }

  /** Hard puzzles from our own set — the "can you solve it" post. */
  private async puzzles(): Promise<PostCard[]> {
    const rows: any[] = await this.col("puzzles")
      .find({ "glicko.r": { $gte: 2200 }, themes: { $exists: true, $ne: [] } }, { projection: { fen: 1, glicko: 1, themes: 1, moves: 1 } as any })
      .sort({ plays: -1 }).limit(6).toArray();
    return rows.filter((p) => p.fen).map((p) => {
      const rating = Math.round(p?.glicko?.r ?? 0);
      const theme = (Array.isArray(p.themes) ? p.themes : []).find((t: string) => MOTIF_WORDS[t]) || "";
      // The side to move is the side being asked to find the move.
      const stm = String(p.fen).split(" ")[1] === "b" ? "black" as const : "white" as const;
      return {
        id: `puzzle:${p._id}`,
        kind: "puzzle" as const,
        title: "Can you find it?",
        subtitle: `${stm === "white" ? "White" : "Black"} to play · rated ${rating}`,
        fen: p.fen,
        orientation: stm,
        highlight: null,
        caption: `${stm === "white" ? "White" : "Black"} to play. Rated ${rating} — most players miss this one.\n\nAnswer in the comments, no engines. ♟️`,
        hashtags: [...TAGS_BASE, "chesspuzzle", "chessproblem", theme ? motifTag(theme) : ""].filter(Boolean),
        sourceUrl: `/puzzles?review=${encodeURIComponent(String(p._id))}`,
        at: null,
      };
    });
  }

  /* ── media library ──────────────────────────────────────────────────── */

  /** rclone, with the scoped config. Never throws — B2 being unreachable must
   *  degrade to "the local cache is what you see", not break the page. */
  private async rclone(args: string[], timeoutMs = 120_000): Promise<{ ok: boolean; out: string }> {
    try {
      const { stdout } = await run("rclone", ["--config", RCLONE_CONFIG, ...args], { env: RCLONE_ENV, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });
      return { ok: true, out: String(stdout || "") };
    } catch (e: any) {
      console.warn("[instagram] rclone failed:", args[0], String(e?.message || e).slice(0, 200));
      return { ok: false, out: "" };
    }
  }

  /** Pull anything in B2 that is not already cached locally. rclone skips files
   *  it already has, so this is cheap on every call and self-heals a cache that
   *  was wiped (or a box that was rebuilt). */
  private async syncDown(force = false): Promise<void> {
    await fs.mkdir(MEDIA_DIR, { recursive: true }).catch(() => {});
    if (!force && Date.now() - this.lastSyncAt < 60_000) return;
    this.lastSyncAt = Date.now();
    await this.rclone(["copy", B2_REMOTE, MEDIA_DIR, "--transfers", "4", "--ignore-existing"]);
  }

  /** One frame, one second in, scaled to 480 wide. Taken at 1 s rather than 0
   *  because the first frame of a generated clip is often black. Failure is not
   *  fatal — the tile just falls back to the bare <video>. */
  private async makePoster(videoName: string): Promise<boolean> {
    const src = join(MEDIA_DIR, videoName);
    const out = join(MEDIA_DIR, videoName + POSTER_SUFFIX);
    try {
      await run("ffmpeg", ["-nostdin", "-v", "error", "-ss", "1", "-i", src, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4", "-y", out], { timeout: 60_000 });
      const st = await fs.stat(out);
      if (st.size > 0) { void this.pushOne(videoName + POSTER_SUFFIX); return true; }
    } catch (e: any) {
      console.warn(`[instagram] poster failed for ${videoName}:`, String(e?.message || e).slice(0, 160));
    }
    return false;
  }

  /** Fire-and-forget copy of a single file to B2 (used for posters). */
  private async pushOne(name: string): Promise<void> {
    await this.rclone(["copyto", join(MEDIA_DIR, name), `${B2_REMOTE}/${name}`], 300_000);
  }

  /** Push one file to B2 after the response has gone out. Retries a couple of
   *  times, then leaves it marked pending so the library keeps saying so rather
   *  than quietly losing the durable copy. */
  private async pushToB2(name: string): Promise<void> {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const r = await this.rclone(["copyto", join(MEDIA_DIR, name), `${B2_REMOTE}/${name}`], 600_000);
      if (r.ok) { this.pendingB2.delete(name); return; }
      await new Promise((res) => setTimeout(res, attempt * 2000));
    }
    console.warn(`[instagram] ${name} is on disk but NOT in B2 after 3 attempts`);
  }

  /** Everything in the library, newest first. B2 holds the files; the local
   *  directory mirrors it for serving, so the listing reads from disk after a
   *  sync rather than paying a network round-trip per item. */
  async listMedia(session: any): Promise<{ ok: true; items: MediaItem[] }> {
    await this.ensureOwner(session);
    await this.syncDown();
    const names = await fs.readdir(MEDIA_DIR).catch(() => [] as string[]);
    const items: MediaItem[] = [];
    for (const n of names) {
      if (n.startsWith(".")) continue;
      const ext = (n.split(".").pop() || "").toLowerCase();
      // Only real media is ever listed — anything else in the folder is ignored
      // rather than shown as an unopenable tile.
      if (!Object.values(MIME_EXT).includes(ext)) continue;
      if (isPoster(n)) continue;   // a poster belongs to its video, not the grid
      const st = await fs.stat(join(MEDIA_DIR, n)).catch(() => null);
      if (!st?.isFile() || st.size === 0) continue;
      const video = isVideoExt(ext);
      let poster: string | null = null;
      if (video) {
        const pn = n + POSTER_SUFFIX;
        // Backfill: a video uploaded before posters existed (or whose poster
        // failed) gets one on first listing rather than staying a black tile.
        if (!names.includes(pn)) await this.makePoster(n).catch(() => null);
        if (await fs.stat(join(MEDIA_DIR, pn)).then((x) => x.size > 0).catch(() => false)) {
          poster = `${MEDIA_URL}/${encodeURIComponent(pn)}`;
        }
      }
      items.push({ id: n, url: `${MEDIA_URL}/${encodeURIComponent(n)}`, kind: video ? "video" : "image", bytes: st.size, at: st.mtime, backedUp: !this.pendingB2.has(n), poster });
    }
    items.sort((a, b) => b.at.getTime() - a.at.getTime());
    return { ok: true, items };
  }

  /** Raw-body upload, matching how coach images and books already arrive — a
   *  video is tens of megabytes and the multipart round-trip buys nothing.
   *  Written locally first so the page can show it immediately, then pushed to
   *  B2, which is the copy that has to survive. */
  async uploadMedia(session: any, rawName: string, buf: Buffer, contentType: string): Promise<{ ok: true; item: MediaItem }> {
    await this.ensureOwner(session);
    if (!Buffer.isBuffer(buf) || buf.byteLength === 0) throw new BadRequestException("empty body");
    const ct = String(contentType || "").toLowerCase().split(";")[0]?.trim() || "";
    const ext = MIME_EXT[ct];
    if (!ext) throw new BadRequestException("unsupported type — png, jpg, webp, gif, mp4, webm or mov");
    const cap = isVideoExt(ext) ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (buf.byteLength > cap) {
      throw new HttpException(`too large (max ${Math.round(cap / 1024 / 1024)} MB for a ${isVideoExt(ext) ? "video" : "image"})`, HttpStatus.PAYLOAD_TOO_LARGE);
    }
    // Filename is ours, never the client's: strip to a safe stem, then stamp it
    // so two uploads of "logo.png" cannot overwrite each other.
    const stem = basename(String(rawName || "upload")).replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 40) || "upload";
    const name = `${stem}-${Date.now()}.${ext}`;
    await fs.mkdir(MEDIA_DIR, { recursive: true }).catch(() => {});
    await fs.writeFile(join(MEDIA_DIR, name), buf);
    const st = await fs.stat(join(MEDIA_DIR, name));
    // Respond now; poster + backup happen immediately after. Not awaited.
    this.pendingB2.add(name);
    void this.pushToB2(name);
    if (isVideoExt(ext)) void this.makePoster(name);
    return {
      ok: true,
      item: { id: name, url: `${MEDIA_URL}/${encodeURIComponent(name)}`, kind: isVideoExt(ext) ? "video" : "image", bytes: st.size, at: st.mtime, backedUp: false, poster: null },
    };
  }

  /** Removes both copies. The B2 remote has hard_delete=false, so the object is
   *  hidden rather than destroyed and a mistaken delete is recoverable there. */
  async deleteMedia(session: any, id: string): Promise<{ ok: boolean; error?: string }> {
    await this.ensureOwner(session);
    // basename() alone is the path-traversal guard: whatever the caller sends,
    // only a bare filename inside MEDIA_DIR can ever be touched.
    const name = basename(String(id || ""));
    if (!name || name.startsWith(".")) return { ok: false, error: "bad id" };
    const ext = (name.split(".").pop() || "").toLowerCase();
    if (!Object.values(MIME_EXT).includes(ext)) return { ok: false, error: "bad id" };
    await fs.unlink(join(MEDIA_DIR, name)).catch(() => null);
    this.pendingB2.delete(name);
    await this.rclone(["deletefile", `${B2_REMOTE}/${name}`]);
    // Take the poster with it, both copies, or it lingers as an orphan.
    await fs.unlink(join(MEDIA_DIR, name + POSTER_SUFFIX)).catch(() => null);
    await this.rclone(["deletefile", `${B2_REMOTE}/${name}${POSTER_SUFFIX}`]);
    return { ok: true };
  }

  private async nameMap(ids: string[]): Promise<Map<string, string>> {
    const uniq = Array.from(new Set(ids));
    if (!uniq.length) return new Map();
    const us: any[] = await this.col("users").find({ _id: { $in: uniq as any } }, { projection: { name: 1, username: 1 } as any }).toArray();
    return new Map(us.map((u: any) => [String(u._id), String(u.name || u.username || u._id)]));
  }
}

/** Motif → the words a caption should use. Anything unmapped stays generic
 *  rather than leaking an internal key like "openingTrap" onto a post. */
const MOTIF_WORDS: Record<string, string> = {
  fork: "a fork", pin: "a pin", skewer: "a skewer", discoveredAttack: "a discovered attack",
  doubleCheck: "a double check", deflection: "a deflection", decoy: "a decoy", clearance: "a clearance",
  interference: "interference", overloading: "an overloaded defender", trappedPiece: "a trapped piece",
  hangingPiece: "a hanging piece", sacrifice: "a sacrifice", backRankMate: "a back-rank mate",
  smotheredMate: "a smothered mate", mateIn1: "mate in one", mateIn2: "mate in two", mateIn3: "mate in three",
  openingTrap: "an opening trap", zugzwangCreated: "zugzwang", prophylaxis: "prophylaxis",
  knightOutpost: "a knight outpost", passedPawn: "a passed pawn", rookSeventh: "a rook on the seventh",
};
const motifTag = (m: string) => (MOTIF_WORDS[m] ? String(m).replace(/[^a-zA-Z0-9]/g, "").toLowerCase() : "");
