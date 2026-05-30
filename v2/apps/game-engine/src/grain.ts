import { Chess } from "chess.js";
import type { Color, GameStatus, Players, Seat } from "@chessguru/protocol";
import type { GameState } from "./snapshot";

export interface MoveResult {
  ok: boolean;
  code?: string;
  san?: string;
  fen?: string;
  turn?: Color;
  ply?: number; // index of the move just played
  end?: { result: string; reason: GameStatus };
}

export interface JoinResult {
  seat: Seat;
}

const START_FEN = new Chess().fen();

/**
 * The authoritative state of one live game (M1: standard chess, no clocks).
 * Replaces M0's EchoGrain; the directory / mailbox / lease / snapshot machinery
 * around it is unchanged. Rules + draw detection come from chess.js (threefold,
 * insufficient material and 50-move are tracked for free). chessops/variants are
 * the post-M5 path; rules stay encapsulated here so that swap is local.
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

  get ply(): number {
    return this.moves.length;
  }
  get turn(): Color {
    return this.chess.turn() === "w" ? "white" : "black";
  }
  fen(): string {
    return this.chess.fen();
  }

  hydrate(st: GameState | null): void {
    if (!st) return;
    this.initialFen = st.initialFen;
    this.players = { ...st.players };
    this.status = st.status;
    this.result = st.result;
    this.startedAt = st.startedAt;
    this.finishedAt = st.finishedAt;
    this.chess = new Chess(st.initialFen);
    for (const uci of st.moves) this.applyUci(uci); // replay to restore full history (for repetition)
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
    };
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

  move(uci: string, expectedPly: number, by: string): MoveResult {
    if (this.status !== "playing") return { ok: false, code: "game-over" };
    const moverColor = this.turn;
    const seat = this.players[moverColor];
    if (seat === null) return { ok: false, code: "no-player" };
    if (seat !== by) return { ok: false, code: "not-your-turn" };
    if (expectedPly !== this.moves.length) return { ok: false, code: "stale-ply" };

    let san: string;
    try {
      const m = this.chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci.slice(4) : undefined,
      });
      san = m.san;
    } catch {
      return { ok: false, code: "illegal-move" };
    }
    this.moves.push(uci);
    const end = this.checkEnd(moverColor);
    return { ok: true, san, fen: this.chess.fen(), turn: this.turn, ply: this.moves.length - 1, end };
  }

  resign(by: string): MoveResult {
    if (this.status !== "playing") return { ok: false, code: "game-over" };
    const color: Color | null = this.players.white === by ? "white" : this.players.black === by ? "black" : null;
    if (!color) return { ok: false, code: "not-a-player" };
    this.status = "resign";
    this.result = color === "white" ? "0-1" : "1-0";
    this.finishedAt = Date.now();
    return { ok: true, end: { result: this.result, reason: "resign" } };
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
      this.status = "draw"; // 50-move and any other chess.js draw
      this.result = "1/2-1/2";
    }
    return { result: this.result, reason: this.status };
  }
}
