// My Games — import a student's played games, run Stockfish server-side,
// extract mistakes, classify them. Feeds Slice 4's weakness dashboard.
//
// Import sources:
//   - PGN paste (any number of games in one blob)
//   - Lichess by username (public API, no auth)
//   - Chess.com by username (public API, no auth)
//
// Analysis is ASYNC — the import endpoint returns fast with games marked
// "queued", a background poller (setInterval) picks them up, runs Stockfish,
// stores per-ply evals + mistakes into `myGameAnalysis`. Concurrency 1.
//
// Mistake thresholds (in centipawns, from mover's perspective):
//   blunder     ≥ 300cp loss
//   mistake     150–299cp loss
//   inaccuracy   70–149cp loss

import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  UnauthorizedException,
} from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { randomBytes } from "crypto";
import { Chess } from "chess.js";
import { Stockfish, toWhiteCp } from "./stockfish";
import { classify, type MistakeTag } from "./classifier";

const MAX_PLY_ANALYZE = 200;   // don't analyze insanely long games
const ANALYSIS_DEPTH = 15;
const POLL_INTERVAL_MS = 8000;

function shortId(bytes = 8): string { return randomBytes(bytes).toString("base64url"); }

export type MistakeSeverity = "blunder" | "mistake" | "inaccuracy";

export interface PlyAnalysis {
  ply: number;
  san: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
  cpBefore: number;         // white perspective
  cpAfter: number;          // white perspective (after played move)
  bestUci: string | null;
  bestSan: string | null;
  isMistake: boolean;
  severity?: MistakeSeverity;
  tag?: MistakeTag;
  explanation?: string;
  ourColor: "white" | "black";  // who moved on this ply
}

export interface MyGameDoc {
  _id: string;
  ownerId: string;
  academyId: string | null;
  source: "pgn" | "lichess" | "chesscom" | "chessguru";
  externalId?: string;      // dedupe key (source + external game id)
  white: string;
  black: string;
  event?: string;
  date?: string;
  result: string;           // "1-0" | "0-1" | "1/2-1/2" | "*"
  pgn: string;
  ourColor: "white" | "black" | "both";  // which side is "the student"
  status: "queued" | "analyzing" | "done" | "failed";
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AnalysisDoc {
  _id: string;              // same as gameId
  gameId: string;
  ownerId: string;
  plies: PlyAnalysis[];
  mistakeCounts: Record<MistakeSeverity, number>;
  tagCounts: Record<string, number>;   // partial by MistakeTag
  updatedAt: Date;
}

@Injectable()
export class MyGamesService implements OnModuleInit, OnModuleDestroy {
  private ticking = false;
  private timer: any = null;
  private live: Stockfish | null = null;
  private shuttingDown = false;

  constructor(@InjectConnection() private readonly conn: Connection) {}

  private games() { return this.conn.db!.collection<MyGameDoc>("myGames"); }
  private analysis() { return this.conn.db!.collection<AnalysisDoc>("myGameAnalysis"); }

  onModuleInit() {
    // Poll for queued games every 8s. Serial — one Stockfish at a time.
    this.timer = setInterval(() => this.tick().catch((e) => console.error("[my-games] tick error:", e?.message || e)), POLL_INTERVAL_MS);
    // First tick a bit sooner so imports feel snappy in dev.
    setTimeout(() => this.tick().catch(() => null), 2000);
  }

  async onModuleDestroy() {
    this.shuttingDown = true;
    if (this.timer) clearInterval(this.timer);
    if (this.live) { try { await this.live.stop(); } catch {} }
  }

  private ensureUser(session: any): { userId: string; academyId: string | null } {
    const userId = session?.userId;
    if (!userId) throw new UnauthorizedException("sign in first");
    return { userId: String(userId), academyId: session?.academyId ?? null };
  }

  /* ─── list / delete ────────────────────────────────────────────────── */

  async list(session: any) {
    const { userId } = this.ensureUser(session);
    const items = await this.games()
      .find({ ownerId: userId }, { projection: { pgn: 0 } })
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray();
    return { items };
  }

  async get(session: any, gameId: string) {
    const { userId } = this.ensureUser(session);
    const game = await this.games().findOne({ _id: gameId, ownerId: userId });
    if (!game) throw new NotFoundException("no such game");
    const analysis = await this.analysis().findOne({ _id: gameId });
    return { game, analysis };
  }

