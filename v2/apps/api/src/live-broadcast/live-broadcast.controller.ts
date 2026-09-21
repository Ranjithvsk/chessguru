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
    // Every live round, not only the ones we hold a stream for. Lichess runs
    // dozens at once and a viewer should see all of them; opening one is what
    // starts a stream.
    const rounds = await this.conn.db!.collection("liveBroadcastRounds")
      .find({ ongoing: true })
      .sort({ updatedAt: -1 })
      .limit(60)
      .toArray();
    const st = this.svc.status();
    return {
      ok: true,
      rounds: rounds.map((r: any) => ({
        roundId: String(r._id),
        tourName: r.tourName, roundName: r.roundName, url: r.url,
        boards: r.boards ?? 0,
        updatedAt: r.updatedAt,
        // Every live round is in the rotation now, so they are all followed.
        following: true,
      })),
      // How long a full pass over every live round takes, so the page can
      // say how fresh it is instead of implying instant.
      cycleSec: st.cycleSec,
      throttled: st.throttled,
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
    // Opening a round is the signal that someone wants it live.
    void this.svc.noteViewed(id).catch(() => {});
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
        whiteTitle: g.whiteTitle ?? null, blackTitle: g.blackTitle ?? null,
        whiteFideId: g.whiteFideId ?? null, blackFideId: g.blackFideId ?? null,
        timeControl: g.timeControl ?? null, eco: g.eco ?? null, openingName: g.openingName ?? null,
        result: g.result, ply: g.ply, fen: g.fen, lastMove: g.lastMove,
        finished: !!g.finished, updatedAt: g.updatedAt,
        moves: g.moves ?? [],
      })),
      serverTime: new Date().toISOString(),
    };
  }
}
