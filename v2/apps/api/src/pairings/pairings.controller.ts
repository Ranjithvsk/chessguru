// /api/pairings/* — FIDE Swiss-system tournament management (arbiter tool).
// Path-A architecture: pairings + round management + live standings are
// ChessGuru-owned; publishing to chess-results.com is optional via Herzog's
// XML upload API (arbiter pastes SID once, results auto-push).
//
// Pairing engine: JaVaFo 2.2 (Roberto Ricca), FIDE-endorsed Dutch Swiss
// reference implementation. Called via shell as a black box (TRF16 in,
// pairings out). See ./javafo.ts.
//
// Mongo collections (all namespaced sm_* — "Swiss Manager clone"):
//   sm_tournaments  — one doc per event, embeds players + rounds
//   sm_activity     — audit log (arbiter action → who/when/what)

import { Controller, Get, Post, Delete, Param, Body, Req, Res } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection, Types } from "mongoose";
import { pairNextRound } from "./javafo";
import { uploadResult, toCrResult, fetchUidMap, type CrResult } from "./chess-results";
import type { TrfPlayer, TrfResult, TrfRoundEntry } from "./trf16";
import { encodeTrf } from "./trf16";
import { isAdmin } from "../admin/admins";

interface Player extends TrfPlayer {
  cr_uid?: number | null;   // chess-results.com uid, populated after publish
}

interface Pairing {
  board: number;
  white_rank: number;
  black_rank: number;       // 0 = bye
  result: TrfResult | null; // TRF16 code, null = pending
  cr_pushed?: { at: string; status: string; msg: string } | null;
}

interface Round {
  round_no: number;
  pairings: Pairing[];
  generated_at: string;
  published_at?: string | null;
}

interface Tournament {
  _id?: any;
  slug: string;             // human-friendly id used in URLs
  name: string;
  city?: string;
  federation?: string;
  start_date?: string;
  end_date?: string;
  time_control?: string;
  num_rounds: number;
  rating_type: "FIDE" | "AICF" | "STATE" | "UNRATED";
  first_color: "white1" | "black1" | "rank";
  owner_user_id: string;
  chief_arbiter?: string;
  cr_sid?: string | null;         // chess-results.com Security ID (set once)
  cr_tournament?: string | null;  // chess-results.com tournament number
  players: Player[];
  rounds: Round[];
  created_at: string;
  updated_at: string;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "tournament";
}

// Standings: base = points; tiebreak 1 = Buchholz (sum of opps' points);
// tiebreak 2 = Sonneborn-Berger (weighted: full for wins vs opp, half for draws)
function calcStandings(t: Tournament) {
  const P = t.players.length;
  const points = new Array<number>(P + 1).fill(0);
  const opps: number[][] = Array.from({ length: P + 1 }, () => []);
  const rBy: Record<string, string> = {};
  for (const r of t.rounds) {
    for (const g of r.pairings) {
      const w = g.white_rank, b = g.black_rank;
      const res = g.result;
      if (!res) continue;
      const wp = res === "1" || res === "+" || res === "W" ? 1 : res === "=" || res === "D" ? 0.5 : 0;
      const bp = res === "0" || res === "-" || res === "L" ? 1 : res === "=" || res === "D" ? 0.5 : 0;
      if (w >= 1 && w <= P) { points[w] = (points[w] || 0) + wp; if (b) opps[w]!.push(b); }
      if (b >= 1 && b <= P) { points[b] = (points[b] || 0) + bp; if (w) opps[b]!.push(w); }
      rBy[`${r.round_no}:${w}`] = res;
    }
  }
  const rows = t.players.map((p) => {
    const buch = (opps[p.rank] || []).reduce((s, o) => s + (points[o] || 0), 0);
    const sb = (opps[p.rank] || []).reduce((s, o, idx) => {
      // recover this player's result vs opponent o
      let pts = 0;
      for (const r of t.rounds) {
        const g = r.pairings.find((g) => (g.white_rank === p.rank && g.black_rank === o) || (g.black_rank === p.rank && g.white_rank === o));
        if (!g || !g.result) continue;
        const asWhite = g.white_rank === p.rank;
        const res = g.result;
        pts = asWhite ? (res === "1" || res === "+" ? 1 : res === "=" ? 0.5 : 0) : (res === "0" || res === "-" ? 1 : res === "=" ? 0.5 : 0);
        break;
      }
      return s + (points[o] || 0) * pts;
    }, 0);
    return { rank: p.rank, name: p.name, rating: p.rating || 0, points: points[p.rank] || 0, buchholz: +buch.toFixed(1), sb: +sb.toFixed(2) };
  });
  rows.sort((a, b) => b.points - a.points || b.buchholz - a.buchholz || b.sb - a.sb || b.rating - a.rating);
  return rows.map((r, i) => ({ ...r, place: i + 1 }));
}

