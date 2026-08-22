// /api/results/* — PUBLIC (unauthenticated) read-only mirror of sm_tournaments
// where is_public=true. Powers results.chessguru.cc — our head-to-head answer
// to chess-results.com. Arbiters flip a switch in /arbiter → Publish tab; the
// tournament goes live at results.chessguru.cc/t/<id>.
//
// SEO layer (crawler-friendly HTML rendering) is at ./results-render.controller.ts —
// this file is pure JSON API for the SPA.

import { Controller, Get, Param, Query, Req } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection, Types } from "mongoose";

// Recompute standings public-side (same math as PairingsController.calcStandings
// but pared down — no need to import from the arbiter controller since public
// callers should never depend on arbiter internals).
function publicStandings(t: any) {
  const P = t.players.length;
  const points = new Array<number>(P + 1).fill(0);
  const opps: number[][] = Array.from({ length: P + 1 }, () => []);
  for (const r of t.rounds || []) {
    for (const g of r.pairings) {
      const w = g.white_rank, b = g.black_rank;
      const res = g.result;
      if (!res) continue;
      const wp = res === "1" || res === "+" ? 1 : res === "=" ? 0.5 : 0;
      const bp = res === "0" || res === "-" ? 1 : res === "=" ? 0.5 : 0;
      if (w >= 1 && w <= P) { points[w] = (points[w] || 0) + wp; if (b) opps[w]!.push(b); }
      if (b >= 1 && b <= P) { points[b] = (points[b] || 0) + bp; if (w) opps[b]!.push(w); }
    }
  }
  const rows = t.players.map((p: any) => {
    const buch = (opps[p.rank] || []).reduce((s, o) => s + (points[o] || 0), 0);
    const sb = (opps[p.rank] || []).reduce((s, o) => {
      let pts = 0;
      for (const r of t.rounds || []) {
        const g = r.pairings.find((g: any) => (g.white_rank === p.rank && g.black_rank === o) || (g.black_rank === p.rank && g.white_rank === o));
        if (!g || !g.result) continue;
        const asWhite = g.white_rank === p.rank;
        const res = g.result;
        pts = asWhite ? (res === "1" || res === "+" ? 1 : res === "=" ? 0.5 : 0) : (res === "0" || res === "-" ? 1 : res === "=" ? 0.5 : 0);
        break;
      }
      return s + (points[o] || 0) * pts;
    }, 0);
    return { rank: p.rank, name: p.name, title: p.title || "", rating: p.rating || 0, federation: p.federation || "", fide_id: p.fide_id || "", points: points[p.rank] || 0, buchholz: +buch.toFixed(1), sb: +sb.toFixed(2) };
  });
  rows.sort((a: any, b: any) => b.points - a.points || b.buchholz - a.buchholz || b.sb - a.sb || b.rating - a.rating);
  return rows.map((r: any, i: number) => ({ ...r, place: i + 1 }));
}

@Controller("results")
export class ResultsController {
  constructor(@InjectConnection() private readonly conn: Connection) {}
  private coll() { return this.conn.db!.collection<any>("sm_tournaments"); }

