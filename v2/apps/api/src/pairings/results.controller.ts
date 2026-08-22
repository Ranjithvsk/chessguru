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

  /** GET /api/results/tournaments?federation=IND&limit=50
   *  Returns tournaments arbiters have marked public. Latest updated first. */
  @Get("tournaments")
  async list(@Query() q: any) {
    const filter: any = { is_public: true };
    if (q.federation) filter.federation = String(q.federation).toUpperCase();
    if (q.search) filter.name = { $regex: new RegExp(String(q.search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") };
    const limit = Math.min(200, Math.max(1, parseInt(q.limit || "50", 10)));
    const skip = Math.max(0, parseInt(q.skip || "0", 10));
    const rows = await this.coll().find(filter).sort({ updated_at: -1 }).skip(skip).limit(limit).toArray();
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

  /** GET /api/results/players/:fide_id — every public tournament this player appeared in. */
  @Get("players/:fide_id")
  async player(@Param("fide_id") fideId: string) {
    const rows = await this.coll().find({ is_public: true, "players.fide_id": fideId }).sort({ end_date: -1 }).limit(100).toArray();
    return {
      rows: rows.map((t: any) => {
        const p = t.players.find((x: any) => x.fide_id === fideId);
        return { _id: t._id, slug: t.slug, name: t.name, city: t.city, start_date: t.start_date, end_date: t.end_date,
                 player_rank: p?.rank, player_name: p?.name };
      }),
    };
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
