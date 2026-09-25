// WHY a wrong puzzle move is wrong: the engine's reply to it.
//
// "Best move was Qh4+" on its own convinced a student she had been robbed —
// her Qh5+ looked like the very same mate (TKT-242, MRZuh). It is not: Kxg3
// walks out of it, and one line saying so settles the question that a red and
// a green arrow cannot. Answers are static per puzzle+move, so they are cached
// and one engine, booted on first use, serves every request in turn.
import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { Chess } from "chess.js";
import { Stockfish } from "../my-games/stockfish";

export interface Refutation {
  reply: string;        // SAN of the answer to the wrong move
  replyUci: string;
  cp?: number;          // after that answer, from the SOLVER's side
  mate?: number;        // >0 the solver still mates in N, <0 the solver is mated in N
  depth: number;
}

const DEPTH = 18;
const BUDGET_MS = 12_000;
const IDLE_MS = 5 * 60_000;
const CACHE_MAX = 5000;
const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

@Injectable()
export class PuzzleRefuteService implements OnModuleDestroy {
  private engine: Stockfish | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private idle?: NodeJS.Timeout;
  private readonly cache = new Map<string, Refutation | null>();

  constructor(@InjectConnection() private readonly conn: Connection) {}

  async refute(puzzleId: string, wrong: string): Promise<Refutation | null> {
    if (!UCI.test(wrong)) return null;
    const key = `${puzzleId}:${wrong}`;
    if (this.cache.has(key)) return this.cache.get(key) ?? null;
    const p: any = await this.conn.db!.collection("puzzles")
      .findOne({ _id: puzzleId as any }, { projection: { fen: 1, line: 1 } });
    if (!p?.fen) return null;
    const line = String(p.line || "").trim().split(/\s+/).filter(Boolean);
    const faced = positionFaced(String(p.fen), line, wrong);
    if (!faced) return null;
    const board = new Chess(faced);
    if (!apply(board, wrong)) return null;
    // Any mate is accepted by the checker, so a mating "wrong" move never gets here.
    if (board.isCheckmate() || board.isGameOver()) { this.remember(key, null); return null; }
    const after = board.fen();
    const ev = await this.analyse(after);
    if (!ev?.bestMoveUci) { this.remember(key, null); return null; }
    const replyBoard = new Chess(after);
    const replySan = apply(replyBoard, ev.bestMoveUci)?.san ?? ev.bestMoveUci;
    // ev is from the OPPONENT's side (they are to move after the wrong move).
    const out: Refutation = {
      reply: replySan, replyUci: ev.bestMoveUci, depth: ev.depth,
      ...(typeof ev.mate === "number" ? { mate: -ev.mate } : {}),
      ...(typeof ev.cp === "number" ? { cp: -ev.cp } : {}),
    };
    this.remember(key, out);
    return out;
  }

  private remember(key: string, v: Refutation | null) {
    if (this.cache.size >= CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, v);
  }

  /** One engine, one search at a time. A search that overruns its budget, or an
   *  engine that dies, is dropped — the next call boots a fresh one. */
  private analyse(fen: string) {
    const run = async () => {
      this.touch();
      if (!this.engine) { const e = new Stockfish(); await e.start(); this.engine = e; }
      const eng = this.engine;
      let timer: NodeJS.Timeout | undefined;
      const budget = new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error("refute: engine budget exceeded")), BUDGET_MS);
      });
      try {
        return await Promise.race([eng.analyze(fen, DEPTH, BUDGET_MS - 2000), budget]);
      } catch (e) {
        if (this.engine === eng) this.engine = null;
        eng.stop().catch(() => { /* already gone */ });
        throw e;
      } finally {
        if (timer) clearTimeout(timer);
        this.touch();
      }
    };
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next;
  }

  /** Nobody asked for five minutes → let the process go. */
  private touch() {
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => {
      const e = this.engine; this.engine = null;
      e?.stop().catch(() => { /* fine */ });
    }, IDLE_MS);
    this.idle.unref?.();
  }

  async onModuleDestroy() {
    if (this.idle) clearTimeout(this.idle);
    const e = this.engine; this.engine = null;
    try { await e?.stop(); } catch { /* fine */ }
  }
}

function apply(c: Chess, uci: string) {
  try {
    return c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: (uci[4] as any) || undefined }) ?? null;
  } catch { return null; }
}

function isLegal(c: Chess, uci: string): boolean {
  return (c.moves({ verbose: true }) as any[]).some((m) =>
    m.from === uci.slice(0, 2) && m.to === uci.slice(2, 4) && (!uci[4] || m.promotion === uci[4]));
}

/** The position the solver faced when they played `wrong`. line[0] is the
 *  opponent's setup move; the solver moves on the odd plies. The round does
 *  not record WHICH ply went wrong, so take the first solver ply where the
 *  move is legal and is not the expected one. */
function positionFaced(fen: string, line: string[], wrong: string): string | null {
  const c = new Chess(fen);
  for (let i = 0; i < line.length; i++) {
    const expected = line[i];
    if (!expected) return null;
    if (i % 2 === 1 && expected !== wrong && isLegal(c, wrong)) return c.fen();
    if (!apply(c, expected)) return null;
  }
  return null;
}
