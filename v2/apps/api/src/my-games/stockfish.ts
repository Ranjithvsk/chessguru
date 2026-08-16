// Thin wrapper around a Stockfish subprocess. One instance per analysis
// session — spawn, feed positions via UCI, kill when done. NOT a pool.
//
// Concurrency: the analyzer service holds at most 1 live Stockfish at a
// time (protects the shared France box from thrash). Games queue up and
// get analyzed serially.

import { spawn, ChildProcess } from "child_process";

export interface PositionEval {
  cp?: number;          // eval in centipawns, from side-to-move's perspective
  mate?: number;        // mate distance (positive = we mate in N; negative = opponent mates)
  bestMoveUci: string | null;
  pv: string[];         // principal variation
  depth: number;
}

const STOCKFISH_PATH = process.env.STOCKFISH_PATH ?? "/home/ubuntu/engines/stockfish";

export class Stockfish {
  private proc: ChildProcess | null = null;
  private buffer = "";
  private lineResolvers: ((line: string) => boolean)[] = [];

  async start(): Promise<void> {
    if (this.proc) return;
    this.proc = spawn(STOCKFISH_PATH, [], { stdio: ["pipe", "pipe", "ignore"] });
    this.proc.stdout?.on("data", (d: Buffer) => this.onData(d.toString()));
    await this.waitFor((l) => l === "uciok", () => this.send("uci"));
    this.send("setoption name Hash value 256");
    this.send("setoption name Threads value 2");
    this.send("setoption name MultiPV value 1");
    await this.waitFor((l) => l === "readyok", () => this.send("isready"));
  }

  async analyze(fen: string, depth: number = 15): Promise<PositionEval> {
    if (!this.proc) throw new Error("stockfish not started");
    this.send("position fen " + fen);
    this.send(`go depth ${depth}`);
    let latestCp: number | undefined;
    let latestMate: number | undefined;
    let latestDepth = 0;
    let latestPv: string[] = [];
    let bestMove: string | null = null;
    await this.waitFor((line) => {
      if (line.startsWith("info ") && line.includes(" pv ")) {
        const d = /depth (\d+)/.exec(line);
        if (d) latestDepth = Number(d[1]);
        const scoreCp = /score cp (-?\d+)/.exec(line);
        const scoreMate = /score mate (-?\d+)/.exec(line);
        if (scoreCp) { latestCp = Number(scoreCp[1]); latestMate = undefined; }
        else if (scoreMate) { latestMate = Number(scoreMate[1]); latestCp = undefined; }
        const pvIdx = line.indexOf(" pv ");
        if (pvIdx >= 0) latestPv = line.slice(pvIdx + 4).split(/\s+/).filter(Boolean);
      } else if (line.startsWith("bestmove ")) {
        const m = /bestmove (\S+)/.exec(line);
        bestMove = m && m[1] ? (m[1] === "(none)" ? null : m[1]) : null;
        return true;
      }
      return false;
    });
    return {
      cp: latestCp,
      mate: latestMate,
      bestMoveUci: bestMove,
      pv: latestPv,
      depth: latestDepth,
    };
  }

  async stop(): Promise<void> {
    if (!this.proc) return;
    try { this.send("quit"); } catch { /* ignore */ }
    const p = this.proc;
    this.proc = null;
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => { try { p.kill("SIGKILL"); } catch {} resolve(); }, 500);
      p.once("exit", () => { clearTimeout(t); resolve(); });
    });
  }

  private send(cmd: string) {
    this.proc?.stdin?.write(cmd + "\n");
  }

  private onData(chunk: string) {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).replace(/\r$/, "");
      this.buffer = this.buffer.slice(idx + 1);
      // Try each resolver in order; if any returns true, drop it.
      const kept: typeof this.lineResolvers = [];
      for (const r of this.lineResolvers) {
        if (!r(line)) kept.push(r);
      }
      this.lineResolvers = kept;
    }
  }

  private waitFor(match: (line: string) => boolean, kick?: () => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("stockfish timeout")), 30000);
      const resolver = (line: string) => {
        try {
          if (match(line)) {
            clearTimeout(timeout);
            resolve();
            return true;
          }
        } catch (e) { clearTimeout(timeout); reject(e); return true; }
        return false;
      };
      this.lineResolvers.push(resolver);
      if (kick) kick();
    });
  }
}

/** Convert a Stockfish score from side-to-move perspective to WHITE's perspective
 *  in centipawns. Mates get mapped to ±100000 minus distance. */
export function toWhiteCp(ev: PositionEval, sideToMove: "white" | "black"): number {
  let cp: number;
  if (ev.mate !== undefined) {
    cp = ev.mate > 0 ? 100000 - Math.abs(ev.mate) : -(100000 - Math.abs(ev.mate));
  } else if (ev.cp !== undefined) {
    cp = ev.cp;
  } else {
    cp = 0;
  }
  return sideToMove === "white" ? cp : -cp;
}
