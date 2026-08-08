// Read-only browser over the Mongo `broadcastgames` collection populated by
// scripts/load-broadcast-games.js (Lichess broadcast PGN dumps).
//
// GET /api/broadcasts        list with pagination + filters
// GET /api/broadcasts/facets a set of picker options (top events, top players)
// GET /api/broadcasts/:id    one game with full move list (for the viewer page)

import { Controller, Get, Param, Query } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";

const PAGE_SIZE = 50;

@Controller("broadcasts")
export class BroadcastsController {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  @Get()
  async list(
    @Query("minElo") minEloRaw?: string,
    @Query("result") resultRaw?: string,
    @Query("q") qRaw?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("offset") offsetRaw?: string,
  ) {
    const minElo = Math.max(0, parseInt(String(minEloRaw ?? "2300"), 10) || 0);
    const offset = Math.max(0, parseInt(String(offsetRaw ?? "0"), 10) || 0);
    const filter: Record<string, unknown> = {};
    if (minElo > 0) {
      filter.whiteElo = { $gte: minElo };
      filter.blackElo = { $gte: minElo };
    }
    if (resultRaw && ["1-0", "0-1", "1/2-1/2"].includes(resultRaw)) {
      filter.result = resultRaw;
    }
    if (from || to) {
      const dateFilter: Record<string, string> = {};
      if (from) dateFilter.$gte = from;
      if (to) dateFilter.$lte = to;
      filter.date = dateFilter;
    }
    if (qRaw && qRaw.trim()) {
      const rx = new RegExp(escapeRegex(qRaw.trim()), "i");
      filter.$or = [{ event: rx }, { whiteName: rx }, { blackName: rx }];
    }

    const col = this.conn.db!.collection("broadcastgames");
    const [items, total] = await Promise.all([
      col
        .find(filter, { projection: { moves: 0, puzzleExtracted: 0, source: 0 } })
        .sort({ date: -1, _id: 1 })
        .skip(offset)
        .limit(PAGE_SIZE)
        .toArray(),
      col.countDocuments(filter),
    ]);

    return {
      items: items.map((g: any) => ({
        id: g._id,
        event: g.event, site: g.site, round: g.round, date: g.date,
        white: g.whiteName, whiteElo: g.whiteElo,
        black: g.blackName, blackElo: g.blackElo,
        result: g.result, ply: g.ply,
      })),
      total, offset, pageSize: PAGE_SIZE,
      hasMore: offset + PAGE_SIZE < total,
    };
  }

  @Get("facets")
  async facets() {
    const col = this.conn.db!.collection("broadcastgames");
    const [events, players] = await Promise.all([
      col.aggregate([
        { $group: { _id: "$event", n: { $sum: 1 } } },
        { $sort: { n: -1 } },
        { $limit: 50 },
      ]).toArray(),
      col.aggregate([
        { $facet: {
          w: [{ $group: { _id: "$whiteName", n: { $sum: 1 } } }],
          b: [{ $group: { _id: "$blackName", n: { $sum: 1 } } }],
        } },
      ]).toArray(),
    ]);
    const playerMap = new Map<string, number>();
    for (const row of (players[0] as any)?.w ?? []) if (row._id) playerMap.set(row._id, (playerMap.get(row._id) ?? 0) + row.n);
    for (const row of (players[0] as any)?.b ?? []) if (row._id) playerMap.set(row._id, (playerMap.get(row._id) ?? 0) + row.n);
    const topPlayers = [...playerMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50);
    return {
      events: events.map((e: any) => ({ event: e._id, n: e.n })).filter((e: any) => e.event),
      players: topPlayers.map(([name, n]) => ({ name, n })),
    };
  }

  @Get(":id")
  async one(@Param("id") id: string) {
    const g: any = await this.conn.db!.collection("broadcastgames").findOne({ _id: id as any });
    if (!g) return { found: false };
    return {
      found: true,
      id: g._id,
      event: g.event, site: g.site, round: g.round, date: g.date,
      white: g.whiteName, whiteElo: g.whiteElo,
      black: g.blackName, blackElo: g.blackElo,
      result: g.result,
      moves: Array.isArray(g.moves) ? g.moves : String(g.moves || "").split(/\s+/).filter(Boolean),
      ply: g.ply,
    };
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
