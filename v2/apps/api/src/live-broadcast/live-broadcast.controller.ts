// Read side of the live broadcast. The ingest service writes to Mongo; these
// endpoints only read, so they stay fast and are safe to poll.
import { Controller, Get, Param, Query } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { LiveBroadcastService } from "./live-broadcast.service";

@Controller("live-broadcast")
export class LiveBroadcastController {
  constructor(
    @InjectConnection() private readonly conn: Connection,
    private readonly svc: LiveBroadcastService,
  ) {}

  /** Which tournaments are on air. Public: these are published games. */
  @Get()
  async live() {
    const rounds = await this.conn.db!.collection("liveBroadcastRounds")
      .find({ ongoing: true }, { projection: { roundId: 0 } })
      .sort({ updatedAt: -1 })
      .limit(20)
      .toArray();
    return {
      ok: true,
      rounds: rounds.map((r: any) => ({
        roundId: String(r._id),
        tourName: r.tourName, roundName: r.roundName, url: r.url,
        boards: r.boards ?? 0,
        updatedAt: r.updatedAt,
      })),
      streaming: this.svc.openStreams(),
    };
  }

  /** Every board on one round, newest state. This is what the grid polls. */
  @Get(":roundId")
  async round(@Param("roundId") roundId: string, @Query("since") since?: string) {
    const id = String(roundId || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
    if (!id) return { ok: false, games: [] };
    const filter: Record<string, unknown> = { roundId: id };
    // `since` lets a poller ask only for boards that changed, so a 40-board
    // round costs almost nothing once it is loaded.
    if (since) {
      const d = new Date(since);
      if (!Number.isNaN(d.getTime())) filter.updatedAt = { $gt: d };
    }
    const [meta, games] = await Promise.all([
      this.conn.db!.collection("liveBroadcastRounds").findOne({ _id: id as any }),
      this.conn.db!.collection("liveBroadcastGames").find(filter).sort({ board: 1 }).limit(120).toArray(),
    ]);
    return {
      ok: true,
      round: meta ? { roundId: id, tourName: (meta as any).tourName, roundName: (meta as any).roundName, ongoing: !!(meta as any).ongoing, url: (meta as any).url } : null,
      games: games.map((g: any) => ({
        board: g.board,
        whiteName: g.whiteName, blackName: g.blackName,
        whiteElo: g.whiteElo, blackElo: g.blackElo,
        whiteClock: g.whiteClock, blackClock: g.blackClock,
        result: g.result, ply: g.ply, fen: g.fen, lastMove: g.lastMove,
        finished: !!g.finished, updatedAt: g.updatedAt,
        moves: g.moves ?? [],
      })),
      serverTime: new Date().toISOString(),
    };
  }
}
