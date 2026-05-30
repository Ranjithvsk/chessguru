import { Chess } from "chess.js";
import type { Clock, Color, GameStatus, Players, Seat, TimeControl } from "@chessguru/protocol";
import type { GameState } from "./snapshot";

export interface MoveResult {
  ok: boolean;
  code?: string;
  san?: string;
  fen?: string;
  turn?: Color;
  ply?: number; // index of the move just played
  clock?: Clock;
  flagged?: boolean; // true when the "move" was rejected because the mover's clock expired
  end?: { result: string; reason: GameStatus };
}

export interface JoinResult {
  seat: Seat;
}

const START_FEN = new Chess().fen();
const DEFAULT_TC: TimeControl = { initial: 180_000, increment: 2_000 };
/** Max network lag (ms) the server will refund per move (lila-style cap). */
const LAG_CAP_MS = 1_000;

/**
 * Authoritative state of one live game: standard chess (chess.js) + server-truth
 * clocks. Time is kept in integer ms; the running side's remaining time is
 * `clockRemaining[turn] - (now - turnStartedAt)`. `turnStartedAt` is an epoch-ms
 * timestamp so the clock survives rehydration onto another node (the documented
 * trade-off: time spent during a node-outage counts against the mover until
 * pause-on-unavailable lands in a later milestone). Rules are encapsulated here
 * so a chessops/variant swap stays local.
 */
export class RoundGrain {
  private chess = new Chess();
  private initialFen = START_FEN;
  moves: string[] = [];
  players: Players = { white: null, black: null };
  status: GameStatus = "playing";
  result: string | null = null;
  startedAt = Date.now();
  finishedAt?: number;

  timeControl: TimeControl = { ...DEFAULT_TC };
  clockRemaining: Clock = { white: DEFAULT_TC.initial, black: DEFAULT_TC.initial };
  clockStarted = false;
  turnStartedAt: number | null = null;

  get ply(): number {
    return this.moves.length;
  }
  get turn(): Color {
    return this.chess.turn() === "w" ? "white" : "black";
  }
  fen(): string {
    return this.chess.fen();
  }
  bothSeated(): boolean {
    return this.players.white !== null && this.players.black !== null;
  }

  hydrate(st: GameState | null): void {
    if (!st) return;
    this.initialFen = st.initialFen;
    this.players = { ...st.players };
    this.status = st.status;
    this.result = st.result;
    this.startedAt = st.startedAt;
    this.finishedAt = st.finishedAt;
    this.timeControl = { ...st.timeControl };
    this.clockRemaining = { ...st.clockRemaining };
    this.clockStarted = st.clockStarted;
    this.turnStartedAt = st.turnStartedAt;
    this.chess = new Chess(st.initialFen);
    for (const uci of st.moves) this.applyUci(uci); // replay to restore history (repetition)
    this.moves = st.moves.slice();
  }

  state(): GameState {
    return {
      initialFen: this.initialFen,
      moves: this.moves.slice(),
      players: { ...this.players },
      status: this.status,
      result: this.result,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      timeControl: { ...this.timeControl },
      clockRemaining: { ...this.clockRemaining },
      clockStarted: this.clockStarted,
      turnStartedAt: this.turnStartedAt,
    };
  }

  /** Configure before the game starts (before any move + before both seated). */
  configure(tc: TimeControl, initialFen?: string): boolean {
    if (this.clockStarted || this.moves.length > 0) return false;
    if (initialFen) {
      try {
        this.chess = new Chess(initialFen); // throws on an invalid FEN
        this.initialFen = initialFen;
      } catch {
        return false;
      }
    }
    this.timeControl = { initial: tc.initial, increment: tc.increment };
    this.clockRemaining = { white: tc.initial, black: tc.initial };
    return true;
  }

  /** First two distinct users take white then black; everyone else spectates. */
  join(userId: string): JoinResult {
    if (this.players.white === userId) return { seat: "white" };
    if (this.players.black === userId) return { seat: "black" };
    if (this.players.white === null) {
      this.players.white = userId;
      return { seat: "white" };
    }
    if (this.players.black === null) {
      this.players.black = userId;
      return { seat: "black" };
    }
    return { seat: "spectator" };
  }

  /** Start the clock once both seats are filled (the side to move begins ticking). */
  startClock(now: number): boolean {
    if (this.clockStarted || !this.bothSeated() || this.status !== "playing") return false;
    this.clockStarted = true;
    this.turnStartedAt = now;
    return true;
  }

  /** Live remaining time, decrementing the running side. */
  liveClock(now: number): Clock {
    const c = { ...this.clockRemaining };
    if (this.clockStarted && this.turnStartedAt !== null && this.status === "playing") {
      const side = this.turn;
      c[side] = Math.max(0, c[side] - (now - this.turnStartedAt));
    }
    return c;
  }

  /** Epoch-ms instant the running side would flag, or null if no clock is running. */
  dueAt(): number | null {
    if (!this.clockStarted || this.turnStartedAt === null || this.status !== "playing") return null;
    return this.turnStartedAt + this.clockRemaining[this.turn];
  }

