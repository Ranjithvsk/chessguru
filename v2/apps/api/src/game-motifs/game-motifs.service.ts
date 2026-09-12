// Academy "game awards" — every finished live game of an academy member is walked with Stockfish;
// at each of the member's moves the engine's best line is tagged with the puzzle motif tagger
// (engine-battle/cook.js: fork, pin, skewer, mate patterns, deflection…). Playing the best move (or
// one as good) = the motif was FOUND (+points); playing something ≥ 1 pawn worse while a tactic was
// on the board = MISSED (−points). Points per motif live in MOTIF_POINTS. Feeds the academy
// leaderboard at /academy/game-awards. Owner 2026-09-12: "award them for finding good moves, like
// fork, pin, mate, all the motifs, and a negative score for the missed ones".
import { Injectable, OnModuleInit, OnModuleDestroy, ForbiddenException, UnauthorizedException, NotFoundException } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { Chess } from "chess.js";
import { createRequire } from "module";
import { Stockfish, toWhiteCp, type PositionEval } from "../my-games/stockfish";
import { strategicTags, nullMoveFen, gameCharacter, STRATEGIC_POINTS, STRATEGIC_LABEL, STRATEGIC_ORDER, isEndgame } from "./strategic";
import { OpeningBook, OpeningTally, OPENING_PLIES, OPENING_POINTS, OPENING_LABEL } from "./opening";

const require_ = createRequire(__filename);
const COOK_PATH = `${process.env.HOME || "/home/ubuntu"}/chessguru/engine-battle/cook.js`;
type CookFn = (fen: string, moves: string[], pov: "white" | "black") => Set<string> | string[];
let cookFn: CookFn | null = null;
function cook(fen: string, moves: string[], pov: "white" | "black"): string[] {
  try {
    if (!cookFn) cookFn = (require_(COOK_PATH) as { cook: CookFn }).cook;
    const r = cookFn(fen, moves, pov);
    return Array.from(r instanceof Set ? r : r ?? []);
  } catch { return []; }
}

const DEPTH = 12;                 // per position, capped by MOVETIME_MS — a 150-ply game stays under ~20 s
const MOVETIME_MS = 120;
const PARALLEL = 2;               // two engines side by side; the box has 8 cores and the other analyzer uses one
const POLL_MS = 20_000;
const EVAL_TIMEOUT_MS = 15_000;   // a position that takes longer than this means the engine is gone — drop it, retry the game later
const TICK_MAX_MS = 4 * 60_000;   // a tick older than this is stuck (engine hung without a reply) — reset and start over
const LOOKBACK_DAYS = 45;
const TACTIC_MIN_GAIN_CP = 150;   // best line must be worth this much more than the played move to count as a missed tactic
const FOUND_TOLERANCE_CP = 30;    // played move within this of the best = found
// A "found" only counts when a tactic actually APPEARED: the position swung at least this much in
// the student's favour on the opponent's last move (they blundered, and the student had to see it),
// or the best line mates. Without this, every routine best move in the opening scored as a fork.
const OPPORTUNITY_MIN_CP = 120;
const PV_PLIES_FOR_TAGS = 5;      // tag the tactic from the first plies of the best line, not the whole PV
// Only real tactical motifs score. Style/plan tags from the tagger (quiet move, kingside attack,
// castling, advanced pawn…) describe a line, not a tactic the student found or missed.
const SCORING_TAGS = new Set(["fork", "pin", "skewer", "discoveredAttack", "discoveredCheck", "doubleCheck", "xRayAttack", "hangingPiece", "capturingDefender", "trappedPiece", "deflection", "attraction", "sacrifice", "interference", "clearance", "zugzwang", "promotion", "underPromotion", "enPassant", "intermezzo"]);
const isMateTag = (t: string) => t === "mate" || /Mate$/.test(t) || /^mateIn\d$/.test(t);
// The tagger names everything it can see in a line; a student is awarded ONE motif per moment —
// the most specific. Named mates first, then the classic tactics, then the supporting ideas.
const MOTIF_ORDER = ["smotheredMate", "anastasiaMate", "arabianMate", "bodenMate", "doubleBishopMate", "dovetailMate", "hookMate", "vukovicMate", "killBoxMate", "morphysMate", "operaMate", "pillsburysMate", "balestraMate", "blindSwineMate", "epauletteMate", "swallowstailMate", "triangleMate", "backRankMate", "cornerMate", "mateIn1", "mateIn2", "mateIn3", "mateIn4", "mateIn5", "mate", "underPromotion", "promotion", "fork", "skewer", "pin", "discoveredCheck", "doubleCheck", "discoveredAttack", "deflection", "attraction", "sacrifice", "capturingDefender", "trappedPiece", "hangingPiece", "xRayAttack", "interference", "clearance", "zugzwang", "enPassant", "intermezzo"];
const rankOf = (t: string) => { const i = MOTIF_ORDER.indexOf(t); return i < 0 ? 999 : i; };

