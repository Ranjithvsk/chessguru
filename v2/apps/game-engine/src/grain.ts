import { Chess } from "chess.js";
import type { Clock, Color, GameStatus, Players, Seat, TimeControl } from "@chessguru/protocol";
import type { GameState } from "./snapshot";

export interface MoveResult {
  ok: boolean;
  code?: string;
  san?: string;
  fen?: string;
  turn?: Color;
  ply?: number;
  clock?: Clock;
  flagged?: boolean;
  end?: { result: string; reason: GameStatus };
}
export interface JoinResult {
  seat: Seat;
}
export interface RematchResult {
  ok: boolean;
  code?: string;
  both?: boolean;
}

const START_FEN = new Chess().fen();
const DEFAULT_TC: TimeControl = { initial: 180_000, increment: 2_000 };
const LAG_CAP_MS = 1_000;

/** Authoritative state of one live game: chess (chess.js) + server-truth clocks
 *  + game flow (draw offers, rematch). Rules/clock encapsulated; chessops/variant
 *  swap stays local. */
export class RoundGrain {
  private chess = new Chess();
  private initialFen = START_FEN;
  moves: string[] = [];
  players: Players = { white: null, black: null };
  status: GameStatus = "playing";
  result: string | null = null;
  startedAt = Date.now();
  finishedAt?: number;

  rated = true;
  timeControl: TimeControl = { ...DEFAULT_TC };
  clockRemaining: Clock = { white: DEFAULT_TC.initial, black: DEFAULT_TC.initial };
  clockStarted = false;
  turnStartedAt: number | null = null;

  pendingDraw: Color | null = null;
  rematchReq: { white: boolean; black: boolean } = { white: false, black: false };
  premoves: { white: string | null; black: string | null } = { white: null, black: null };
  moveTimes: number[] = [];

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
  private colorOf(userId: string): Color | null {
    return this.players.white === userId ? "white" : this.players.black === userId ? "black" : null;
  }

