// Instagram Studio — turns what already happened inside ChessGuru into things
// worth posting. It invents nothing: every card below points at a real moment,
// a real rating move or a real puzzle, so a caption can never claim something
// the database does not hold.
//
// Owner-only (see OWNER_EMAIL). The board is drawn in the browser from the FEN
// we hand back, so nothing here renders images.
import { ForbiddenException, Injectable } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";

/** Locked to one address, like the superadmin pages. Override per-environment. */
const OWNER_EMAIL = (process.env.INSTAGRAM_OWNER_EMAIL || "ranjith.vsk@gmail.com").toLowerCase();

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
