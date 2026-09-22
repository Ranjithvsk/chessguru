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
      .find({ $or: [{ ongoing: true }, { state: "soon" }] })
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
        // live = upstream is pushing moves; playing = the round has started
        // but no moves have arrived yet; soon = due within 12h.
        state: r.state ?? (r.ongoing ? "live" : "finished"),
        startsAt: r.startsAt ?? null,
        tourId: r.tourId ?? null,
        // Every live round is in the rotation now, so they are all followed.
        following: true,
      })),
      // How long a full pass over every live round takes, so the page can
      // say how fresh it is instead of implying instant.
      cycleSec: st.cycleSec,
      throttled: st.throttled,
    };
  }

  /** Every round of a tournament, past included — so a tournament has a
   *  readable history rather than only whatever is on air this minute.
   *  Finished rounds carry their games once somebody opens them. */
  @Get("tour/:tourId")
  async tour(@Param("tourId") tourId: string) {
    const id = String(tourId || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
    if (!id) return { ok: false, rounds: [] };
    const rounds = await this.conn.db!.collection("liveBroadcastRounds")
      .find({ tourId: id })
      .sort({ startsAt: 1 })
      .limit(60)
      .toArray();
    return {
      ok: true,
      tourName: (rounds[0] as any)?.tourName ?? null,
      rounds: rounds.map((r: any) => ({
        roundId: String(r._id), roundName: r.roundName,
        state: r.state ?? (r.ongoing ? "live" : "finished"),
        startsAt: r.startsAt ?? null, boards: r.boards ?? 0,
      })),
    };
  }

  /** Player and team standings for a tournament, computed from the boards we
   *  hold. Lichess shows the same caveat on its own version, and for the same
   *  reason: these come from BROADCAST games, so a round nobody has opened yet
   *  is simply not counted. The response says how much it is working from so
   *  the page can be honest about it rather than implying officialdom.
   *  (TKT-259) */
  @Get("tour/:tourId/standings")
  async standings(@Param("tourId") tourId: string) {
    const id = String(tourId || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
    if (!id) return { ok: false };
    const rounds = await this.conn.db!.collection("liveBroadcastRounds")
      .find({ tourId: id }, { projection: { _id: 1, roundName: 1, boards: 1 } })
      .toArray();
    const roundIds = rounds.map((r: any) => String(r._id));
    if (!roundIds.length) return { ok: true, players: [], teams: [], roundsCounted: 0, roundsTotal: 0 };

    // Any round we have never fetched contributes nothing, so asking for
    // standings quietly pulls the missing ones in. Fire-and-forget and
    // serialized inside the service, so a big tournament fills in over a few
    // seconds instead of firing eleven requests at Lichess at once.
    for (const r of rounds as any[]) {
      if ((r.boards ?? 0) === 0) void this.svc.noteViewed(String(r._id)).catch(() => {});
    }

    const games = await this.conn.db!.collection("liveBroadcastGames")
      .find({ roundId: { $in: roundIds } })
      .limit(5000)
      .toArray();

    type P = { name: string; title: string | null; elo: number | null; team: string | null; score: number; played: number };
    const players = new Map<string, P>();
    type T = { team: string; matchPts: number; gamePts: number; matches: number; ratingSum: number; ratingN: number };
    const teams = new Map<string, T>();
    // A match is one pairing within one round.
    const matches = new Map<string, { a: string; b: string; aPts: number; bPts: number; open: number }>();

    const bump = (name: string, title: any, elo: any, team: any, pts: number) => {
      if (!name || name === "?") return;
      const p = players.get(name) ?? { name, title: title ?? null, elo: Number(elo) || null, team: team ?? null, score: 0, played: 0 };
      p.score += pts; p.played += 1;
      if (!p.title && title) p.title = title;
      if (!p.elo && Number(elo)) p.elo = Number(elo);
      if (!p.team && team) p.team = team;
      players.set(name, p);
    };

    for (const g of games as any[]) {
      const res = g.result;
      if (res !== "1-0" && res !== "0-1" && res !== "1/2-1/2") continue;   // unfinished counts for nobody
      const wPts = res === "1-0" ? 1 : res === "0-1" ? 0 : 0.5;
      bump(g.whiteName, g.whiteTitle, g.whiteElo, g.whiteTeam, wPts);
      bump(g.blackName, g.blackTitle, g.blackElo, g.blackTeam, 1 - wPts);

      const wt = g.whiteTeam, bt = g.blackTeam;
      if (!wt || !bt) continue;
      for (const [t, elo] of [[wt, g.whiteElo], [bt, g.blackElo]] as [string, any][]) {
        const rec = teams.get(t) ?? { team: t, matchPts: 0, gamePts: 0, matches: 0, ratingSum: 0, ratingN: 0 };
        if (Number(elo)) { rec.ratingSum += Number(elo); rec.ratingN += 1; }
        teams.set(t, rec);
      }
      teams.get(wt)!.gamePts += wPts;
      teams.get(bt)!.gamePts += 1 - wPts;

      const a = wt < bt ? wt : bt, b = wt < bt ? bt : wt;
      const k = `${g.roundId}|${a}|${b}`;
      const m = matches.get(k) ?? { a, b, aPts: 0, bPts: 0, open: 0 };
      if (wt === a) { m.aPts += wPts; m.bPts += 1 - wPts; } else { m.bPts += wPts; m.aPts += 1 - wPts; }
      matches.set(k, m);
    }

    // Match points: 2 for a won match, 1 each for a tie — the Olympiad rule.
    for (const m of matches.values()) {
      const A = teams.get(m.a), B = teams.get(m.b);
      if (!A || !B) continue;
      A.matches += 1; B.matches += 1;
      if (m.aPts > m.bPts) A.matchPts += 2;
      else if (m.bPts > m.aPts) B.matchPts += 2;
      else { A.matchPts += 1; B.matchPts += 1; }
    }

    return {
      ok: true,
      roundsTotal: rounds.length,
      roundsCounted: new Set(games.map((g: any) => g.roundId)).size,
      players: [...players.values()]
        .sort((x, y) => y.score - x.score || (y.elo ?? 0) - (x.elo ?? 0))
        .slice(0, 200),
      teams: [...teams.values()]
        .map((t) => ({ ...t, avgRating: t.ratingN ? Math.round(t.ratingSum / t.ratingN) : null }))
        .sort((x, y) => y.matchPts - x.matchPts || y.gamePts - x.gamePts)
        .slice(0, 200),
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
      round: meta ? { roundId: id, tourName: (meta as any).tourName, roundName: (meta as any).roundName, ongoing: !!(meta as any).ongoing, url: (meta as any).url, tourId: (meta as any).tourId ?? null } : null,
      games: games.map((g: any) => ({
        board: g.board,
        whiteName: g.whiteName, blackName: g.blackName,
        whiteElo: g.whiteElo, blackElo: g.blackElo,
        whiteClock: g.whiteClock, blackClock: g.blackClock,
        whiteTitle: g.whiteTitle ?? null, blackTitle: g.blackTitle ?? null,
        whiteFideId: g.whiteFideId ?? null, blackFideId: g.blackFideId ?? null,
        timeControl: g.timeControl ?? null, eco: g.eco ?? null, openingName: g.openingName ?? null,
        turn: g.turn ?? null, clockAsOf: g.clockAsOf ?? null,
        whiteTeam: g.whiteTeam ?? null, blackTeam: g.blackTeam ?? null,
        event: g.tourName ?? null,
        result: g.result, ply: g.ply, fen: g.fen, lastMove: g.lastMove,
        finished: !!g.finished, updatedAt: g.updatedAt,
        moves: g.moves ?? [],
      })),
      serverTime: new Date().toISOString(),
    };
  }
}