  hydrate(st: GameState | null): void {
    if (!st) return;
    this.initialFen = st.initialFen;
    this.players = { ...st.players };
    this.status = st.status;
    this.result = st.result;
    this.startedAt = st.startedAt;
    this.finishedAt = st.finishedAt;
    this.rated = st.rated;
    this.timeControl = { ...st.timeControl };
    this.clockRemaining = { ...st.clockRemaining };
    this.clockStarted = st.clockStarted;
    this.turnStartedAt = st.turnStartedAt;
    this.pendingDraw = st.pendingDraw;
    this.rematchReq = { ...st.rematchReq };
    this.premoves = { ...st.premoves };
    this.moveTimes = st.moveTimes.slice();
    this.chess = new Chess(st.initialFen);
    for (const uci of st.moves) this.applyUci(uci);
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
      rated: this.rated,
      timeControl: { ...this.timeControl },
      clockRemaining: { ...this.clockRemaining },
      clockStarted: this.clockStarted,
      turnStartedAt: this.turnStartedAt,
      pendingDraw: this.pendingDraw,
      rematchReq: { ...this.rematchReq },
      premoves: { ...this.premoves },
      moveTimes: this.moveTimes.slice(),
    };
  }

  configure(tc: TimeControl, initialFen?: string, rated = true): boolean {
    if (this.clockStarted || this.moves.length > 0) return false;
    if (initialFen) {
      try {
        this.chess = new Chess(initialFen);
        this.initialFen = initialFen;
      } catch {
        return false;
      }
    }
    this.timeControl = { initial: tc.initial, increment: tc.increment };
    this.clockRemaining = { white: tc.initial, black: tc.initial };
    this.rated = rated;
    return true;
  }

  /** Pre-seat both players (used by rematch to set up a swapped game). */
  seat(white: string, black: string): void {
    this.players = { white, black };
  }

  join(userId: string): JoinResult {
    const existing = this.colorOf(userId);
    if (existing) return { seat: existing };
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

  startClock(now: number): boolean {
    if (this.clockStarted || !this.bothSeated() || this.status !== "playing") return false;
    this.clockStarted = true;
    this.turnStartedAt = now;
    return true;
  }

  liveClock(now: number): Clock {
    const c = { ...this.clockRemaining };
    if (this.clockStarted && this.turnStartedAt !== null && this.status === "playing") {
      const side = this.turn;
      c[side] = Math.max(0, c[side] - (now - this.turnStartedAt));
    }
    return c;
  }

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

    let thinkMs = 0;
    if (this.clockStarted && this.turnStartedAt !== null) {
      const elapsed = now - this.turnStartedAt;
      thinkMs = elapsed;
      const refund = Math.min(Math.max(0, lagMs), LAG_CAP_MS, elapsed);
      this.clockRemaining[moverColor] -= elapsed - refund;
      if (this.clockRemaining[moverColor] <= 0) {
        this.clockRemaining[moverColor] = 0;
        const end = this.flagInternal(moverColor, now);
        return { ok: true, flagged: true, clock: { ...this.clockRemaining }, end };
      }
    }

    let san: string;
    try {
      const m = this.chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci.slice(4) : undefined });
      san = m.san;
    } catch {
      if (this.clockStarted && this.turnStartedAt !== null) this.clockRemaining[moverColor] += now - this.turnStartedAt;
      return { ok: false, code: "illegal-move" };
    }

    this.moves.push(uci);
    this.moveTimes.push(thinkMs); // anti-cheat: per-move think time
    this.pendingDraw = null; // a move supersedes any standing draw offer
    this.clockRemaining[moverColor] += this.timeControl.increment;
    this.turnStartedAt = now;
    const end = this.checkEnd(moverColor);
    if (end) this.turnStartedAt = null;
    return { ok: true, san, fen: this.chess.fen(), turn: this.turn, ply: this.moves.length - 1, clock: { ...this.clockRemaining }, end };
  }

  flag(side: Color, now: number): MoveResult {
    if (this.status !== "playing") return { ok: false, code: "game-over" };
    if (this.liveClock(now)[side] > 0) return { ok: false, code: "not-flagged" };
    this.clockRemaining[side] = 0;
    const end = this.flagInternal(side, now);
    return { ok: true, clock: { ...this.clockRemaining }, end };
  }

  resign(by: string): MoveResult {
    if (this.status !== "playing") return { ok: false, code: "game-over" };
    const color = this.colorOf(by);
    if (!color) return { ok: false, code: "not-a-player" };
    this.status = "resign";
    this.result = color === "white" ? "0-1" : "1-0";
    this.finishedAt = Date.now();
    this.turnStartedAt = null;
    return { ok: true, clock: { ...this.clockRemaining }, end: { result: this.result, reason: "resign" } };
  }

  drawOffer(by: string): { ok: boolean; code?: string; color?: Color } {
    if (this.status !== "playing") return { ok: false, code: "game-over" };
    const color = this.colorOf(by);
    if (!color) return { ok: false, code: "not-a-player" };
    this.pendingDraw = color;
    return { ok: true, color };
  }

  drawAccept(by: string): MoveResult {
    if (this.status !== "playing") return { ok: false, code: "game-over" };
    const color = this.colorOf(by);
    if (!color) return { ok: false, code: "not-a-player" };
    if (!this.pendingDraw || this.pendingDraw === color) return { ok: false, code: "no-offer" };
    this.status = "agreement";
    this.result = "1/2-1/2";
    this.finishedAt = Date.now();
    this.turnStartedAt = null;
    this.pendingDraw = null;
    return { ok: true, clock: { ...this.clockRemaining }, end: { result: this.result, reason: "agreement" } };
  }

  drawDecline(by: string): void {
    const color = this.colorOf(by);
    if (color && this.pendingDraw && this.pendingDraw !== color) this.pendingDraw = null;
  }

  /** Request a rematch after the game ends; `both` is true once each side has asked. */
  rematch(by: string): RematchResult {
    if (this.status === "playing") return { ok: false, code: "in-progress" };
    const color = this.colorOf(by);
    if (!color) return { ok: false, code: "not-a-player" };
    this.rematchReq[color] = true;
    return { ok: true, both: this.rematchReq.white && this.rematchReq.black };
  }

  /** Queue a premove for a player; auto-applied by the engine on their turn. */
  setPremove(by: string, uci: string): boolean {
    const color = this.colorOf(by);
    if (!color) return false;
    this.premoves[color] = uci;
    return true;
  }
  clearPremove(color: Color): void {
    this.premoves[color] = null;
  }

  private flagInternal(side: Color, now: number): { result: string; reason: GameStatus } {
    const opp: Color = side === "white" ? "black" : "white";
    this.status = "flag";
    this.result = this.hasMatingMaterial(opp) ? (opp === "white" ? "1-0" : "0-1") : "1/2-1/2";
    this.finishedAt = now;
    this.turnStartedAt = null;
    return { result: this.result, reason: "flag" };
  }

  private hasMatingMaterial(color: Color): boolean {
    const c = color === "white" ? "w" : "b";
    const minors: string[] = [];
    for (const row of this.chess.board()) for (const sq of row) if (sq && sq.color === c && sq.type !== "k") minors.push(sq.type);
    if (minors.length === 0) return false;
    if (minors.length === 1 && (minors[0] === "n" || minors[0] === "b")) return false;
    return true;
  }

  private applyUci(uci: string): void {
    this.chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci.slice(4) : undefined });
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