  move(uci: string, expectedPly: number, by: string, now: number, lagMs: number): MoveResult {
    if (this.status !== "playing") return { ok: false, code: "game-over" };
    const moverColor = this.turn;
    const seat = this.players[moverColor];
    if (seat === null) return { ok: false, code: "no-player" };
    if (seat !== by) return { ok: false, code: "not-your-turn" };
    if (expectedPly !== this.moves.length) return { ok: false, code: "stale-ply" };

    // ── clock first: debit, lag-comp, flag check before accepting the move ──
    if (this.clockStarted && this.turnStartedAt !== null) {
      const elapsed = now - this.turnStartedAt;
      const refund = Math.min(Math.max(0, lagMs), LAG_CAP_MS, elapsed);
      this.clockRemaining[moverColor] -= elapsed - refund;
      if (this.clockRemaining[moverColor] <= 0) {
        this.clockRemaining[moverColor] = 0;
        const end = this.flagInternal(moverColor, now); // too late — flag, move not applied
        return { ok: true, flagged: true, clock: { ...this.clockRemaining }, end };
      }
    }

    let san: string;
    try {
      const m = this.chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci.slice(4) : undefined,
      });
      san = m.san;
    } catch {
      // restore: an illegal attempt shouldn't keep the debit (we re-add elapsed)
      if (this.clockStarted && this.turnStartedAt !== null) {
        this.clockRemaining[moverColor] += now - this.turnStartedAt; // best-effort restore
      }
      return { ok: false, code: "illegal-move" };
    }

    this.moves.push(uci);
    this.clockRemaining[moverColor] += this.timeControl.increment;
    this.turnStartedAt = now; // the other side's clock starts now
    const end = this.checkEnd(moverColor);
    if (end) this.turnStartedAt = null; // game over — clocks stop
    return { ok: true, san, fen: this.chess.fen(), turn: this.turn, ply: this.moves.length - 1, clock: { ...this.clockRemaining }, end };
  }

  /** Flag the given side (called by the engine's proactive timer). */
  flag(side: Color, now: number): MoveResult {
    if (this.status !== "playing") return { ok: false, code: "game-over" };
    // confirm the side really is out of time
    const live = this.liveClock(now);
    if (live[side] > 0) return { ok: false, code: "not-flagged" };
    this.clockRemaining[side] = 0;
    const end = this.flagInternal(side, now);
    return { ok: true, clock: { ...this.clockRemaining }, end };
  }

  resign(by: string): MoveResult {
    if (this.status !== "playing") return { ok: false, code: "game-over" };
    const color: Color | null = this.players.white === by ? "white" : this.players.black === by ? "black" : null;
    if (!color) return { ok: false, code: "not-a-player" };
    this.status = "resign";
    this.result = color === "white" ? "0-1" : "1-0";
    this.finishedAt = Date.now();
    this.turnStartedAt = null;
    return { ok: true, clock: { ...this.clockRemaining }, end: { result: this.result, reason: "resign" } };
  }

  private flagInternal(side: Color, now: number): { result: string; reason: GameStatus } {
    const opp: Color = side === "white" ? "black" : "white";
    this.status = "flag";
    // flag is a draw if the opponent cannot possibly mate (insufficient material)
    this.result = this.hasMatingMaterial(opp) ? (opp === "white" ? "1-0" : "0-1") : "1/2-1/2";
    this.finishedAt = now;
    this.turnStartedAt = null;
    return { result: this.result, reason: "flag" };
  }

  /** Could `color` ever deliver mate? false for lone king / K+single-minor. */
  private hasMatingMaterial(color: Color): boolean {
    const c = color === "white" ? "w" : "b";
    const minors: string[] = [];
    for (const row of this.chess.board()) {
      for (const sq of row) {
        if (sq && sq.color === c && sq.type !== "k") minors.push(sq.type);
      }
    }
    if (minors.length === 0) return false; // lone king
    if (minors.length === 1 && (minors[0] === "n" || minors[0] === "b")) return false; // K+N or K+B
    return true;
  }

  private applyUci(uci: string): void {
    this.chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci.slice(4) : undefined,
    });
  }

  private checkEnd(moverColor: Color): MoveResult["end"] {
    if (!this.chess.isGameOver()) return undefined;
    this.finishedAt = Date.now();
    if (this.chess.isCheckmate()) {
      this.status = "checkmate";
      this.result = moverColor === "white" ? "1-0" : "0-1";
    } else if (this.chess.isStalemate()) {
      this.status = "stalemate";
      this.result = "1/2-1/2";
    } else if (this.chess.isInsufficientMaterial()) {
      this.status = "insufficient";
      this.result = "1/2-1/2";
    } else if (this.chess.isThreefoldRepetition()) {
      this.status = "threefold";
      this.result = "1/2-1/2";
    } else {
      this.status = "draw";
      this.result = "1/2-1/2";
    }
    return { result: this.result, reason: this.status };
  }
}
