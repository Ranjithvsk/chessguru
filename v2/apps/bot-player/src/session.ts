import { Chess } from "chess.js";
import WebSocket from "ws";
import type { Color, ServerMsg, TimeControl } from "@chessguru/protocol";
import type { BotEngine } from "./engines";
import { thinkMs } from "./think";

const WS_URL = process.env.BOT_WS_URL ?? "ws://127.0.0.1:18080/ws";
const MATCH_TIMEOUT_MS = 6000;
const GAME_TIMEOUT_MS = 90 * 60 * 1000;

const PIECE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 } as const;
const RESIGN_DEFICIT = 9;
const RESIGN_SUSTAIN = 6;

export interface GameLog {
  game: string;
  bot: string;
  opponent: string;
  botColor: Color;
  opponentRating: number;
  /** Which engine and strength setting answered this game, e.g. `maia1-1500`. */
  engine: string;
  clock: TimeControl;
  plies: number;
  result: string | null;
  reason: string | null;
  startedAt: Date;
  endedAt: Date;
}

/** One bot appearance: connect, seek, play a single game, disconnect. */
export class BotSession {
  private ws: WebSocket | null = null;
  private board = new Chess();
  private uciMoves: string[] = [];
  private game: string | null = null;
  private color: Color = "white";
  private opponent = "";
  private ply = 0;
  private clock = { white: 0, black: 0 };
  private busy = false;
  private losingStreak = 0;
  private done = false;
  private claimTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly name: string,
    private readonly botKey: string,
    private readonly clockTc: TimeControl,
    private readonly opponentRating: number,
    private readonly engine: BotEngine,
    private readonly onFinish: (log: GameLog | null) => void,
  ) {}

  private send(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Resolves once the bot is matched; rejects if nobody took the seek. */
  run(): void {
    const startedAt = new Date();
    const ws = new WebSocket(WS_URL);
    this.ws = ws;

    const matchTimer = setTimeout(() => {
      if (this.game) return;
      // Somebody else took the seeker first. Withdraw cleanly so we never leave a bot
      // seek in the pool for another bot to match.
      this.send({ v: 1, t: "unseek" });
      this.finish(null, startedAt);
    }, MATCH_TIMEOUT_MS);

    const hardTimer = setTimeout(() => this.finish(null, startedAt), GAME_TIMEOUT_MS);

    ws.on("open", () => {
      this.send({ v: 1, t: "hello", d: { bot: { name: this.name, key: this.botKey } } });
      this.send({ v: 1, t: "seek", d: { clock: this.clockTc, rated: false, ratingRange: 4000 } });
    });

    ws.on("message", (raw) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(raw.toString()) as ServerMsg;
      } catch {
        return;
      }
      if (msg.t === "matched") clearTimeout(matchTimer);
      this.onMsg(msg, startedAt);
    });

    ws.on("error", (e) => console.error(`[bot ${this.name}] socket:`, e.message));
    ws.on("close", () => {
      clearTimeout(matchTimer);
      clearTimeout(hardTimer);
      if (this.claimTimer) clearTimeout(this.claimTimer);
      this.finish(null, startedAt);
    });
  }

  private finish(log: GameLog | null, _startedAt: Date): void {
    if (this.done) return;
    this.done = true;
    try {
      this.ws?.close();
    } catch {
      /* already closing */
    }
    this.onFinish(log);
  }

  private onMsg(msg: ServerMsg, startedAt: Date): void {
    switch (msg.t) {
      case "matched":
        this.game = msg.d.game;
        this.color = msg.d.color;
        this.opponent = msg.d.opponent;
        this.board.reset();
        this.uciMoves = [];
        console.log(`[bot ${this.name}] matched ${msg.d.game} as ${msg.d.color} vs ${msg.d.opponent} (${this.engine.id})`);
        this.send({ v: 1, t: "sub", g: msg.d.game });
        return;

      case "game-state": {
        this.ply = msg.d.ply;
        this.clock = msg.d.clock;
        if (msg.d.moves.length !== this.uciMoves.length) this.resync(msg.d.fen);
        if (msg.d.status !== "playing") {
          this.finish(this.log(msg.d.result, msg.d.status, startedAt), startedAt);
          return;
        }
        void this.maybeMove(msg.d.turn);
        return;
      }

      case "moved":
        this.ply = msg.d.ply + 1;
        this.clock = msg.d.clock;
        if (this.uciMoves.length === msg.d.ply) {
          this.uciMoves.push(msg.d.uci);
          try {
            this.board.move({ from: msg.d.uci.slice(0, 2), to: msg.d.uci.slice(2, 4), promotion: msg.d.uci.slice(4) || undefined });
          } catch {
            this.resync(msg.d.fen);
          }
        } else {
          this.resync(msg.d.fen);
        }
        void this.maybeMove(msg.d.turn);
        return;

      case "clock":
        this.clock = msg.d.clock;
        return;

      case "game-end":
        if (this.claimTimer) clearTimeout(this.claimTimer);
        // An aborted game never happened — nothing worth a bot_games row.
        this.finish(msg.d.reason === "aborted" ? null : this.log(msg.d.result, msg.d.reason, startedAt), startedAt);
        return;

      case "presence":
        this.onPresence(msg.d.color, msg.d.online, msg.d.claimableAt);
        return;

      case "error":
        console.error(`[bot ${this.name}] ${msg.d.code}: ${msg.d.msg}`);
        this.busy = false;
        return;
    }
  }

  /** The opponent's socket came or went. A human who is left alone at the board
   *  aborts if nothing has been played yet, otherwise takes the win once the
   *  server allows it — a little after, never on the exact second. */
  private onPresence(color: Color, online: boolean, claimableAt: number | null): void {
    if (color === this.color) return;
    if (this.claimTimer) {
      clearTimeout(this.claimTimer);
      this.claimTimer = null;
    }
    if (online || this.done || !this.game) return;
    const g = this.game;
    if (this.ply < 2) {
      this.claimTimer = setTimeout(() => this.send({ v: 1, t: "abort", g }), 8000 + Math.random() * 10000);
      return;
    }
    const wait = Math.max(0, (claimableAt ?? Date.now()) - Date.now()) + 2000 + Math.random() * 6000;
    this.claimTimer = setTimeout(() => this.send({ v: 1, t: "claim", g }), wait);
  }

  /** Our move list drifted from the server's; fall back to the authoritative FEN. */
  private resync(fen: string): void {
    try {
      this.board.load(fen);
    } catch {
      /* keep the old board; the next game-state will correct us */
    }
    this.uciMoves = [];
  }

  private async maybeMove(turn: Color): Promise<void> {
    if (this.done || this.busy || !this.game || turn !== this.color) return;
    this.busy = true;
    const atPly = this.ply;
    try {
      // Only `position startpos moves ...` gives the Maia nets real position history, which
      // is what they condition on. If we lost the move list, skip the think and play a legal
      // move rather than feeding it a history it never saw.
      if (this.uciMoves.length !== atPly) {
        this.playFallback(atPly);
        return;
      }
      const think = await this.engine.think({ moves: this.uciMoves, opponentRating: this.opponentRating });
      if (this.done || this.ply !== atPly) return; // the position moved on under us

      if (this.shouldResign()) {
        this.send({ v: 1, t: "resign", g: this.game });
        return;
      }

      const delay = thinkMs({
        ply: atPly,
        remainingMs: this.clock[this.color],
        incrementMs: this.clockTc.increment,
        collision: think.collision,
      });
      await new Promise((r) => setTimeout(r, delay));
      if (this.done || this.ply !== atPly) return;
      this.send({ v: 1, t: "move", g: this.game, d: { uci: think.uci, ply: atPly } });
    } catch (e) {
      console.error(`[bot ${this.name}] think failed:`, (e as Error).message);
      this.playFallback(atPly);
    } finally {
      this.busy = false;
    }
  }

  private playFallback(atPly: number): void {
    const legal = this.board.moves({ verbose: true });
    const m = legal[Math.floor(Math.random() * legal.length)];
    if (!m || !this.game) return;
    this.send({ v: 1, t: "move", g: this.game, d: { uci: `${m.from}${m.to}${m.promotion ?? ""}`, ply: atPly } });
  }

  /** Material-based, deliberately not engine-based: the value head's sign convention is
   *  unverified, and resigning a won game is a far worse tell than never resigning. */
  private shouldResign(): boolean {
    let mine = 0;
    let theirs = 0;
    for (const row of this.board.board()) {
      for (const sq of row) {
        if (!sq) continue;
        const v = PIECE[sq.type];
        if ((sq.color === "w") === (this.color === "white")) mine += v;
        else theirs += v;
      }
    }
    this.losingStreak = theirs - mine >= RESIGN_DEFICIT ? this.losingStreak + 1 : 0;
    if (this.ply < 24 || this.losingStreak < RESIGN_SUSTAIN) return false;
    // Stronger players resign; beginners play on to mate.
    const p = Math.min(0.85, Math.max(0.1, (this.opponentRating - 800) / 1600));
    return Math.random() < p;
  }

  private log(result: string | null, reason: string | null, startedAt: Date): GameLog {
    return {
      game: this.game ?? "",
      bot: this.name,
      opponent: this.opponent,
      botColor: this.color,
      opponentRating: this.opponentRating,
      engine: this.engine.id,
      clock: this.clockTc,
      plies: this.ply,
      result,
      reason,
      startedAt,
      endedAt: new Date(),
    };
  }
}