@Controller("pairings")
export class PairingsController {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  private coll() { return this.conn.db!.collection<Tournament>("sm_tournaments"); }

  private async loadOwned(id: string, req: any): Promise<Tournament | { error: string }> {
    const uid = req?.session?.userId;
    if (!uid) return { error: "AuthRequired" };
    const doc = await this.coll().findOne({ _id: new Types.ObjectId(id) as any });
    if (!doc) return { error: "NotFound" };
    if (doc.owner_user_id !== uid && !isAdmin(req.session)) return { error: "Forbidden" };
    return doc;
  }

  /** GET /api/pairings/tournaments — arbiter's tournaments. */
  @Get("tournaments")
  async listMine(@Req() req: any) {
    const uid = req?.session?.userId;
    if (!uid) return { rows: [] };
    const rows = await this.coll().find({ owner_user_id: uid }).sort({ created_at: -1 }).toArray();
    return {
      rows: rows.map((t: any) => ({
        _id: t._id, slug: t.slug, name: t.name, city: t.city, start_date: t.start_date, end_date: t.end_date,
        rating_type: t.rating_type, num_rounds: t.num_rounds, num_players: t.players.length,
        num_rounds_played: t.rounds.length, cr_published: !!t.cr_sid,
      })),
    };
  }

  /** POST /api/pairings/tournaments — create. */
  @Post("tournaments")
  async create(@Body() body: any, @Req() req: any) {
    const uid = req?.session?.userId;
    if (!uid) return { ok: false, error: "AuthRequired" };
    if (!body?.name || !body?.num_rounds) return { ok: false, error: "name + num_rounds required" };
    const now = new Date().toISOString();
    const t: Tournament = {
      slug: slugify(body.name),
      name: String(body.name).slice(0, 200),
      city: body.city || "",
      federation: body.federation || "IND",
      start_date: body.start_date || "",
      end_date: body.end_date || "",
      time_control: body.time_control || "",
      num_rounds: Math.min(20, Math.max(1, +body.num_rounds || 4)),
      rating_type: body.rating_type || "UNRATED",
      first_color: body.first_color || "white1",
      owner_user_id: uid,
      chief_arbiter: body.chief_arbiter || "",
      players: [],
      rounds: [],
      created_at: now,
      updated_at: now,
    };
    const r = await this.coll().insertOne(t as any);
    return { ok: true, _id: r.insertedId };
  }

  /** GET /api/pairings/tournaments/:id */
  @Get("tournaments/:id")
  async get(@Param("id") id: string, @Req() req: any) {
    const t = await this.loadOwned(id, req);
    if ("error" in t) return t;
    return { ...t, standings: calcStandings(t) };
  }

  /** POST /api/pairings/tournaments/:id/players — add one or many. Body: { players: [Player] } */
  @Post("tournaments/:id/players")
  async addPlayers(@Param("id") id: string, @Body() body: any, @Req() req: any) {
    const t = await this.loadOwned(id, req);
    if ("error" in t) return { ok: false, ...t };
    if (t.rounds.length > 0) return { ok: false, error: "Cannot edit players after round 1 is paired" };
    const incoming: Player[] = Array.isArray(body?.players) ? body.players : [body];
    const existing = t.players.length;
    const cleaned: Player[] = incoming.map((p: any, i: number): Player => ({
      rank: existing + i + 1,
      name: String(p.name || "").slice(0, 60),
      sex: p.sex === "w" ? "w" : p.sex === "m" ? "m" : null,
      title: (p.title || "").toString().slice(0, 3),
      rating: +p.rating || 0,
      federation: (p.federation || t.federation || "IND").toString().slice(0, 3),
      fide_id: p.fide_id ? String(p.fide_id).slice(0, 11) : "",
      birth: p.birth || "",
    })).filter((p) => p.name);
    if (cleaned.length === 0) return { ok: false, error: "No valid players in payload" };
    await this.coll().updateOne({ _id: t._id }, { $push: { players: { $each: cleaned as any } } as any, $set: { updated_at: new Date().toISOString() } });
    return { ok: true, added: cleaned.length, total: existing + cleaned.length };
  }

