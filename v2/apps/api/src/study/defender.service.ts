// Study-trainer defender (owner ask 2026-09-19: "all the defence in study are poor… create
// defence level according to rating, like best defence, easy, hard, but it should not take
// for ever to play").
//
// Why: every drill used browser Stockfish with 400 ms — ~250k nodes on a phone. In K+R vs K
// the mate is 30 plies deep, far beyond that horizon, and SF16's neural eval has no idea a
// lone king should stay central, so it walked e4→a2 and got mated in 12 where best defence
// lasts 16. Measured: 250k nodes → mated in 12; 2.5M nodes (3–5 s on a phone) → still 2
// moves short; Stockfish 18 + Syzygy at 300 ms → 1 move short; a direct DTZ probe → exact.
//
// Levels — owner 2026-09-19: "easy medium hard, these 3":
//   hard   → tools/tb_oracle.py (Syzygy 3-4-5, exact, ~5 ms) for ≤5 pieces; Stockfish 18 with
//            tablebases, 400 ms, otherwise. Never gives a ply away where the tables apply.
//   medium → Stockfish 18 with tablebases, 300 ms — near-optimal (its root tablebase ranking was
//            measured 4 plies short over a whole K+R vs K game; the oracle never is).
//   easy   → handled in the browser (Skill Level 3, 150 ms); never reaches here.
// ("best" from an older bundle is accepted as hard.)
// One engine process per level, requests serialized per process, 4 s hard timeout → the
// trainer falls back to its browser engine, so a stall can never freeze a drill.
import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { spawn, ChildProcess } from "child_process";
import * as fs from "fs";

export type DefenceLevel = "medium" | "hard";
export interface DefenceResult { move: string | null; mateIn: number | null; wdl?: number; source: "oracle" | "stockfish"; level: DefenceLevel; ms: number }

const STOCKFISH_PATH = process.env.STOCKFISH_PATH ?? "/home/ubuntu/engines/stockfish";
const SYZYGY_DIR = process.env.SYZYGY_DIR ?? "/home/ubuntu/engines/syzygy";
const ORACLE_URL = process.env.TB_ORACLE_URL ?? "http://127.0.0.1:4731";
const MOVETIME: Record<DefenceLevel, number> = { medium: 300, hard: 400 };
const HARD_TIMEOUT_MS = 4000;

class Uci {
  private proc: ChildProcess | null = null;
  private buf = "";
  private onLine: ((l: string) => void) | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private readonly opts: Record<string, string | number>) {}
  private async start() {
    this.proc = spawn(STOCKFISH_PATH, [], { stdio: ["pipe", "pipe", "ignore"] });
    this.proc.stdout!.on("data", (d) => {
      this.buf += d.toString();
      let i;
      while ((i = this.buf.indexOf("\n")) >= 0) { const l = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1); this.onLine?.(l); }
    });
    this.proc.on("exit", () => { this.proc = null; });
    await this.cmd("uci", (l) => l === "uciok");
    for (const [k, v] of Object.entries(this.opts)) this.send(`setoption name ${k} value ${v}`);
    await this.cmd("isready", (l) => l === "readyok");
  }
  private send(s: string) { this.proc?.stdin?.write(s + "\n"); }
  private cmd(s: string, done: (l: string) => boolean, collect?: (l: string) => void): Promise<void> {
    return new Promise((resolve) => { this.onLine = (l) => { collect?.(l); if (done(l)) { this.onLine = null; resolve(); } }; this.send(s); });
  }
  /** Serialized: one search at a time per process. */
  bestMove(fen: string, movetimeMs: number): Promise<{ move: string | null; mate: number | null }> {
    const run = async () => {
      if (!this.proc) await this.start();
      let mate: number | null = null; let move: string | null = null;
      await this.cmd(`position fen ${fen}\ngo movetime ${movetimeMs}`, (l) => l.startsWith("bestmove"), (l) => {
        const m = / score mate (-?\d+)/.exec(l); if (m) mate = Number(m[1]);
        if (l.startsWith("bestmove")) { const t = l.split(/\s+/)[1]; move = t && t !== "(none)" ? t : null; }
      });
      return { move, mate };
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => undefined);
    return p;
  }
  kill() { try { this.proc?.kill(); } catch { /* */ } this.proc = null; }
}

@Injectable()
export class DefenderService implements OnModuleDestroy {
  private readonly engines: Record<DefenceLevel, Uci>;
  constructor() {
    const tb = fs.existsSync(SYZYGY_DIR) && fs.readdirSync(SYZYGY_DIR).some((f) => f.endsWith(".rtbw"));
    this.engines = {
      medium: new Uci({ Threads: 2, Hash: 64, ...(tb ? { SyzygyPath: SYZYGY_DIR } : {}) }),
      hard: new Uci({ Threads: 2, Hash: 64, ...(tb ? { SyzygyPath: SYZYGY_DIR } : {}) }),
    };
  }
  onModuleDestroy() { for (const e of Object.values(this.engines)) e.kill(); }

  private async oracle(fen: string): Promise<{ move: string; mateIn: number | null; wdl: number } | null> {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 1500);
      const r = await fetch(`${ORACLE_URL}/defend?fen=${encodeURIComponent(fen)}`, { signal: ctl.signal }).finally(() => clearTimeout(t));
      const j: any = await r.json();
      return j?.ok && j.move ? { move: String(j.move), mateIn: typeof j.mateIn === "number" ? j.mateIn : null, wdl: Number(j.wdl) } : null;
    } catch { return null; }
  }

  async defend(fen: string, level: DefenceLevel): Promise<DefenceResult> {
    const r = await this.defendInner(fen, level);
    // eslint-disable-next-line no-console
    console.log(`[study-defend] ${level} ${r.source} ${r.move ?? "-"} mateIn=${r.mateIn ?? "-"} ${r.ms}ms fen="${fen}"`);
    return r;
  }
  private async defendInner(fen: string, level: DefenceLevel): Promise<DefenceResult> {
    const t0 = Date.now();
    if (level === "hard") {
      const o = await this.oracle(fen);
      if (o) return { move: o.move, mateIn: o.mateIn, wdl: o.wdl, source: "oracle", level, ms: Date.now() - t0 };
    }
    const engine = this.engines[level];
    const r = await Promise.race([
      engine.bestMove(fen, MOVETIME[level]),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("defender timeout")), HARD_TIMEOUT_MS)),
    ]).catch((e) => { engine.kill(); throw e; });
    // r.mate is from the side to move: negative = the defender is being mated in |n|.
    return { move: r.move, mateIn: r.mate != null ? Math.abs(r.mate) : null, source: "stockfish", level, ms: Date.now() - t0 };
  }
}
