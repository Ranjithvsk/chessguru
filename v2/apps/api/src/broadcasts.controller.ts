// Read-only browser over the Lichess broadcast library.
//
// Reads chessguru.corpusgames, NOT the old chessguru.broadcastgames (retired 2026-09-24).
// The two collections held the same 1.17M games twice; the feed rows are all present in the
// corpus, so the second copy was 1.66 GB of duplication.
//
// The filter is `fromBroadcast: true`, not `source: "broadcast"`. The move-hash dedup keeps
// whichever copy of a game carries the most metadata, so ~69,000 broadcast games now sit
// under lumbras/kingbase/etc and a further 27,063 were in-feed duplicates collapsed into one
// row. Filtering on source alone hid 96,451 games; the flag was stamped onto every corpus row
// whose move-hash appears in the feed (1,250,694 rows = the feed's distinct games exactly).
//
// GET /api/broadcasts        list with pagination + filters
// GET /api/broadcasts/facets a set of picker options (top events, top players)
// GET /api/broadcasts/:id    one game with full move list (for the viewer page).
//                            Serves BOTH this collection and the deduped master corpus
//                            (corpusgames) -- see the note on that handler.

import { Controller, Get, Param, Query } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { ObjectId } from "mongodb";

const PAGE_SIZE = 50;

// Facets are picker options: the top 50 events and the top 50 players. Grouping 1.28M rows
// scattered through a 10.99 GB collection cost 15.1 s cold and 30.7 s right after an API
// restart. They are now PRECOMPUTED into chessguru.broadcastFacets by
// chessdb-api/build_broadcast_facets.py (hourly cron, 8 s a run), so the endpoint reads one
// small document.
//
// The in-memory cache below is kept only as a second layer for the fallback path. On its own
// it was not enough: it died with the process, so the first visitor after every deploy paid
// the full 30 s. A document survives restarts.
const FACETS_TTL_MS = 60 * 60 * 1000;
let facetsCache: { at: number; value: unknown } | null = null;

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

    const col = this.conn.db!.collection("corpusgames");
    filter.fromBroadcast = true;
    const [items, total] = await Promise.all([
      col
        .find(filter, { projection: { moves: 0, puzzleExtracted: 0, source: 0 } })
        // dateKey, NOT date, and no _id tiebreaker. Measured on the 12.16M corpus:
        //   sort({date:-1,_id:1})  timed out  -- `date` is the raw PGN string, so the walk
        //                          starts at "????.??.??" (highest strings) and almost none
        //                          of those unrated rows pass whiteElo>=2300, so it scanned
        //                          hundreds of thousands of non-matches before real dates.
        //                          The trailing _id also forces a blocking SORT.
        //   sort({dateKey:-1})     53 ms, 394 keys examined for 50 returned, no SORT stage.
        // dateKey is absent on unknown dates, which sort last on a descending index -- which
        // is where a game with no date belongs anyway.
        .sort({ dateKey: -1 })
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
    // Precomputed document first -- instant, and survives restarts.
    const pre: any = await this.conn.db!
      .collection("broadcastFacets").findOne({ _id: "broadcast" as any });
    if (pre?.events?.length) {
      return { events: pre.events, players: pre.players ?? [], builtAt: pre.builtAt };
    }
    // Fallbacks, for the window before the cron has ever run.
    if (facetsCache && Date.now() - facetsCache.at < FACETS_TTL_MS) return facetsCache.value;
    // Each aggregation leads with $match on fromBroadcast so a partial covering index can
    // serve it. Measured: the players half went 21,246 ms -> 2,902 ms once
    // frombroadcast_white / frombroadcast_black existed, and events 12,457 -> 3,172 ms with
    // frombroadcast_event. Without them this endpoint timed out entirely on the 12.16M
    // corpus, because 1.25M broadcast rows are scattered through a 10.99 GB collection
    // rather than packed into a 1.37 GB one.
    const col = this.conn.db!.collection("corpusgames");
    const onlyBroadcast = { $match: { fromBroadcast: true } };
    const [events, players] = await Promise.all([
      col.aggregate([
        onlyBroadcast,
        { $group: { _id: "$event", n: { $sum: 1 } } },
        { $sort: { n: -1 } },
        { $limit: 50 },
      ], { allowDiskUse: true }).toArray(),
      col.aggregate([
        onlyBroadcast,
        { $facet: {
          // Capped inside each branch: only the top 50 of either colour can reach the
          // merged top-50, so carrying every distinct name back is wasted transfer.
          w: [{ $group: { _id: "$whiteName", n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 200 }],
          b: [{ $group: { _id: "$blackName", n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 200 }],
        } },
      ], { allowDiskUse: true }).toArray(),
    ]);
    const playerMap = new Map<string, number>();
    for (const row of (players[0] as any)?.w ?? []) if (row._id) playerMap.set(row._id, (playerMap.get(row._id) ?? 0) + row.n);
    for (const row of (players[0] as any)?.b ?? []) if (row._id) playerMap.set(row._id, (playerMap.get(row._id) ?? 0) + row.n);
    const topPlayers = [...playerMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50);
    const out = {
      events: events.map((e: any) => ({ event: e._id, n: e.n })).filter((e: any) => e.event),
      players: topPlayers.map(([name, n]) => ({ name, n })),
    };
    facetsCache = { at: Date.now(), value: out };
    return out;
  }

  @Get(":id")
  async one(@Param("id") id: string) {
    // Two collections reach this route, and their _id types differ. broadcastgames uses a
    // 20-character STRING _id; the deduped master corpus (corpusgames, 12.1M games) uses a
    // real 24-hex ObjectId. This handler was written when only the former existed, so once
    // /database was repointed at the corpus (4334e3c) every row it rendered linked here and
    // got {found:false} -- "Game not found" on every single click.
    //
    // The string lookup stays first so existing shared /broadcasts/<id> links keep working
    // unchanged. ObjectId throws on anything that is not 24 hex characters, so the corpus
    // lookup is guarded by a shape test rather than a try/catch.
    // Three id shapes reach this route now:
    //   * a 24-hex ObjectId  -> a corpusgames row, the normal case
    //   * a 20-char string   -> an OLD /broadcasts/<id> link. Those ids were the retired
    //     collection's _id and are preserved on the corpus row as `_srcId`, so links already
    //     shared keep resolving. Without this fallback every such link would 404.
    const cg = this.conn.db!.collection("corpusgames");
    let g: any = /^[0-9a-fA-F]{24}$/.test(id)
      ? await cg.findOne({ _id: ObjectId.createFromHexString(id) as any })
      : null;
    if (!g) g = await cg.findOne({ _srcId: id });
    if (!g) return { found: false };
    const source: "broadcastgames" | "corpusgames" = "corpusgames";
    return {
      found: true,
      // Which library this came from. The viewer is shared between the broadcast page and
      // /database, and it used to send every visitor "back" to the broadcast list -- so
      // opening a master game from the corpus and pressing back dumped you in a different
      // collection entirely. The server knows which one it read; the client should not guess.
      source,
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