// Points for finding a motif; a miss costs half (rounded up). Mates weigh most.
export const MOTIF_POINTS: Record<string, number> = {
  mate: 6, mateIn1: 6, mateIn2: 7, mateIn3: 8, mateIn4: 8, mateIn5: 8,
  backRankMate: 6, smotheredMate: 8, anastasiaMate: 8, arabianMate: 8, bodenMate: 8, doubleBishopMate: 8, dovetailMate: 8, hookMate: 8,
  vukovicMate: 8, killBoxMate: 8, morphysMate: 8, operaMate: 8, pillsburysMate: 8, balestraMate: 8, blindSwineMate: 8, cornerMate: 6,
  epauletteMate: 8, swallowstailMate: 8, triangleMate: 8,
  fork: 3, pin: 3, skewer: 3, discoveredAttack: 3, discoveredCheck: 3, doubleCheck: 4, xRayAttack: 3,
  hangingPiece: 2, capturingDefender: 3, trappedPiece: 3, deflection: 4, attraction: 4, sacrifice: 4, interference: 4, clearance: 4,
  intermezzo: 4, zugzwang: 5, quietMove: 3, promotion: 3, underPromotion: 5, defensiveMove: 2, exposedKing: 2, kingsideAttack: 2,
  queensideAttack: 2, attackingF2F7: 2, advancedPawn: 2, enPassant: 2, castling: 1,
};
// Tags that describe a line's SHAPE, not a tactic — never award or penalise these on their own.
const SHAPE_TAGS = new Set(["oneMove", "short", "long", "veryLong", "checkFirst", "collinearMove", "equality", "advantage", "crushing", "opening", "middlegame", "endgame", "master", "superGM", "rookEndgame", "bishopEndgame", "knightEndgame", "queenEndgame", "pawnEndgame", "queenRookEndgame"]);
export const MOTIF_LABEL: Record<string, string> = {
  fork: "Fork", pin: "Pin", skewer: "Skewer", discoveredAttack: "Discovered attack", discoveredCheck: "Discovered check", doubleCheck: "Double check",
  xRayAttack: "X-ray", hangingPiece: "Hanging piece", capturingDefender: "Capturing the defender", trappedPiece: "Trapped piece", deflection: "Deflection",
  attraction: "Attraction", sacrifice: "Sacrifice", interference: "Interference", clearance: "Clearance", intermezzo: "Intermezzo", zugzwang: "Zugzwang",
  quietMove: "Quiet move", promotion: "Promotion", underPromotion: "Under-promotion", defensiveMove: "Defence", exposedKing: "Exposed king",
  kingsideAttack: "Kingside attack", queensideAttack: "Queenside attack", attackingF2F7: "f2/f7 attack", advancedPawn: "Advanced pawn", enPassant: "En passant",
  castling: "Castling", mate: "Mate", mateIn1: "Mate in 1", mateIn2: "Mate in 2", mateIn3: "Mate in 3", mateIn4: "Mate in 4", mateIn5: "Mate in 5",
  backRankMate: "Back-rank mate", smotheredMate: "Smothered mate", anastasiaMate: "Anastasia's mate", arabianMate: "Arabian mate", bodenMate: "Boden's mate",
  doubleBishopMate: "Double-bishop mate", dovetailMate: "Dovetail mate", hookMate: "Hook mate", vukovicMate: "Vukovic mate", killBoxMate: "Kill-box mate",
  morphysMate: "Morphy's mate", operaMate: "Opera mate", pillsburysMate: "Pillsbury's mate", balestraMate: "Balestra mate", blindSwineMate: "Blind-swine mate",
  cornerMate: "Corner mate", epauletteMate: "Epaulette mate", swallowstailMate: "Swallow's-tail mate", triangleMate: "Triangle mate",
};
const pointsFor = (motifs: string[]) => motifs.reduce((m, t) => Math.max(m, MOTIF_POINTS[t] ?? 0), 0);
// Positional layer (owner 2026-09-12): the engine-confirmed strategic ideas from strategic.ts. Extra
// null-move engine calls are spent only on players rated ≥ STRATEGIC_MIN_RATING (their games are
// where prophylaxis and zugzwang mean something); everyone gets the cheap board heuristics.
const STRATEGIC_MIN_RATING = 1400;
const STRATEGIC_LOSS_CP = 80;      // a positional miss is a smaller error than a tactical one
Object.assign(MOTIF_POINTS, STRATEGIC_POINTS, OPENING_POINTS);
Object.assign(MOTIF_LABEL, STRATEGIC_LABEL, OPENING_LABEL);
const OPENING_MISTAKE_CP = 80;     // out of book AND this much worse than the engine's move = wrong opening move
const OPENING_TRAP_CP = 250;       // a swing this large inside the opening = a trap (sprung or fallen into)

type LiveGame = { _id: string; players: { white: string; black: string }; moves: string[]; startedAt: Date; finishedAt?: Date; status: string; result?: string; speed?: string };
// One shape for every source: live arena games, PGNs imported under My Games, and the games pulled
// from a linked Lichess / Chess.com account (owner: "even games played in lichess or chess.com").
type GameSource = "live" | "my" | "lichess" | "chesscom";
type GameToScore = { key: string; source: GameSource; url: string | null; moves: string[]; white: string | null; black: string | null; at: Date; label: string };
type MotifEvent = {
  _id: string; gameId: string; ply: number; userId: string; academyId: string; color: "white" | "black";
  fen: string; bestUci: string; bestSan: string | null; playedUci: string; playedSan: string | null;
  found: boolean; motifs: string[]; primary: string; points: number; lossCp: number; mateIn: number | null; at: Date;
  source: GameSource; url: string | null; label: string;
};

