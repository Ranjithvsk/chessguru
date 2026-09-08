// Live-games history: the games a signed-in user played on /play (online, human
// or bot), read from `live_games` where the game-engine archives every finished
// game. Everything is viewed from the caller's side of the board: "outcome" is
// win/loss/draw for THEM, "ratingDiff" is THEIR change, "opponent" is the other
// seat. Bots live in the same namespace as humans (`u:<name>`) by design, so
// nothing here can, or should, tell them apart.
import { Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { Chess } from "chess.js";

export type Speed = "bullet" | "blitz" | "rapid" | "classical";
export type Outcome = "win" | "loss" | "draw";
export type Color = "white" | "black";

interface GameDoc {
  _id: string;
  players: { white: string | null; black: string | null };
  moves: string[];
  moveTimes?: number[];
  result: string | null;
  status: string;
  rated: boolean;
  speed: Speed;
  timeControl: { initial: number; increment: number };
  rating?: { white: { before: number; after: number }; black: { before: number; after: number } } | null;
  startedAt: Date;
  finishedAt: Date;
  initialFen: string;
  variant: string;
}

export interface GameSummary {
  id: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  speed: Speed;
  timeControl: { initial: number; increment: number };
  rated: boolean;
  myColor: Color;
  opponent: { id: string; name: string };
  result: string | null;
  status: string;
  outcome: Outcome;
  /** Result from the caller's side, e.g. "Opponent resigned", "You ran out of time". */
  reasonText: string;
  plies: number;
  ratingBefore: number | null;
  ratingAfter: number | null;
  ratingDiff: number | null;
  opponentRating: number | null;
}

const SPEEDS: Speed[] = ["bullet", "blitz", "rapid", "classical"];
// Glicko-2 deviation above which a rating is still "settling" — Lichess shows a
// "?" until it drops under 110.
const PROVISIONAL_D = 110;
const MAX_HISTORY = 2000;

function outcomeFor(result: string | null, myColor: Color): Outcome {
  if (result === "1/2-1/2") return "draw";
  if (result === "1-0") return myColor === "white" ? "win" : "loss";
  if (result === "0-1") return myColor === "black" ? "win" : "loss";
  return "draw";
}

function reasonFor(status: string, outcome: Outcome): string {
  const won = outcome === "win";
  switch (status) {
    case "checkmate": return won ? "Checkmate — you won" : "You were checkmated";
    case "resign": return won ? "Opponent resigned" : "You resigned";
    case "flag": return won ? "Opponent ran out of time" : "You ran out of time";
    case "abandoned": return won ? "Opponent left the game" : "You left the game";
    case "stalemate": return "Stalemate";
    case "insufficient": return "Insufficient material";
    case "fiftymove": return "Fifty-move rule";
    case "threefold": return "Threefold repetition";
    case "agreement": return "Draw by agreement";
    default: return status;
  }
}

function displayName(id: string, users: Map<string, string>): string {
  if (id.startsWith("u:")) return users.get(id.slice(2)) ?? id.slice(2);
  if (id.startsWith("g:")) return "Guest";
  return "Anonymous";
}

@Injectable()
export class LiveGamesService {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  private me(session: any): string {
    const uid = session?.userId;
    if (typeof uid !== "string" || !uid) throw new UnauthorizedException("Sign in to see your games");
    return `u:${uid}`;
  }

  private async myGames(me: string): Promise<GameDoc[]> {
    return (await this.conn.db!
      .collection("live_games")
      .find({ $or: [{ "players.white": me }, { "players.black": me }], status: { $ne: "aborted" } })
      .sort({ finishedAt: -1 })
      .limit(MAX_HISTORY)
      .toArray()) as unknown as GameDoc[];
  }

  private async names(ids: string[]): Promise<Map<string, string>> {
    const userIds = Array.from(new Set(ids.filter((i) => i.startsWith("u:")).map((i) => i.slice(2))));
    const out = new Map<string, string>();
    if (!userIds.length) return out;
    const rows = await this.conn.db!
      .collection("users")
      .find({ _id: { $in: userIds as any } }, { projection: { username: 1 } })
      .toArray();
    for (const r of rows) out.set(String(r._id), (r as any).username || String(r._id));
    return out;
  }

  private summarize(g: GameDoc, me: string, users: Map<string, string>): GameSummary {
    const myColor: Color = g.players.white === me ? "white" : "black";
    const oppId = (myColor === "white" ? g.players.black : g.players.white) ?? "anon:";
    const outcome = outcomeFor(g.result, myColor);
    const mine = g.rating?.[myColor] ?? null;
    const theirs = g.rating?.[myColor === "white" ? "black" : "white"] ?? null;
    const started = new Date(g.startedAt);
    const finished = new Date(g.finishedAt);
    return {
      id: g._id,
      startedAt: started.toISOString(),
      finishedAt: finished.toISOString(),
      durationMs: Math.max(0, finished.getTime() - started.getTime()),
      speed: g.speed,
      timeControl: g.timeControl,
      rated: !!g.rated,
      myColor,
      opponent: { id: oppId, name: displayName(oppId, users) },
      result: g.result,
      status: g.status,
      outcome,
      reasonText: reasonFor(g.status, outcome),
      plies: g.moves?.length ?? 0,
      ratingBefore: mine ? Math.round(mine.before) : null,
      ratingAfter: mine ? Math.round(mine.after) : null,
      ratingDiff: mine ? Math.round(mine.after - mine.before) : null,
      opponentRating: theirs ? Math.round(theirs.before) : null,
    };
  }

  async list(session: any, q: { speed?: string; outcome?: string; rated?: string; offset?: string; limit?: string }) {
    const me = this.me(session);
    const all = await this.myGames(me);
    const users = await this.names(all.flatMap((g) => [g.players.white ?? "", g.players.black ?? ""]));
    let items = all.map((g) => this.summarize(g, me, users));
    if (q.speed && (SPEEDS as string[]).includes(q.speed)) items = items.filter((i) => i.speed === q.speed);
    if (q.outcome === "win" || q.outcome === "loss" || q.outcome === "draw") items = items.filter((i) => i.outcome === q.outcome);
    if (q.rated === "1") items = items.filter((i) => i.rated);
    if (q.rated === "0") items = items.filter((i) => !i.rated);
    const offset = Math.max(0, Number(q.offset) || 0);
    const limit = Math.min(50, Math.max(1, Number(q.limit) || 30));
    return { total: items.length, offset, items: items.slice(offset, offset + limit) };
  }

  async stats(session: any) {
    const me = this.me(session);
    const all = await this.myGames(me);
    const users = await this.names(all.flatMap((g) => [g.players.white ?? "", g.players.black ?? ""]));
    const items = all.map((g) => this.summarize(g, me, users));
    const perfDoc = (await this.conn.db!.collection("live_perfs").findOne({ _id: me as any })) as Record<string, { gl?: { r: number; d: number }; nb?: number }> | null;

    const bySpeed: Record<Speed, { games: number; wins: number; losses: number; draws: number; rating: number | null; provisional: boolean; history: { t: string; r: number }[] }> = {
      bullet: { games: 0, wins: 0, losses: 0, draws: 0, rating: null, provisional: true, history: [] },
      blitz: { games: 0, wins: 0, losses: 0, draws: 0, rating: null, provisional: true, history: [] },
      rapid: { games: 0, wins: 0, losses: 0, draws: 0, rating: null, provisional: true, history: [] },
      classical: { games: 0, wins: 0, losses: 0, draws: 0, rating: null, provisional: true, history: [] },
    };
    for (const s of SPEEDS) {
      const p = perfDoc?.[s]?.gl;
      if (p && (perfDoc?.[s]?.nb ?? 0) > 0) {
        bySpeed[s].rating = Math.round(p.r);
        bySpeed[s].provisional = p.d > PROVISIONAL_D;
      }
    }
    let wins = 0, losses = 0, draws = 0, totalMs = 0, asWhite = 0, whiteWins = 0, asBlack = 0, blackWins = 0, plies = 0;
    let bestWin: { opponent: string; rating: number; id: string } | null = null;
    // items are newest-first; walk oldest→newest for streaks and histories.
    const chrono = items.slice().reverse();
    let streak = 0, longest = 0, current = 0;
    for (const it of chrono) {
      const b = bySpeed[it.speed];
      b.games++;
      if (it.outcome === "win") { b.wins++; wins++; current++; longest = Math.max(longest, current); }
      else { current = 0; if (it.outcome === "loss") { b.losses++; losses++; } else { b.draws++; draws++; } }
      if (it.rated && it.ratingAfter !== null) b.history.push({ t: it.finishedAt, r: it.ratingAfter });
      totalMs += it.durationMs;
      plies += it.plies;
      if (it.myColor === "white") { asWhite++; if (it.outcome === "win") whiteWins++; }
      else { asBlack++; if (it.outcome === "win") blackWins++; }
      if (it.outcome === "win" && it.rated && it.opponentRating !== null && (!bestWin || it.opponentRating > bestWin.rating)) {
        bestWin = { opponent: it.opponent.name, rating: it.opponentRating, id: it.id };
      }
    }
    streak = current; // wins in a row ending at the most recent game
    for (const s of SPEEDS) bySpeed[s].history = bySpeed[s].history.slice(-40);
    const games = items.length;
    return {
      games,
      wins,
      losses,
      draws,
      winRate: games ? Math.round((wins / games) * 100) : 0,
      currentStreak: streak,
      longestStreak: longest,
      totalMs,
      avgPlies: games ? Math.round(plies / games) : 0,
      colors: { white: { games: asWhite, wins: whiteWins }, black: { games: asBlack, wins: blackWins } },
      bestWin,
      bySpeed,
      form: items.slice(0, 10).map((i) => i.outcome),
      lastPlayedAt: items[0]?.finishedAt ?? null,
    };
  }

  async get(session: any, id: string) {
    const me = this.me(session);
    const g = (await this.conn.db!.collection("live_games").findOne({ _id: id as any })) as unknown as GameDoc | null;
    if (!g) throw new NotFoundException("Game not found");
    if (g.players.white !== me && g.players.black !== me) throw new NotFoundException("Game not found");
    const users = await this.names([g.players.white ?? "", g.players.black ?? ""]);
    const summary = this.summarize(g, me, users);

    // Replay data: SAN, FEN after every ply, check flags and the clock each side
    // had left after its move (initial − think time + increment, per the
    // engine's per-move moveTimes).
    const chess = new Chess(g.initialFen);
    const sans: string[] = [];
    const fens: string[] = [chess.fen()];
    const checks: boolean[] = [chess.inCheck()];
    const clocks: { white: number; black: number }[] = [{ white: g.timeControl.initial, black: g.timeControl.initial }];
    let white = g.timeControl.initial, black = g.timeControl.initial;
    const times = g.moveTimes ?? [];
    for (let i = 0; i < g.moves.length; i++) {
      const uci = g.moves[i]!;
      const mover = chess.turn();
      try {
        const mv = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci.slice(4) : undefined });
        sans.push(mv.san);
      } catch {
        sans.push(uci);
      }
      const spent = times[i] ?? 0;
      if (mover === "w") white = Math.max(0, white - spent) + g.timeControl.increment;
      else black = Math.max(0, black - spent) + g.timeControl.increment;
      fens.push(chess.fen());
      checks.push(chess.inCheck());
      clocks.push({ white, black });
    }
    const whiteName = displayName(g.players.white ?? "anon:", users);
    const blackName = displayName(g.players.black ?? "anon:", users);
    const date = new Date(g.startedAt);
    const pgnMoves = sans.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${s}` : s)).join(" ");
    const tc = `${Math.round(g.timeControl.initial / 1000)}+${Math.round(g.timeControl.increment / 1000)}`;
    const pgn =
      `[Event "ChessGuru ${g.rated ? "rated" : "casual"} ${g.speed} game"]\n[Site "chessguru.cc"]\n` +
      `[Date "${date.toISOString().slice(0, 10).replace(/-/g, ".")}"]\n[White "${whiteName}"]\n[Black "${blackName}"]\n` +
      `[Result "${g.result ?? "*"}"]\n[TimeControl "${tc}"]\n[Termination "${g.status}"]\n\n${pgnMoves} ${g.result ?? "*"}\n`;
    return {
      ...summary,
      players: { white: { id: g.players.white, name: whiteName }, black: { id: g.players.black, name: blackName } },
      initialFen: g.initialFen,
      moves: g.moves,
      moveTimes: times,
      sans,
      fens,
      checks,
      clocks,
      rating: g.rating ?? null,
      pgn,
    };
  }
}