  async remove(session: any, gameId: string) {
    const { userId } = this.ensureUser(session);
    const r = await this.games().deleteOne({ _id: gameId, ownerId: userId });
    if (!r.deletedCount) throw new NotFoundException("no such game");
    await this.analysis().deleteOne({ _id: gameId });
    return { ok: true };
  }

  /** Aggregate mistake counts by tag across all my analyzed games — feeds
   *  Slice 4's weakness dashboard (called by Slice 4 directly). */
  async weaknessSummary(session: any) {
    const { userId } = this.ensureUser(session);
    const rows = await this.analysis().find({ ownerId: userId }).toArray();
    const tagCounts: Record<string, number> = {};
    let totalMistakes = 0;
    let totalBlunders = 0;
    let totalInaccuracies = 0;
    let gamesAnalyzed = rows.length;
    for (const r of rows) {
      for (const [tag, n] of Object.entries(r.tagCounts || {})) {
        tagCounts[tag] = (tagCounts[tag] || 0) + (n as number);
      }
      totalBlunders += r.mistakeCounts?.blunder || 0;
      totalMistakes += r.mistakeCounts?.mistake || 0;
      totalInaccuracies += r.mistakeCounts?.inaccuracy || 0;
    }
    return { gamesAnalyzed, totalBlunders, totalMistakes, totalInaccuracies, tagCounts };
  }

  /* ─── import: PGN paste ────────────────────────────────────────────── */

  async importPgn(session: any, body: any) {
    const { userId, academyId } = this.ensureUser(session);
    const b: any = body ?? {};
    const pgn = String(b.pgn || "").trim();
    if (!pgn) throw new BadRequestException("pgn required");
    const asColor: "white" | "black" | "both" = ["white", "black", "both"].includes(b.ourColor) ? b.ourColor : "both";
    // Split multi-game PGN by [Event ... blocks.
    const games = this.splitPgn(pgn);
    if (games.length === 0) throw new BadRequestException("no games parsed");

    const inserted: string[] = [];
    for (const one of games) {
      const parsed = this.parseOneGame(one);
      if (!parsed) continue;
      const now = new Date();
      const id = shortId(10);
      await this.games().insertOne({
        _id: id,
        ownerId: userId,
        academyId,
        source: "pgn",
        white: parsed.white,
        black: parsed.black,
        event: parsed.event,
        date: parsed.date,
        result: parsed.result,
        pgn: one,
        ourColor: asColor === "both" ? this.guessColorForUser(parsed, "") : asColor,
        status: "queued",
        createdAt: now,
        updatedAt: now,
      });
      inserted.push(id);
    }
    return { imported: inserted.length, gameIds: inserted };
  }

  /* ─── import: Lichess ─────────────────────────────────────────────── */

  async importLichess(session: any, body: any) {
    const { userId, academyId } = this.ensureUser(session);
    const username = String(body?.username || "").trim();
    if (!username) throw new BadRequestException("username required");
    const max = Math.max(1, Math.min(50, Number(body?.max) || 10));
    // Public games export: https://lichess.org/api/games/user/<name>?max=N&pgnInJson=false
    const url = `https://lichess.org/api/games/user/${encodeURIComponent(username)}?max=${max}&clocks=false&evals=false&opening=true`;
    let text: string;
    try {
      const r = await fetch(url, { headers: { Accept: "application/x-chess-pgn" } });
      if (!r.ok) throw new Error(`Lichess API ${r.status}`);
      text = await r.text();
    } catch (e: any) {
      throw new BadRequestException("Lichess fetch failed: " + (e?.message || e));
    }
    const games = this.splitPgn(text);
    const inserted: string[] = [];
    for (const one of games) {
      const parsed = this.parseOneGame(one);
      if (!parsed) continue;
      const extId = `lichess:${(parsed as any).headers?.LichessURL || (parsed as any).headers?.Site || one.slice(0, 40)}`;
      // Dedupe on external id
      const already = await this.games().findOne({ ownerId: userId, externalId: extId }, { projection: { _id: 1 } });
      if (already) continue;
      const now = new Date();
      const id = shortId(10);
      await this.games().insertOne({
        _id: id,
        ownerId: userId,
        academyId,
        source: "lichess",
        externalId: extId,
        white: parsed.white,
        black: parsed.black,
        event: parsed.event,
        date: parsed.date,
        result: parsed.result,
        pgn: one,
        ourColor: this.guessColorForUser(parsed, username),
        status: "queued",
        createdAt: now,
        updatedAt: now,
      });
      inserted.push(id);
    }
    return { imported: inserted.length, gameIds: inserted };
  }