  /** DELETE /api/pairings/tournaments/:id/players/:rank */
  @Delete("tournaments/:id/players/:rank")
  async removePlayer(@Param("id") id: string, @Param("rank") rank: string, @Req() req: any) {
    const t = await this.loadOwned(id, req);
    if ("error" in t) return { ok: false, ...t };
    if (t.rounds.length > 0) return { ok: false, error: "Cannot edit players after round 1" };
    const r = +rank;
    const remaining = t.players.filter((p) => p.rank !== r).map((p, i) => ({ ...p, rank: i + 1 }));
    await this.coll().updateOne({ _id: t._id }, { $set: { players: remaining, updated_at: new Date().toISOString() } });
    return { ok: true, remaining: remaining.length };
  }

  /** POST /api/pairings/tournaments/:id/pair-round — generate NEXT round via JaVaFo. */
  @Post("tournaments/:id/pair-round")
  async pair(@Param("id") id: string, @Req() req: any) {
    const t = await this.loadOwned(id, req);
    if ("error" in t) return { ok: false, ...t };
    if (t.players.length < 2) return { ok: false, error: "Need at least 2 players" };
    if (t.rounds.length >= t.num_rounds) return { ok: false, error: "All rounds paired" };
    // Ensure previous round has all results filled — JaVaFo needs complete history
    if (t.rounds.length > 0) {
      const last = t.rounds[t.rounds.length - 1]!;
      const missing = last.pairings.filter((g) => g.black_rank !== 0 && !g.result);
      if (missing.length > 0) return { ok: false, error: `Round ${last.round_no} has ${missing.length} game(s) without a result` };
    }

    // Build history matrix for TRF encoder
    const history: TrfRoundEntry[][] = t.players.map(() => []);
    for (const r of t.rounds) {
      const seen = new Set<number>();
      for (const g of r.pairings) {
        if (g.white_rank >= 1) {
          history[g.white_rank - 1]!.push({ opp_rank: g.black_rank || 0, color: g.black_rank ? "w" : null, result: g.result });
          seen.add(g.white_rank);
        }
        if (g.black_rank >= 1) {
          history[g.black_rank - 1]!.push({ opp_rank: g.white_rank || 0, color: "b", result: g.result === "1" ? "0" : g.result === "0" ? "1" : g.result });
          seen.add(g.black_rank);
        }
      }
      // Absent players — mark as bye-absent for this round
      for (let i = 1; i <= t.players.length; i++) {
        if (!seen.has(i)) history[i - 1]!.push({ opp_rank: 0, color: null, result: "-" });
      }
    }

    const r = await pairNextRound({
      name: t.name, city: t.city, federation: t.federation, start_date: t.start_date, end_date: t.end_date,
      chief_arbiter: t.chief_arbiter, time_control: t.time_control,
      num_rounds: t.num_rounds, first_color: t.first_color,
      players: t.players.map((p) => ({ rank: p.rank, sex: p.sex, title: p.title || undefined, name: p.name, rating: p.rating, federation: p.federation, fide_id: p.fide_id || undefined, birth: p.birth || undefined })),
      history,
    });
    if (!r.ok) return { ok: false, error: r.error, stderr: r.stderr };

    const round_no = t.rounds.length + 1;
    const round: Round = {
      round_no,
      generated_at: new Date().toISOString(),
      pairings: r.pairings.map((p) => ({ board: p.board, white_rank: p.white, black_rank: p.black, result: null, cr_pushed: null })),
    };
    await this.coll().updateOne({ _id: t._id }, { $push: { rounds: round as any } as any, $set: { updated_at: new Date().toISOString() } });
    return { ok: true, round };
  }