  /** GET /api/results/tournaments — public tournament listing.
   *  Query params: search=X, federation=IND, city=Chennai, rating_type=FIDE,
   *  running_now=1 (start_date<=today<=end_date), month=YYYY/MM,
   *  upcoming=1 (start_date>today), finished=1 (end_date<today), sort=name|date. */
  @Get("tournaments")
  async list(@Query() q: any) {
    const filter: any = { is_public: true };
    if (q.federation) filter.federation = String(q.federation).toUpperCase();
    if (q.city) filter.city = { $regex: new RegExp(`^${String(q.city).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") };
    if (q.rating_type) filter.rating_type = String(q.rating_type).toUpperCase();
    if (q.search) filter.$or = [
      { name: { $regex: new RegExp(String(q.search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") } },
      { city: { $regex: new RegExp(String(q.search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") } },
    ];
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "/");
    if (q.running_now === "1") { filter.start_date = { $lte: today }; filter.end_date = { $gte: today }; }
    if (q.upcoming === "1") filter.start_date = { $gt: today };
    if (q.finished === "1") filter.end_date = { $lt: today };
    if (q.month) {  // "2026/08"
      const m = String(q.month);
      filter.start_date = { $gte: `${m}/01`, $lte: `${m}/31` };
    }
    const sort: Record<string, 1 | -1> = q.sort === "name" ? { name: 1 } : { start_date: -1, updated_at: -1 };
    const limit = Math.min(200, Math.max(1, parseInt(q.limit || "50", 10)));
    const skip = Math.max(0, parseInt(q.skip || "0", 10));
    const rows = await this.coll().find(filter).sort(sort).skip(skip).limit(limit).toArray();
    return {
      rows: rows.map((t: any) => ({
        _id: t._id, slug: t.slug, name: t.name, city: t.city, federation: t.federation,
        start_date: t.start_date, end_date: t.end_date, rating_type: t.rating_type,
        num_rounds: t.num_rounds, num_players: t.players?.length || 0,
        num_rounds_played: t.rounds?.length || 0,
      })),
      total: await this.coll().countDocuments(filter),
    };
  }

  /** GET /api/results/discover — homepage aggregate: running-now + this-month + recent. */
  @Get("discover")
  async discover() {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "/");
    const yyyymm = today.slice(0, 7);
    const project = { name: 1, city: 1, federation: 1, start_date: 1, end_date: 1, rating_type: 1, num_rounds: 1, players: 1, rounds: 1, slug: 1 } as any;
    const [running, thisMonth, recent] = await Promise.all([
      this.coll().find({ is_public: true, start_date: { $lte: today }, end_date: { $gte: today } }, { projection: project }).sort({ start_date: 1 }).limit(12).toArray(),
      this.coll().find({ is_public: true, start_date: { $gte: `${yyyymm}/01`, $lte: `${yyyymm}/31` } }, { projection: project }).sort({ start_date: 1 }).limit(24).toArray(),
      this.coll().find({ is_public: true }, { projection: project }).sort({ updated_at: -1 }).limit(24).toArray(),
    ]);
    const trim = (t: any) => ({ _id: t._id, slug: t.slug, name: t.name, city: t.city, federation: t.federation,
      start_date: t.start_date, end_date: t.end_date, rating_type: t.rating_type,
      num_rounds: t.num_rounds, num_players: t.players?.length || 0, num_rounds_played: t.rounds?.length || 0 });
    return { running: running.map(trim), this_month: thisMonth.map(trim), recent: recent.map(trim) };
  }

  /** GET /api/results/tournaments/:id — full public view (crosstable-ready). */
  @Get("tournaments/:id")
  async get(@Param("id") id: string) {
    let _id: any;
    try { _id = new Types.ObjectId(id); } catch { return { error: "NotFound" }; }
    const t = await this.coll().findOne({ _id, is_public: true });
    if (!t) return { error: "NotFound" };
    // Sanitize: strip owner_user_id, cr_sid (SID is a secret credential — never expose)
    const { owner_user_id, cr_sid, ...pub } = t;
    return { ...pub, standings: publicStandings(t) };
  }

  /** GET /api/results/players/:fide_id — every public tournament this player
   *  appeared in, plus career aggregates (games, W/L/D, points, points%,
   *  average opponent rating). Bot-rendered version is at
   *  /api/render/results/player/:fide_id for SEO. */
  @Get("players/:fide_id")
  async player(@Param("fide_id") fideId: string) {
    const rows = await this.coll().find({ is_public: true, "players.fide_id": fideId }).sort({ end_date: -1 }).limit(200).toArray();
    let name = "";
    let games = 0, wins = 0, losses = 0, draws = 0;
    let oppRatingSum = 0, oppRatingCount = 0;
    const tournaments = rows.map((t: any) => {
      const p = t.players.find((x: any) => x.fide_id === fideId);
      if (!p) return null;
      if (!name) name = p.name;
      let pts = 0, gm = 0;
      for (const r of t.rounds || []) {
        for (const g of r.pairings || []) {
          const asWhite = g.white_rank === p.rank;
          const asBlack = g.black_rank === p.rank;
          if (!asWhite && !asBlack) continue;
          const res = g.result;
          if (!res) continue;
          gm++; games++;
          const wIsPlayer = asWhite;
          const won = wIsPlayer ? (res === "1" || res === "+") : (res === "0" || res === "-");
          const drew = res === "=";
          if (won) { pts += 1; wins++; } else if (drew) { pts += 0.5; draws++; } else { losses++; }
          const oppRank = wIsPlayer ? g.black_rank : g.white_rank;
          if (oppRank) {
            const opp = t.players.find((x: any) => x.rank === oppRank);
            if (opp?.rating) { oppRatingSum += opp.rating; oppRatingCount++; }
          }
        }
      }
      return { _id: t._id, slug: t.slug, name: t.name, city: t.city, federation: t.federation,
               start_date: t.start_date, end_date: t.end_date, rating_type: t.rating_type,
               player_rank: p.rank, player_title: p.title || "", player_rating: p.rating || 0,
               games: gm, points: pts, points_max: (t.rounds?.length || 0),
               num_rounds: t.num_rounds };
    }).filter(Boolean) as any[];
    const stats = {
      name,
      fide_id: fideId,
      tournaments: tournaments.length,
      games, wins, losses, draws,
      points: (wins * 1 + draws * 0.5),
      points_pct: games ? +((wins + draws * 0.5) / games * 100).toFixed(1) : 0,
      avg_opp_rating: oppRatingCount ? Math.round(oppRatingSum / oppRatingCount) : null,
    };
    return { stats, rows: tournaments };
  }

  /** GET /api/results/tournaments/:id/games — index of games with PGN.
   *  Returns [{ round_no, board, has_pgn }] so the SPA can decorate the
   *  pairings table with "▶ Play" buttons where PGNs are available. */
  @Get("tournaments/:id/games")
  async gameIndex(@Param("id") id: string) {
    let _id: any;
    try { _id = new Types.ObjectId(id); } catch { return { rows: [] }; }
    const t = await this.coll().findOne({ _id, is_public: true }, { projection: { _id: 1 } });
    if (!t) return { rows: [] };
    const gs = await this.conn.db!.collection("sm_games").find(
      { tournament_id: _id }, { projection: { round_no: 1, board: 1 } } as any,
    ).toArray();
    return { rows: gs.map((g: any) => ({ round_no: g.round_no, board: g.board })) };
  }

  /** GET /api/results/tournaments/:id/games/:round/:board — one game's PGN. */
  @Get("tournaments/:id/games/:round/:board")
  async oneGame(@Param("id") id: string, @Param("round") round: string, @Param("board") board: string) {
    let _id: any;
    try { _id = new Types.ObjectId(id); } catch { return { error: "NotFound" }; }
    const t = await this.coll().findOne({ _id, is_public: true }, { projection: { _id: 1 } });
    if (!t) return { error: "NotFound" };
    const g = await this.conn.db!.collection("sm_games").findOne({ tournament_id: _id, round_no: +round, board: +board });
    if (!g) return { error: "NotFound" };
    return { pgn: g.pgn, headers: g.headers, white_rank: g.white_rank, black_rank: g.black_rank };
  }

  /** GET /api/results/cities/:federation — most active cities in a federation. */
  @Get("cities/:federation")
  async cities(@Param("federation") fed: string) {
    const agg = await this.coll().aggregate([
      { $match: { is_public: true, federation: fed.toUpperCase() } },
      { $group: { _id: "$city", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 50 },
    ]).toArray();
    return { rows: agg.map((r: any) => ({ city: r._id || "—", count: r.count })) };
  }

  /** GET /api/results/federations — count of tournaments per federation for the /f index page. */
  @Get("federations")
  async federations() {
    const agg = await this.coll().aggregate([
      { $match: { is_public: true } },
      { $group: { _id: "$federation", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]).toArray();
    return { rows: agg.map((r: any) => ({ federation: r._id || "—", count: r.count })) };
  }
}
