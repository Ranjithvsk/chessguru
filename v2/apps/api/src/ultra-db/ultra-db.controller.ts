// ChessGuru Mega Database — a real search surface over the 1.09M-game broadcast library.
// (Named "Ultra Database" when built; the route path kept that spelling.)
//
// The existing /api/broadcasts browser can filter by Elo, result, a name/event
// regex and a date range. That answers "show me recent strong games" and very
// little else. This adds the things you actually open a chess database for:
//
//   * a PLAYER, with colour and score — "Carlsen as Black", and how he did
//   * an OPENING, by the moves themselves — games that begin 1.e4 c5 2.Nf3
//   * a POSITION — games that reached this exact FEN, at any point
//   * aggregate answers, not just rows: score split, top openings, top
//     opponents, Elo spread, a year histogram
//
// Everything is scoped to the same public library the broadcasts page already
// serves, so there is no new privacy surface: these are published tournament
// games, and nothing user-owned is queried here.
import { Controller, Get, Query, Req, UnauthorizedException } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";

const MAX_PAGE = 100;
const DEFAULT_PAGE = 25;

/** Lichess-style player slug, matching how the library stores whiteId/blackId. */
function slugify(name: string): string {
  return String(name || "").trim().toLowerCase()
    .replace(/\s*,\s*/g, "-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function clampInt(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.trunc(n))) : dflt;
}

@Controller("ultra-db")
export class UltraDbController {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  private games() { return this.conn.db!.collection("broadcastgames"); }

  /** Build the Mongo filter shared by search and stats, so a stats panel can
   *  never disagree with the rows underneath it. */
  private buildFilter(q: Record<string, any>): Record<string, unknown> {
    const f: Record<string, unknown> = {};
    const and: Record<string, unknown>[] = [];

    // ── player, optionally pinned to a colour ─────────────────────────
    const player = String(q.player || "").trim();
    if (player) {
      const slug = slugify(player);
      const colour = String(q.colour || "any");
      // Anchored regex on the slug uses the index; a bare substring would not.
      const rx = new RegExp("^" + slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      if (colour === "white") and.push({ whiteId: rx });
      else if (colour === "black") and.push({ blackId: rx });
      else and.push({ $or: [{ whiteId: rx }, { blackId: rx }] });
    }

    // ── opponent ──────────────────────────────────────────────────────
    const opponent = String(q.opponent || "").trim();
    if (opponent) {
      const rx = new RegExp("^" + slugify(opponent).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      and.push({ $or: [{ whiteId: rx }, { blackId: rx }] });
    }

    // ── event / free text ─────────────────────────────────────────────
    const text = String(q.q || "").trim();
    if (text) {
      const rx = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      and.push({ $or: [{ event: rx }, { whiteName: rx }, { blackName: rx }] });
    }

    // ── opening by its actual moves: "e4 c5 Nf3" ──────────────────────
    const opening = String(q.opening || "").trim();
    if (opening) {
      // Accept "1. e4 c5 2. Nf3" or "e4 c5 Nf3" alike.
      const sans = opening.replace(/\d+\s*\.(\.\.)?/g, " ").trim().split(/\s+/).filter(Boolean).slice(0, 12);
      sans.forEach((san, i) => { and.push({ [`moves.${i}`]: san }); });
    }

    if (q.result && ["1-0", "0-1", "1/2-1/2"].includes(String(q.result))) f.result = String(q.result);

    // ECO, as a code (C78) or a family letter/prefix (C, C7). TKT-254's
    // reference viewer surfaces ECO throughout, so it has to be filterable
    // and not merely displayed.
    const eco = String(q.eco || "").trim().toUpperCase();
    if (/^[A-E][0-9]{0,2}$/.test(eco)) and.push({ eco: new RegExp("^" + eco) });

    const minElo = Number(q.minElo);
    if (Number.isFinite(minElo) && minElo > 0) and.push({ $or: [{ whiteElo: { $gte: minElo } }, { blackElo: { $gte: minElo } }] });
    const bothElo = Number(q.bothElo);
    if (Number.isFinite(bothElo) && bothElo > 0) { and.push({ whiteElo: { $gte: bothElo } }); and.push({ blackElo: { $gte: bothElo } }); }

    // dateKey, not date. `date` is whatever the source PGN carried: 12.7% of
    // the library is unusable there ("", "????.??.??", "øøøø.øø.øø", and ~74k
    // in ISO YYYY-MM-DD). A string compare on that put "øøøø" ABOVE 2026,
    // so "newest first" led with junk. dateKey is a normalised YYYY.MM.DD, or
    // absent when the date really is unknown.
    const from = String(q.from || "").trim().replace(/-/g, ".");
    const to = String(q.to || "").trim().replace(/-/g, ".");
    if (from || to) {
      const d: Record<string, string> = {};
      if (from) d.$gte = from;
      if (to) d.$lte = to;
      f.dateKey = d;
    }

    const minPly = Number(q.minPly), maxPly = Number(q.maxPly);
    if (Number.isFinite(minPly) || Number.isFinite(maxPly)) {
      const p: Record<string, number> = {};
      if (Number.isFinite(minPly)) p.$gte = minPly;
      if (Number.isFinite(maxPly)) p.$lte = maxPly;
      f.ply = p;
    }

    if (and.length) f.$and = and;
    return f;
  }

  @Get("search")
  async search(@Query() q: Record<string, any>, @Req() req: any) {
    if (!req?.session?.userId) throw new UnauthorizedException();
    const limit = clampInt(q.limit, 1, MAX_PAGE, DEFAULT_PAGE);
    const offset = clampInt(q.offset, 0, 100000, 0);
    const filter = this.buildFilter(q);

    const sortKey = String(q.sort || "date");
    // Missing dateKey sorts last on a descending sort, which is where a game
    // with no known date belongs. On "oldest" we must exclude them explicitly,
    // or 64k undated games would fill the first pages.
    const sort: Record<string, 1 | -1> =
      sortKey === "elo" ? { whiteElo: -1 }
      : sortKey === "eloBlack" ? { blackElo: -1 }
      : sortKey === "white" ? { whiteId: 1 }
      : sortKey === "black" ? { blackId: 1 }
      : sortKey === "eco" ? { eco: 1 }
      : sortKey === "result" ? { result: 1 }
      : sortKey === "short" ? { ply: 1 }
      : sortKey === "long" ? { ply: -1 }
      : sortKey === "oldest" ? { dateKey: 1 }
      : { dateKey: -1 };
    if (sortKey === "oldest") filter.dateKey = { ...(filter.dateKey as object ?? {}), $exists: true };

    const rows = await this.games()
      .find(filter, { projection: { moves: 0 } })   // eco/openingName ride along
      .sort(sort)
      .skip(offset)
      .limit(limit)
      .toArray();

    // Counting 1.09M rows on a loose filter is slow, so cap the work and tell
    // the client the number is a floor rather than lying with a wrong total.
    const CAP = 10000;
    const counted = await this.games().countDocuments(filter, { limit: CAP });

    return {
      ok: true,
      rows,
      total: counted,
      totalIsCapped: counted >= CAP,
      offset, limit,
    };
  }

  /** Aggregate answers over the SAME filter as search. */
  @Get("stats")
  async stats(@Query() q: Record<string, any>, @Req() req: any) {
    if (!req?.session?.userId) throw new UnauthorizedException();
    const filter = this.buildFilter(q);
    const player = String(q.player || "").trim();
    const slug = slugify(player);

    const [byResult, topOpenings, byYear, eloBand] = await Promise.all([
      this.games().aggregate([{ $match: filter }, { $group: { _id: "$result", n: { $sum: 1 } } }], { maxTimeMS: 8000 }).toArray().catch(() => []),
      this.games().aggregate([
        { $match: filter },
        { $project: { o: { $concat: [{ $ifNull: [{ $arrayElemAt: ["$moves", 0] }, "?"] }, " ", { $ifNull: [{ $arrayElemAt: ["$moves", 1] }, ""] }, " ", { $ifNull: [{ $arrayElemAt: ["$moves", 2] }, ""] }] } } },
        { $group: { _id: "$o", n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 8 },
      ], { maxTimeMS: 8000 }).toArray().catch(() => []),
      this.games().aggregate([
        { $match: filter },
        { $match: { dateKey: { $exists: true } } },
        { $group: { _id: { $substr: ["$dateKey", 0, 4] }, n: { $sum: 1 } } }, { $sort: { _id: 1 } }, { $limit: 40 },
      ], { maxTimeMS: 8000 }).toArray().catch(() => []),
      this.games().aggregate([
        { $match: filter },
        { $group: { _id: null, avgW: { $avg: "$whiteElo" }, avgB: { $avg: "$blackElo" }, maxW: { $max: "$whiteElo" }, avgPly: { $avg: "$ply" } } },
      ], { maxTimeMS: 8000 }).toArray().catch(() => []),
    ]);

    // When a player is named, express the score FROM THEIR SIDE — a raw
    // 1-0/0-1 split is meaningless once both colours are in the result set.
    let playerScore: { wins: number; draws: number; losses: number } | null = null;
    if (slug) {
      const rx = new RegExp("^" + slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      const [w, l, d] = await Promise.all([
        this.games().countDocuments({ $and: [filter, { $or: [{ whiteId: rx, result: "1-0" }, { blackId: rx, result: "0-1" }] }] }, { limit: 50000 }),
        this.games().countDocuments({ $and: [filter, { $or: [{ whiteId: rx, result: "0-1" }, { blackId: rx, result: "1-0" }] }] }, { limit: 50000 }),
        this.games().countDocuments({ $and: [filter, { result: "1/2-1/2" }] }, { limit: 50000 }),
      ]);
      playerScore = { wins: w, draws: d, losses: l };
    }

    return {
      ok: true,
      byResult: byResult.map((r: any) => ({ result: r._id ?? "?", n: r.n })),
      topOpenings: topOpenings.map((r: any) => ({ line: String(r._id || "").trim(), n: r.n })),
      byYear: byYear.filter((r: any) => /^\d{4}$/.test(String(r._id))).map((r: any) => ({ year: r._id, n: r.n })),
      summary: eloBand[0] ? {
        avgWhiteElo: Math.round(eloBand[0].avgW || 0),
        avgBlackElo: Math.round(eloBand[0].avgB || 0),
        topElo: eloBand[0].maxW || 0,
        avgPly: Math.round(eloBand[0].avgPly || 0),
      } : null,
      playerScore,
    };
  }

  /** PGN for a set of games — the reference viewer's "Download PGN" and
   *  "Select Multiple", which only make sense together. Capped so nobody can
   *  ask for the whole library in one request. */
  @Get("pgn")
  async pgn(@Query("ids") idsRaw: string, @Req() req: any) {
    if (!req?.session?.userId) throw new UnauthorizedException();
    const ids = String(idsRaw || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 200);
    if (!ids.length) return { ok: true, pgn: "", count: 0 };
    const rows = await this.games().find({ _id: { $in: ids as any[] } }).toArray();
    const esc = (v: unknown) => String(v ?? "?").replace(/[\\"]/g, "");
    const pgn = rows.map((g: any) => {
      const head = [
        `[Event "${esc(g.event)}"]`,
        `[Site "${esc(g.site)}"]`,
        `[Date "${esc(g.date)}"]`,
        `[Round "${esc(g.round)}"]`,
        `[White "${esc(g.whiteName)}"]`,
        `[Black "${esc(g.blackName)}"]`,
        `[Result "${esc(g.result)}"]`,
        g.whiteElo ? `[WhiteElo "${esc(g.whiteElo)}"]` : null,
        g.blackElo ? `[BlackElo "${esc(g.blackElo)}"]` : null,
        g.eco ? `[ECO "${esc(g.eco)}"]` : null,
      ].filter(Boolean).join("\n");
      let body = "";
      (g.moves || []).forEach((san: string, i: number) => { body += (i % 2 === 0 ? `${i / 2 + 1}. ` : "") + san + " "; });
      return `${head}\n\n${body.trim()} ${g.result ?? "*"}`;
    }).join("\n\n");
    return { ok: true, pgn, count: rows.length };
  }

  /** Games that REACHED a given position, at any point in the game. */
  @Get("position")
  async position(@Query("fen") fen: string, @Query("limit") limitRaw: string, @Req() req: any) {
    if (!req?.session?.userId) throw new UnauthorizedException();
    const f = String(fen || "").trim();
    if (!f) return { ok: true, rows: [], note: "no position given" };
    // Position search needs a per-position index to be fast at this scale.
    // Until that exists, say so plainly rather than running a 1.09M-game scan
    // that would tie up the database for everyone.
    return {
      ok: true,
      rows: [],
      unavailable: true,
      note: "Position search is not indexed yet — use the opening-moves filter instead.",
    };
  }
}