  /* ─── import: Chess.com ───────────────────────────────────────────── */

  async importChesscom(session: any, body: any) {
    const { userId, academyId } = this.ensureUser(session);
    const username = String(body?.username || "").trim().toLowerCase();
    if (!username) throw new BadRequestException("username required");
    const max = Math.max(1, Math.min(50, Number(body?.max) || 10));
    // Chess.com public API returns games by month. Fetch the two most recent months to get ~most recent games.
    const now = new Date();
    const months: { y: number; m: number }[] = [
      { y: now.getFullYear(), m: now.getMonth() + 1 },
      { y: now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear(), m: now.getMonth() === 0 ? 12 : now.getMonth() },
    ];
    let allGames: any[] = [];
    for (const { y, m } of months) {
      const url = `https://api.chess.com/pub/player/${encodeURIComponent(username)}/games/${y}/${String(m).padStart(2, "0")}`;
      try {
        const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "ChessGuru" } });
        if (!r.ok) continue;
        const j = (await r.json()) as any;
        allGames.push(...(j?.games || []));
      } catch { /* keep going */ }
    }
    allGames = allGames.slice(-max);
    const inserted: string[] = [];
    for (const g of allGames) {
      if (!g?.pgn) continue;
      const parsed = this.parseOneGame(g.pgn);
      if (!parsed) continue;
      const extId = `chesscom:${g.uuid || g.url || parsed.date + parsed.white + parsed.black}`;
      const already = await this.games().findOne({ ownerId: userId, externalId: extId }, { projection: { _id: 1 } });
      if (already) continue;
      const created = new Date();
      const id = shortId(10);
      await this.games().insertOne({
        _id: id,
        ownerId: userId,
        academyId,
        source: "chesscom",
        externalId: extId,
        white: parsed.white,
        black: parsed.black,
        event: parsed.event,
        date: parsed.date,
        result: parsed.result,
        pgn: g.pgn,
        ourColor: this.guessColorForUser(parsed, username),
        status: "queued",
        createdAt: created,
        updatedAt: created,
      });
      inserted.push(id);
    }
    return { imported: inserted.length, gameIds: inserted };
  }

  /* ─── background analyzer ──────────────────────────────────────────── */

  private async tick() {
    if (this.ticking || this.shuttingDown) return;
    this.ticking = true;
    try {
      const next = await this.games().findOne({ status: "queued" }, { sort: { createdAt: 1 } });
      if (!next) return;
      await this.games().updateOne({ _id: next._id }, { $set: { status: "analyzing", updatedAt: new Date() } });
      try {
        await this.analyzeGame(next);
        await this.games().updateOne({ _id: next._id }, { $set: { status: "done", updatedAt: new Date() } });
      } catch (e: any) {
        console.error(`[my-games] analyze ${next._id} failed:`, e?.message || e);
        await this.games().updateOne({ _id: next._id }, { $set: { status: "failed", error: String(e?.message || e).slice(0, 400), updatedAt: new Date() } });
      }
    } finally {
      this.ticking = false;
    }
  }

  private async analyzeGame(game: MyGameDoc) {
    // Parse to get main-line moves
    const chess = new Chess();
    try { chess.loadPgn(game.pgn, { strict: false }); }
    catch (e: any) { throw new Error("bad PGN: " + e?.message); }
    const history = chess.history({ verbose: true }) as any[];
    if (history.length === 0) throw new Error("empty game");

    // Boot a Stockfish for this game
    if (this.live) { try { await this.live.stop(); } catch {} this.live = null; }
    this.live = new Stockfish();
    await this.live.start();

    const plies: PlyAnalysis[] = [];
    const mistakeCounts: Record<MistakeSeverity, number> = { blunder: 0, mistake: 0, inaccuracy: 0 };
    const tagCounts: Record<string, number> = {};

    const replay = new Chess();
    let prevWhiteCp: number | null = null;
    for (let i = 0; i < Math.min(history.length, MAX_PLY_ANALYZE); i++) {
      if (this.shuttingDown) break;
      const h = history[i];
      const fenBefore = replay.fen();
      const sideToMove: "white" | "black" = replay.turn() === "w" ? "white" : "black";

      // 1. Eval BEFORE the move (find best move + eval from side-to-move perspective)
      const evalBefore = await this.live.analyze(fenBefore, ANALYSIS_DEPTH);
      const bestUci = evalBefore.bestMoveUci;
      const cpBefore = toWhiteCp(evalBefore, sideToMove);

      // Apply the actually-played move
      const played = replay.move({ from: h.from, to: h.to, promotion: h.promotion });
      if (!played) break;
      const fenAfter = replay.fen();
      const playedUci = played.from + played.to + (played.promotion || "");

      // 2. Eval AFTER the move (from opponent perspective; convert to white perspective)
      const evalAfter = await this.live.analyze(fenAfter, ANALYSIS_DEPTH);
      const cpAfter = toWhiteCp(evalAfter, sideToMove === "white" ? "black" : "white");

      // Was this ply a mistake for the mover?
      // Positive swing (from mover perspective) = mover got WORSE.
      const moverPovBefore = sideToMove === "white" ? cpBefore : -cpBefore;
      const moverPovAfter = sideToMove === "white" ? cpAfter : -cpAfter;
      const drop = moverPovBefore - moverPovAfter;

      let severity: MistakeSeverity | undefined;
      if (drop >= 300) severity = "blunder";
      else if (drop >= 150) severity = "mistake";
      else if (drop >= 70) severity = "inaccuracy";

      const isOurMove = game.ourColor === "both" || game.ourColor === sideToMove;
      const isMistake = !!severity && isOurMove; // only tag OUR mistakes (opponent's don't teach us)

      let tag: MistakeTag | undefined;
      let explanation: string | undefined;
      let bestSan: string | null = null;
      if (isMistake && bestUci) {
        try {
          const bestBoard = new Chess(fenBefore);
          const bestMove = bestBoard.move({ from: bestUci.slice(0, 2), to: bestUci.slice(2, 4), promotion: bestUci.slice(4) || undefined } as any);
          if (bestMove) bestSan = bestMove.san;
          const r = classify({
            fenBefore,
            playedUci,
            bestUci,
            fenAfterPlayed: fenAfter,
            fenAfterBest: bestBoard.fen(),
            mateInBest: evalBefore.mate,
            ply: i + 1,
          });
          tag = r.tag;
          explanation = r.explanation;
          mistakeCounts[severity!] += 1;
          tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        } catch { /* keep as untagged mistake */ }
      } else if (bestUci) {
        try {
          const bestBoard = new Chess(fenBefore);
          const bestMove = bestBoard.move({ from: bestUci.slice(0, 2), to: bestUci.slice(2, 4), promotion: bestUci.slice(4) || undefined } as any);
          if (bestMove) bestSan = bestMove.san;
        } catch { /* ignore */ }
      }

      plies.push({
        ply: i + 1,
        san: played.san,
        uci: playedUci,
        fenBefore,
        fenAfter,
        cpBefore,
        cpAfter,
        bestUci,
        bestSan,
        isMistake,
        severity,
        tag,
        explanation,
        ourColor: sideToMove,
      });
      prevWhiteCp = cpAfter;
    }

    await this.live.stop();
    this.live = null;

    await this.analysis().updateOne(
      { _id: game._id },
      { $set: { _id: game._id, gameId: game._id, ownerId: game.ownerId, plies, mistakeCounts, tagCounts, updatedAt: new Date() } },
      { upsert: true },
    );
  }

  /* ─── helpers ─────────────────────────────────────────────────────── */

  /** Very tolerant PGN splitter — chunks by [Event ... blocks. */
  private splitPgn(blob: string): string[] {
    const lines = blob.split(/\r?\n/);
    const out: string[] = [];
    let cur: string[] = [];
    for (const line of lines) {
      if (line.startsWith("[Event ") && cur.some((l) => l.trim())) {
        out.push(cur.join("\n").trim());
        cur = [line];
      } else {
        cur.push(line);
      }
    }
    if (cur.some((l) => l.trim())) out.push(cur.join("\n").trim());
    return out.filter((s) => /\S/.test(s));
  }

  private parseOneGame(pgn: string): { white: string; black: string; event?: string; date?: string; result: string; headers: Record<string, string> } | null {
    const g = new Chess();
    try { g.loadPgn(pgn, { strict: false }); } catch { return null; }
    const headers = ((g as any).header?.() || {}) as Record<string, string>;
    return {
      white: headers.White || "?",
      black: headers.Black || "?",
      event: headers.Event || undefined,
      date: headers.Date || undefined,
      result: headers.Result || "*",
      headers,
    };
  }

  private guessColorForUser(parsed: { white: string; black: string }, username: string): "white" | "black" | "both" {
    if (!username) return "both";
    const u = username.toLowerCase();
    if (parsed.white.toLowerCase() === u) return "white";
    if (parsed.black.toLowerCase() === u) return "black";
    return "both";
  }
}