  /** POST /api/pairings/tournaments/:id/rounds/:r/result — enter one result. Body: { board, result } */
  @Post("tournaments/:id/rounds/:r/result")
  async setResult(@Param("id") id: string, @Param("r") r: string, @Body() body: any, @Req() req: any) {
    const t = await this.loadOwned(id, req);
    if ("error" in t) return { ok: false, ...t };
    const roundIdx = t.rounds.findIndex((x) => x.round_no === +r);
    if (roundIdx < 0) return { ok: false, error: "Round not found" };
    const round = t.rounds[roundIdx]!;
    const board = +body?.board;
    const result: TrfResult | null = body?.result || null;
    const gameIdx = round.pairings.findIndex((g) => g.board === board);
    if (gameIdx < 0) return { ok: false, error: "Board not found" };
    const patch: any = { updated_at: new Date().toISOString() };
    patch[`rounds.${roundIdx}.pairings.${gameIdx}.result`] = result;
    await this.coll().updateOne({ _id: t._id }, { $set: patch });

    // Auto-push to chess-results.com if published
    let cr_push: any = null;
    if (t.cr_sid && t.cr_tournament && result) {
      const game = round.pairings[gameIdx]!;
      const whitePlayer = t.players.find((p) => p.rank === game.white_rank);
      const crRes = toCrResult(result);
      if (whitePlayer?.cr_uid && crRes) {
        const push = await uploadResult({ sid: t.cr_sid, tournament: t.cr_tournament, round: +r, cr_uid: whitePlayer.cr_uid, result: crRes });
        cr_push = { at: new Date().toISOString(), status: push.status, msg: push.msg };
        const p2: any = { updated_at: new Date().toISOString() };
        p2[`rounds.${roundIdx}.pairings.${gameIdx}.cr_pushed`] = cr_push;
        await this.coll().updateOne({ _id: t._id }, { $set: p2 });
      }
    }

    return { ok: true, cr_push };
  }

  /** POST /api/pairings/tournaments/:id/publish — register chess-results.com SID + tournament number. */
  @Post("tournaments/:id/publish")
  async publish(@Param("id") id: string, @Body() body: any, @Req() req: any) {
    const t = await this.loadOwned(id, req);
    if ("error" in t) return { ok: false, ...t };
    const sid = String(body?.sid || "").trim().toUpperCase();
    const tn = String(body?.tournament || "").trim();
    if (!/^[0-9A-F]{32}$/.test(sid)) return { ok: false, error: "SID must be 32 hex characters" };
    if (!/^\d+$/.test(tn)) return { ok: false, error: "Tournament number must be numeric" };

    // Try to fetch uid map so subsequent result pushes can find the right cr_uid per player
    const uidMap = await fetchUidMap(tn);
    let matched = 0;
    if (uidMap) {
      const updated: Player[] = t.players.map((p) => {
        const uid = uidMap[p.rank];
        if (uid) { matched++; return { ...p, cr_uid: uid }; }
        return p;
      });
      await this.coll().updateOne({ _id: t._id }, { $set: { cr_sid: sid, cr_tournament: tn, players: updated, updated_at: new Date().toISOString() } });
    } else {
      await this.coll().updateOne({ _id: t._id }, { $set: { cr_sid: sid, cr_tournament: tn, updated_at: new Date().toISOString() } });
    }
    return { ok: true, matched, total_players: t.players.length, uid_map_available: !!uidMap };
  }

  /** GET /api/pairings/tournaments/:id/standings */
  @Get("tournaments/:id/standings")
  async standings(@Param("id") id: string, @Req() req: any) {
    const t = await this.loadOwned(id, req);
    if ("error" in t) return t;
    return { standings: calcStandings(t) };
  }

  /** GET /api/pairings/tournaments/:id/trf16 — export for AICF / FIDE rating submission. */
  @Get("tournaments/:id/trf16")
  async trf16(@Param("id") id: string, @Req() req: any, @Res() res: any) {
    const t = await this.loadOwned(id, req);
    if ("error" in t) { res.status(404).send(t.error); return; }
    const history: TrfRoundEntry[][] = t.players.map(() => []);
    for (const r of t.rounds) {
      const seen = new Set<number>();
      for (const g of r.pairings) {
        if (g.white_rank >= 1) { history[g.white_rank - 1]!.push({ opp_rank: g.black_rank || 0, color: g.black_rank ? "w" : null, result: g.result }); seen.add(g.white_rank); }
        if (g.black_rank >= 1) { history[g.black_rank - 1]!.push({ opp_rank: g.white_rank || 0, color: "b", result: g.result === "1" ? "0" : g.result === "0" ? "1" : g.result }); seen.add(g.black_rank); }
      }
      for (let i = 1; i <= t.players.length; i++) {
        if (!seen.has(i)) history[i - 1]!.push({ opp_rank: 0, color: null, result: "-" });
      }
    }
    const trf = encodeTrf({
      name: t.name, city: t.city, federation: t.federation, start_date: t.start_date, end_date: t.end_date,
      chief_arbiter: t.chief_arbiter, time_control: t.time_control,
      num_rounds: t.num_rounds, players: t.players.map((p) => ({ ...p, title: p.title || undefined, fide_id: p.fide_id || undefined, birth: p.birth || undefined })),
      history,
    });
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${slugify(t.name)}.trfx"`);
    res.send(trf);
  }
}