@Injectable()
export class GameMotifsService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private tickStartedAt = 0;
  private shuttingDown = false;
  private engines: Array<Stockfish | null> = [];
  private bookInst: OpeningBook | null = null;
  private book(): OpeningBook { return (this.bookInst ??= new OpeningBook(this.col("openingpositions"), this.col("openingnames"))); }

  constructor(@InjectConnection() private readonly conn: Connection) {}

  private col<T extends Record<string, any> = any>(name: string) { return this.conn.db!.collection<T>(name); }
  private events() { return this.col<MotifEvent>("gameMotifEvents"); }
  private done() { return this.col<{ _id: string; academyIds: string[]; analyzedAt: Date; plies: number; events: number; error?: string }>("gameMotifGames"); }

  onModuleInit() {
    console.log(`[game-motifs] worker armed: every ${POLL_MS / 1000}s, ${PARALLEL} engines, depth ${DEPTH} / ${MOVETIME_MS} ms`);
    this.timer = setInterval(() => this.tick().catch((e) => console.error("[game-motifs] tick:", e?.message || e)), POLL_MS);
    setTimeout(() => this.tick().catch(() => null), 20_000);
  }
  async onModuleDestroy() {
    this.shuttingDown = true;
    if (this.timer) clearInterval(this.timer);
    for (const e of this.engines) if (e) { try { await e.stop(); } catch { /* */ } }
  }

  // ── which users belong to which academy ─────────────────────────────────────
  private async academyOf(userIds: string[]): Promise<Map<string, string>> {
    const rows = await this.col("users").find({ _id: { $in: userIds as never[] }, academyId: { $exists: true, $ne: null } }, { projection: { academyId: 1 } }).toArray();
    return new Map(rows.map((r: any) => [String(r._id), String(r.academyId)]));
  }
  private static uid(p: string | undefined): string | null { return p && p.startsWith("u:") ? p.slice(2) : null; }
  /** Best known rating for a user: arena (any speed), else puzzle Glicko, else 1500. */
  private async ratingOf(userId: string): Promise<number> {
    try {
      const lp: any = await this.col("live_perfs").findOne({ _id: `u:${userId}` as never });
      const rs = lp ? ["rapid", "blitz", "bullet", "classical"].map((k) => lp[k]?.gl?.r).filter((x) => typeof x === "number") : [];
      if (rs.length) return Math.max(...rs);
      const up: any = await this.col("userperfs").findOne({ _id: userId as never });
      const r = up?.puzzle?.gl?.r; if (typeof r === "number") return r;
    } catch { /* */ }
    return 1500;
  }
  private static pgnToUci(pgn: string): string[] {
    try {
      const c = new Chess(); c.loadPgn(pgn);
      return c.history({ verbose: true }).map((m) => m.from + m.to + (m.promotion ?? ""));
    } catch { return []; }
  }
  /** Which side a user played in an external game: the linked handle, case-insensitively. */
  private static colourFor(handle: string | null | undefined, white: string, black: string): "white" | "black" | null {
    const h = (handle ?? "").trim().toLowerCase(); if (!h) return null;
    if (h === String(white ?? "").trim().toLowerCase()) return "white";
    if (h === String(black ?? "").trim().toLowerCase()) return "black";
    return null;
  }
  private static externalUrl(source: string, id: string): string | null {
    if (source === "lichess") return `https://lichess.org/${id}`;
    if (source === "chesscom") return id.startsWith("http") ? id : null;
    return null;
  }

  /** Load one game from any source in the common shape (players as user ids, moves as UCI). */
  private async loadGame(key: string): Promise<GameToScore | null> {
    const [source, ...rest] = key.split(":"); const id = rest.join(":");
    if (source === "live") {
      const g = await this.col<LiveGame>("live_games").findOne({ _id: id as never });
      if (!g) return null;
      return { key, source: "live", url: `/play/games/${id}`, moves: g.moves ?? [], white: GameMotifsService.uid(g.players?.white), black: GameMotifsService.uid(g.players?.black), at: g.finishedAt ?? g.startedAt, label: `${(g.players?.white ?? "?").replace(/^u:/, "")} vs ${(g.players?.black ?? "?").replace(/^u:/, "")}` };
    }
    if (source === "my") {
      const g: any = await this.col("myGames").findOne({ _id: id as never });
      if (!g?.pgn) return null;
      const moves = GameMotifsService.pgnToUci(g.pgn);
      const our: "white" | "black" | null = g.ourColor === "white" || g.ourColor === "black" ? g.ourColor : null;
      const url = g.externalId && String(g.externalId).includes("http") ? String(g.externalId).replace(/^[a-z]+:/, "") : null;
      return { key, source: "my", url, moves, white: our === "white" ? String(g.ownerId) : null, black: our === "black" ? String(g.ownerId) : null, at: g.createdAt ?? new Date(), label: `${g.white ?? "?"} vs ${g.black ?? "?"}` };
    }
    if (source === "ext") {
      const g: any = await this.col("externalGames").findOne({ _id: id as never });
      if (!g?.pgn) return null;
      const u: any = await this.col("users").findOne({ _id: g.userId as never }, { projection: { linkedAccounts: 1 } });
      const handle = g.source === "lichess" ? u?.linkedAccounts?.lichess?.username : u?.linkedAccounts?.chesscom?.username;
      const our = GameMotifsService.colourFor(handle, g.white, g.black);
      const moves = GameMotifsService.pgnToUci(g.pgn);
      return { key, source: g.source === "chesscom" ? "chesscom" : "lichess", url: g.url ?? GameMotifsService.externalUrl(g.source, g.gameId), moves, white: our === "white" ? String(g.userId) : null, black: our === "black" ? String(g.userId) : null, at: g.played ? new Date(g.played) : (g.importedAt ?? new Date()), label: `${g.white ?? "?"} vs ${g.black ?? "?"}` };
    }
    return null;
  }

  /** Unscored games of academy members, newest first, across every source. */
  private async candidates(academyId: string | null, limit: number): Promise<Array<{ key: string; users: string[] }>> {
    const since = new Date(Date.now() - LOOKBACK_DAYS * 864e5);
    const memberQ: Record<string, unknown> = { academyId: { $exists: true, $ne: null } };
    if (academyId) memberQ.academyId = academyId;
    const members = await this.col("users").find(memberQ, { projection: { _id: 1 } }).toArray();
    const ids = members.map((m: any) => String(m._id)); if (!ids.length) return [];
    const uIds = ids.map((i) => `u:${i}`);
    const out: Array<{ key: string; users: string[]; at: Date }> = [];
    // Fetch a wide window per source and drop the scored ones AFTER — limiting each query to
    // `limit` first meant the two newest (already scored) games came back every tick and the
    // worker reported "nothing to score" while 350 games waited (2026-09-12 17:45).
    const scan = Math.max(limit, 400);
    const live = await this.col<LiveGame>("live_games").find({ startedAt: { $gte: since }, status: { $nin: ["started", "aborted"] }, "moves.10": { $exists: true }, $or: [{ "players.white": { $in: uIds } }, { "players.black": { $in: uIds } }] }, { projection: { players: 1, startedAt: 1 } }).sort({ startedAt: -1 }).limit(scan).toArray();
    for (const g of live) out.push({ key: `live:${g._id}`, users: [GameMotifsService.uid(g.players?.white), GameMotifsService.uid(g.players?.black)].filter((x): x is string => !!x && ids.includes(x)), at: g.startedAt });
    const my = await this.col("myGames").find({ ownerId: { $in: ids }, createdAt: { $gte: since }, pgn: { $exists: true } }, { projection: { ownerId: 1, createdAt: 1 } }).sort({ createdAt: -1 }).limit(scan).toArray();
    for (const g of my as any[]) out.push({ key: `my:${g._id}`, users: [String(g.ownerId)], at: g.createdAt ? new Date(g.createdAt) : new Date() });
    const ext = await this.col("externalGames").find({ userId: { $in: ids }, $or: [{ played: { $gte: since } }, { played: { $gte: since.toISOString() } }] }, { projection: { userId: 1, played: 1 } }).sort({ played: -1 }).limit(scan).toArray();
    for (const g of ext as any[]) out.push({ key: `ext:${g._id}`, users: [String(g.userId)], at: g.played ? new Date(g.played) : new Date() });
    const retryBefore = new Date(Date.now() - 3600_000);
    const doneIds = new Set((await this.done().find({ _id: { $in: out.map((o) => o.key) as never[] }, $or: [{ error: { $exists: false } }, { analyzedAt: { $gte: retryBefore } }] }, { projection: { _id: 1 } }).toArray()).map((d) => d._id));
    return out.filter((o) => !doneIds.has(o.key)).sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
  }

  // ── worker ──────────────────────────────────────────────────────────────────
  private async tick() {
    if (this.shuttingDown) return;
    if (this.ticking) {
      // 17:18 UTC 2026-09-12: two engines answered nothing after a restart and the worker sat on
      // `ticking` for good. Self-heal: kill the engines, forget the tick, carry on.
      if (Date.now() - this.tickStartedAt > TICK_MAX_MS) {
        console.error("[game-motifs] tick stuck for >4 min — resetting engines");
        for (let i = 0; i < this.engines.length; i++) await this.dropEngine(i);
        this.ticking = false;
      } else return;
    }
    this.ticking = true; this.tickStartedAt = Date.now();
    try {
      const batch = await this.candidates(null, PARALLEL);
      if (!batch.length) { console.log("[game-motifs] tick: nothing to score"); return; }
      console.log(`[game-motifs] tick: ${batch.map((b) => b.key).join(", ")}`);
      await Promise.all(batch.map(async (next, slot) => {
        const acad = await this.academyOf(next.users);
        if (!acad.size) { await this.done().updateOne({ _id: next.key }, { $set: { academyIds: [], analyzedAt: new Date(), plies: 0, events: 0 } }, { upsert: true }); return; }
        try { await this.analyzeGame(next.key, acad, slot); }
        catch (e: any) {
          console.error(`[game-motifs] ${next.key}:`, e?.message || e);
          await this.done().updateOne({ _id: next.key }, { $set: { academyIds: [], analyzedAt: new Date(), plies: 0, events: 0, error: String(e?.message || e).slice(0, 200) } }, { upsert: true });
        }
      }));
    } finally { this.ticking = false; }
  }

  private async getEngine(slot = 0): Promise<Stockfish> {
    if (!this.engines[slot]) { const e = new Stockfish(); await e.start(); this.engines[slot] = e; }
    return this.engines[slot]!;
  }
  private async dropEngine(slot: number) { const e = this.engines[slot]; this.engines[slot] = null; if (e) await e.stop().catch(() => null); }
  private async evalAt(engine: Stockfish, slot: number, fen: string): Promise<PositionEval> {
    let timer: NodeJS.Timeout | null = null;
    try {
      return await Promise.race([
        engine.analyze(fen, DEPTH, MOVETIME_MS),
        new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("engine did not answer within 15 s")), EVAL_TIMEOUT_MS); }),
      ]);
    } catch (e) { await this.dropEngine(slot); throw e; }
    finally { if (timer) clearTimeout(timer); }
  }

  /** Analyze one game for the tracked users (userId → academyId). Idempotent: replaces the game's events. */
  async analyzeGame(gameId: string, tracked: Map<string, string>, slot = 0): Promise<{ events: number; plies: number }> {
    const g = await this.loadGame(gameId);
    if (!g) throw new NotFoundException("game not found");
    const engine = await this.getEngine(slot);
    const board = new Chess();
    const events: MotifEvent[] = [];
    let cur: PositionEval;
    cur = await this.evalAt(engine, slot, board.fen());
    const moves = g.moves ?? [];
    let prevWhiteCp: number | null = null; // eval (white POV) BEFORE the opponent's last move — the baseline for "did a tactic appear?"
    const deep = new Map<string, boolean>(); // userId → run the null-move (prophylaxis / zugzwang) evals for them
    for (const uid of new Set([g.white, g.black].filter((x): x is string => !!x && tracked.has(x)))) deep.set(uid, (await this.ratingOf(uid)) >= STRATEGIC_MIN_RATING);
    const charStats: Record<string, { sacrifices: number; captures: number; plies: number; attackMoments: number; quietBest: number }> = {};
    const opening: Record<string, OpeningTally> = {};
    const book = this.book();
    for (let i = 0; i < moves.length; i++) {
      const sideToMove: "white" | "black" = board.turn() === "w" ? "white" : "black";
      const playerId = sideToMove === "white" ? g.white : g.black;
      const academyId = playerId ? tracked.get(playerId) : undefined;
      const fenBefore = board.fen();
      const bestUci = cur.bestMoveUci;
      const pv = cur.pv ?? [];
      const mateIn = cur.mate !== undefined && cur.mate > 0 ? cur.mate : null;
      const playedUci = moves[i];
      if (!playedUci) break;
      const mv = board.move({ from: playedUci.slice(0, 2), to: playedUci.slice(2, 4), promotion: playedUci.slice(4) || undefined } as never);
      if (!mv) break; // corrupt game record — stop here
      let next: PositionEval;
      next = await this.evalAt(engine, slot, board.fen());
      const whiteBefore = toWhiteCp(cur, sideToMove);
      if (playerId && academyId && bestUci) {
        const cs = (charStats[playerId] ??= { sacrifices: 0, captures: 0, plies: 0, attackMoments: 0, quietBest: 0 });
        cs.plies++; if (mv.captured) cs.captures++;
        // ── Opening layer: the first 12 moves each, judged by the masters book + the engine ──
        if (i < OPENING_PLIES) {
          const ot = (opening[playerId] ??= new OpeningTally());
          const sign = sideToMove === "white" ? 1 : -1;
          const beforeMover = whiteBefore * sign;
          const afterMover = toWhiteCp(next, sideToMove === "white" ? "black" : "white") * sign;
          const loss = Math.max(0, beforeMover - afterMover);
          const inBook = await book.isBook(fenBefore, playedUci);
          ot.plies++;
          if (inBook === true) ot.book++;
          else if (loss <= 30) ot.engineOk++;
          if (inBook === false && ot.deviationPly === null) ot.deviationPly = i + 1;
          const nm = await book.name(board.fen()); if (nm) { ot.eco = nm.eco; ot.name = nm.name; }
          if (inBook !== true && loss >= OPENING_MISTAKE_CP) {
            const trap = loss >= OPENING_TRAP_CP;
            if (trap) ot.trapsFell++; else ot.mistakes++;
            let bestSan: string | null = null;
            try { const b = new Chess(fenBefore); const bm = b.move({ from: bestUci.slice(0, 2), to: bestUci.slice(2, 4), promotion: bestUci.slice(4) || undefined } as never); bestSan = bm?.san ?? null; } catch { /* */ }
            const primary = trap ? "fellIntoTrap" : "openingMistake";
            events.push({
              _id: `${gameId}:${i + 1}`, gameId, ply: i + 1, userId: playerId, academyId, color: sideToMove,
              fen: fenBefore, bestUci, bestSan, playedUci, playedSan: mv.san, found: false, motifs: [primary], primary,
              points: -(OPENING_POINTS as Record<string, number>)[primary]!, lossCp: Math.round(Math.min(loss, 9999)), mateIn: null, at: g.at,
              source: g.source, url: g.url, label: g.label,
            });
          }
          // A trap SPRUNG: the opponent's last opening move handed over a lot and the student took it with the best move.
          const opportunity = prevWhiteCp === null ? 0 : (whiteBefore - prevWhiteCp) * sign;
          if (opportunity >= OPENING_TRAP_CP && playedUci === bestUci && i >= 2) {
            ot.trapsSprung++;
            const already = events.find((e) => e.ply === i + 1);
            if (already) { if (!already.motifs.includes("openingTrap")) already.motifs.push("openingTrap"); }
            else events.push({
              _id: `${gameId}:${i + 1}`, gameId, ply: i + 1, userId: playerId, academyId, color: sideToMove,
              fen: fenBefore, bestUci, bestSan: mv.san, playedUci, playedSan: mv.san, found: true, motifs: ["openingTrap"], primary: "openingTrap",
              points: OPENING_POINTS.openingTrap, lossCp: 0, mateIn: null, at: g.at, source: g.source, url: g.url, label: g.label,
            });
          }
        }
        // Both from the mover's point of view: what the position was worth, and what it is worth now.
        const sign = sideToMove === "white" ? 1 : -1;
        const beforeMover = whiteBefore * sign;
        const afterMover = toWhiteCp(next, sideToMove === "white" ? "black" : "white") * sign;
        const lossCp = Math.max(0, beforeMover - afterMover);
        const opportunity = prevWhiteCp === null ? 0 : (whiteBefore - prevWhiteCp) * sign; // how much the opponent's last move handed over
        const mating = cur.mate !== undefined && cur.mate > 0;
        const tags = cook(fenBefore, mating ? pv : pv.slice(0, PV_PLIES_FOR_TAGS), sideToMove);
        const motifs = tags.filter((t) => !SHAPE_TAGS.has(t) && (SCORING_TAGS.has(t) || isMateTag(t)) && (MOTIF_POINTS[t] ?? 0) > 0).sort((a, b) => rankOf(a) - rankOf(b)).slice(0, 4);
        if (motifs.length && (mating || opportunity >= OPPORTUNITY_MIN_CP || lossCp >= TACTIC_MIN_GAIN_CP)) {
          // Found = the student played the engine's move (or another move that still mates as fast).
          // An "as good" alternative earns nothing here: the motif belongs to the best line, and a
          // different move is not that motif.
          const stillMating = mating && next.mate !== undefined && next.mate < 0 && Math.abs(next.mate) <= (cur.mate ?? 0);
          const found = (playedUci === bestUci || stillMating) && (mating || opportunity >= OPPORTUNITY_MIN_CP);
          const missed = !found && lossCp >= TACTIC_MIN_GAIN_CP;
          if ((found || missed) && !events.some((e) => e.ply === i + 1)) {
            const primary = motifs[0]!;
            if (found && (primary === "sacrifice" || primary === "attraction" || primary === "deflection")) cs.sacrifices++;
            const base = MOTIF_POINTS[primary] ?? pointsFor(motifs);
            let bestSan: string | null = null, playedSan: string | null = mv.san;
            try { const b = new Chess(fenBefore); const bm = b.move({ from: bestUci.slice(0, 2), to: bestUci.slice(2, 4), promotion: bestUci.slice(4) || undefined } as never); bestSan = bm?.san ?? null; } catch { /* */ }
            events.push({
              _id: `${gameId}:${i + 1}`, gameId, ply: i + 1, userId: playerId, academyId, color: sideToMove,
              fen: fenBefore, bestUci, bestSan, playedUci, playedSan, found, motifs, primary,
              points: found ? base : -Math.ceil(base / 2), lossCp: found ? 0 : Math.round(Math.min(lossCp, 9999)), mateIn, at: g.at,
              source: g.source, url: g.url, label: g.label,
            });
          }
        }
        // ── Positional layer: only when no tactic was scored at this moment ──
        if (!events.some((e) => e.gameId === gameId && e.ply === i + 1)) {
          const sign = sideToMove === "white" ? 1 : -1;
          const beforeMover = whiteBefore * sign;
          const afterMover = toWhiteCp(next, sideToMove === "white" ? "black" : "white") * sign;
          const lossCp = Math.max(0, beforeMover - afterMover);
          const playedBest = playedUci === bestUci;
          const missedCandidate = !playedBest && lossCp >= STRATEGIC_LOSS_CP;
          if (playedBest || missedCandidate) {
            // Null-move evals (what if the mover passed?) — the expensive part, rated players only.
            let threatBefore: number | null = null, threatAfter: number | null = null, oppBestAfter: number | null = null, oppPassAfter: number | null = null;
            if (deep.get(playerId)) {
              try {
                const nf = nullMoveFen(fenBefore);
                if (nf) { const ev = await this.evalAt(engine, slot, nf); threatBefore = toWhiteCp(ev, sideToMove === "white" ? "black" : "white") * sign; }
                const fenAfterMove = playedBest ? board.fen() : (() => { const b2 = new Chess(fenBefore); b2.move({ from: bestUci.slice(0, 2), to: bestUci.slice(2, 4), promotion: bestUci.slice(4) || undefined } as never); return b2.fen(); })();
                const nfAfter = nullMoveFen(fenAfterMove);
                if (nfAfter) { const ev = await this.evalAt(engine, slot, nfAfter); threatAfter = toWhiteCp(ev, sideToMove) * sign; }
                // zugzwang: opponent to move after our move — their best (next / a fresh eval) vs passing
                if (isEndgame(new Chess(fenAfterMove))) {
                  const evBest = playedBest ? next : await this.evalAt(engine, slot, fenAfterMove);
                  oppBestAfter = toWhiteCp(evBest, sideToMove === "white" ? "black" : "white") * -sign;
                  if (nfAfter) { const evPass = await this.evalAt(engine, slot, nfAfter); oppPassAfter = toWhiteCp(evPass, sideToMove) * -sign; }
                }
              } catch { /* engine hiccup: score without the null-move ideas */ }
            }
            const uci = playedBest ? playedUci : bestUci;
            const afterForTags = playedBest ? afterMover : beforeMover; // for a missed idea, judge the BEST move's effect: it keeps the eval
            const stags = strategicTags({ fenBefore, uci, color: sideToMove === "white" ? "w" : "b", beforeMover, afterMover: afterForTags, threatBefore, threatAfter, oppBestAfter, oppPassAfter });
            // A "positional" award needs the engine to agree the move mattered: best move AND (the eval held or improved,
            // or a null-move idea fired). A miss needs a real strategic tag on the best move.
            const ideaTags = stags.filter((t) => t !== "positional");
            if (ideaTags.length) {
              const found = playedBest && afterMover >= beforeMover - 30;
              if (found || missedCandidate) {
                const primary = ideaTags[0]!;
                if (found && primary === "goodAttack") cs.attackMoments++;
                if (found) cs.quietBest++;
                const base = STRATEGIC_POINTS[primary as keyof typeof STRATEGIC_POINTS] ?? 1;
                let bestSan: string | null = null;
                try { const b = new Chess(fenBefore); const bm = b.move({ from: bestUci.slice(0, 2), to: bestUci.slice(2, 4), promotion: bestUci.slice(4) || undefined } as never); bestSan = bm?.san ?? null; } catch { /* */ }
                events.push({
                  _id: `${gameId}:${i + 1}`, gameId, ply: i + 1, userId: playerId, academyId, color: sideToMove,
                  fen: fenBefore, bestUci, bestSan, playedUci, playedSan: mv.san, found, motifs: ideaTags, primary,
                  points: found ? base : -Math.max(1, Math.ceil(base / 2)), lossCp: found ? 0 : Math.round(Math.min(lossCp, 9999)), mateIn: null, at: g.at,
                  source: g.source, url: g.url, label: g.label,
                });
              }
            }
          }
        }
      }
      prevWhiteCp = whiteBefore;
      cur = next;
    }
    const character: Record<string, string[]> = {};
    for (const [uid, st] of Object.entries(charStats)) character[uid] = gameCharacter(st);
    const openingSummary: Record<string, ReturnType<OpeningTally["toJSON"]>> = {};
    for (const [uid, t] of Object.entries(opening)) openingSummary[uid] = t.toJSON();
    await this.events().deleteMany({ gameId });
    if (events.length) await this.events().insertMany(events);
    await this.done().updateOne({ _id: gameId }, { $set: { academyIds: Array.from(new Set(tracked.values())), analyzedAt: new Date(), plies: moves.length, events: events.length, character, opening: openingSummary } }, { upsert: true });
    console.log(`[game-motifs] ${gameId}: ${moves.length} plies, ${events.length} moments${Object.values(character).some((c) => c.length) ? " · " + JSON.stringify(character) : ""}`);
    return { events: events.length, plies: moves.length };
  }

  // ── API ─────────────────────────────────────────────────────────────────────
  private member(session: any): { userId: string; academyId: string; role: string } {
    const userId = session?.userId; if (!userId) throw new UnauthorizedException("sign in first");
    const academyId = session?.academyId; if (!academyId) throw new ForbiddenException("not in an academy");
    return { userId: String(userId), academyId: String(academyId), role: String(session?.role ?? "") };
  }
  private static sinceFor(period: string): Date | null {
    const days = period === "7d" ? 7 : period === "30d" ? 30 : period === "90d" ? 90 : null;
    return days ? new Date(Date.now() - days * 864e5) : null;
  }

  async leaderboard(session: any, period = "30d") {
    const { academyId } = this.member(session);
    const since = GameMotifsService.sinceFor(period);
    const match: Record<string, unknown> = { academyId };
    if (since) match.at = { $gte: since };
    const rows = await this.events().aggregate([
      { $match: match },
      { $group: { _id: "$userId", score: { $sum: "$points" }, found: { $sum: { $cond: ["$found", 1, 0] } }, missed: { $sum: { $cond: ["$found", 0, 1] } },
        games: { $addToSet: "$gameId" }, lastAt: { $max: "$at" }, motifs: { $push: { m: "$primary", f: "$found" } }, sources: { $addToSet: "$source" } } },
      { $sort: { score: -1, found: -1 } },
    ]).toArray();
    const users = await this.col("users").find({ _id: { $in: rows.map((r) => r._id) as never[] } }, { projection: { username: 1, name: 1, coachId: 1 } }).toArray();
    const byId = new Map(users.map((u: any) => [String(u._id), u]));
    const out = rows.map((r, i) => {
      const byMotif: Record<string, { found: number; missed: number }> = {};
      for (const e of r.motifs as Array<{ m: string; f: boolean }>) { const b = (byMotif[e.m] ??= { found: 0, missed: 0 }); if (e.f) b.found++; else b.missed++; }
      const u = byId.get(String(r._id)) as any;
      return { rank: i + 1, studentId: String(r._id), username: u?.username ?? String(r._id), name: u?.name ?? null, coachId: u?.coachId ?? null,
        score: r.score, found: r.found, missed: r.missed, games: (r.games as string[]).length, lastAt: r.lastAt, byMotif, sources: r.sources as string[] };
    });
    const pending = await this.pendingCount(academyId);
    // Game character per student (aggressive / dynamic / positional) from the scored-game ledger.
    const charRows = await this.done().find({ academyIds: academyId, $or: [{ character: { $exists: true } }, { opening: { $exists: true } }] }, { projection: { character: 1, opening: 1, analyzedAt: 1 } }).toArray();
    const character: Record<string, Record<string, number>> = {};
    const openingAgg: Record<string, { games: number; accSum: number; accN: number; mistakes: number; trapsFell: number; trapsSprung: number; names: Record<string, number> }> = {};
    for (const r of charRows as any[]) {
      for (const [uid, tags] of Object.entries(r.character ?? {})) for (const t of tags as string[]) { const c = (character[uid] ??= {}); c[t] = (c[t] ?? 0) + 1; }
      for (const [uid, o] of Object.entries((r.opening ?? {}) as Record<string, any>)) {
        const a = (openingAgg[uid] ??= { games: 0, accSum: 0, accN: 0, mistakes: 0, trapsFell: 0, trapsSprung: 0, names: {} });
        a.games++; if (typeof o.accuracy === "number") { a.accSum += o.accuracy; a.accN++; }
        a.mistakes += o.mistakes ?? 0; a.trapsFell += o.trapsFell ?? 0; a.trapsSprung += o.trapsSprung ?? 0;
        if (o.name) a.names[o.name] = (a.names[o.name] ?? 0) + 1;
      }
    }
    for (const r of out) {
      (r as any).character = character[r.studentId] ?? {};
      const a = openingAgg[r.studentId];
      (r as any).opening = a ? { accuracy: a.accN ? Math.round(a.accSum / a.accN) : null, mistakes: a.mistakes, trapsFell: a.trapsFell, trapsSprung: a.trapsSprung, favourite: Object.entries(a.names).sort((x, y) => y[1] - x[1])[0]?.[0] ?? null } : null;
    }
    return { period, rows: out, labels: MOTIF_LABEL, points: MOTIF_POINTS, pending, strategic: STRATEGIC_ORDER };
  }

  async studentEvents(session: any, studentId: string, period = "30d") {
    const { academyId } = this.member(session);
    const since = GameMotifsService.sinceFor(period);
    const match: Record<string, unknown> = { academyId, userId: studentId };
    if (since) match.at = { $gte: since };
    const rows = await this.events().find(match, { projection: { _id: 0 } }).sort({ at: -1, ply: 1 }).limit(400).toArray();
    return { studentId, period, events: rows, labels: MOTIF_LABEL };
  }

  private async pendingCount(academyId: string): Promise<number> {
    return (await this.candidates(academyId, 500)).length;
  }

  /** Coach/owner: analyse (or re-analyse) one game now. */
  async analyzeNow(session: any, gameId: string) {
    const { academyId, role } = this.member(session);
    if (!["academy_owner", "coach", "admin"].includes(role)) throw new ForbiddenException("coach or owner only");
    const g = await this.loadGame(gameId);
    if (!g) throw new NotFoundException("game not found");
    const ids = [g.white, g.black].filter((x): x is string => !!x);
    const acad = await this.academyOf(ids);
    for (const [u, a] of acad) if (a !== academyId) acad.delete(u);
    if (!acad.size) throw new ForbiddenException("no player of this game is in your academy");
    return this.analyzeGame(gameId, acad);
  }
}
