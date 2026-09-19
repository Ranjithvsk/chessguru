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

/** Thrown instead of handing Stockfish a position that would kill it. Distinct
 *  from an engine fault so callers can skip the position without tearing down a
 *  process that is still perfectly healthy. */
export class UnsafeFenError extends Error {
  constructor(readonly fen: string, reason: string) {
    super(`unsafe FEN for engine (${reason}): ${JSON.stringify(String(fen).slice(0, 120))}`);
    this.name = "UnsafeFenError";
  }
}

/** Stockfish assumes it is given a legal position and does not defend against
 *  one that isn't. A board with a king missing makes `square<KING>()` return an
 *  invalid square, which then indexes the magic-bitboard `Magics[]` array out of
 *  range; the sliding-attack lookup dereferences the garbage pointer it finds
 *  there and the process dies with SIGSEGV. Verified 2026-09-19 against SF 18:
 *  an empty board, either king missing, both missing, an unparseable string and
 *  an empty string all crash at the same instruction offset (0x2aed9) as every
 *  production crash — ~2-3 an hour, each writing a ~370 MB core dump.
 *
 *  This checks only what actually crashes it. Positions that are odd but legal —
 *  nine queens, both kings adjacent, the side to move already giving check —
 *  are Stockfish's business and pass through untouched. Returns null when safe,
 *  otherwise the reason it isn't. */
export function unsafeFenReason(fen: unknown): string | null {
  if (typeof fen !== "string") return "not a string";
  const board = fen.trim().split(/\s+/)[0] ?? "";
  if (!board) return "empty";
  const ranks = board.split("/");
  if (ranks.length !== 8) return `${ranks.length} ranks, expected 8`;
  let whiteKings = 0, blackKings = 0;
  for (const rank of ranks) {
    let squares = 0;
    for (const ch of rank) {
      if (ch >= "1" && ch <= "8") { squares += Number(ch); continue; }
      if (!"KQRBNPkqrbnp".includes(ch)) return `bad character ${JSON.stringify(ch)}`;
      squares += 1;
      if (ch === "K") whiteKings++;
      else if (ch === "k") blackKings++;
    }
    if (squares !== 8) return `rank ${JSON.stringify(rank)} covers ${squares} squares, expected 8`;
  }
  if (whiteKings !== 1) return `${whiteKings} white kings`;
  if (blackKings !== 1) return `${blackKings} black kings`;
  return null;
}

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

  // movetimeMs (optional): also cap the search by time — UCI stops at whichever limit comes first.
  // game-motifs uses it to keep a 150-ply game under ~20 s; my-games keeps its depth-only search.
  async analyze(fen: string, depth: number = 15, movetimeMs?: number): Promise<PositionEval> {
    if (!this.proc) throw new Error("stockfish not started");
    // Guard BEFORE the engine ever sees it — a kingless position takes the
    // process down with it, and the caller loses the whole analysis plus a
    // 370 MB core dump. See unsafeFenReason.
    const bad = unsafeFenReason(fen);
    if (bad) throw new UnsafeFenError(fen, bad);
    this.send("position fen " + fen);
    this.send(movetimeMs ? `go depth ${depth} movetime ${Math.max(20, Math.round(movetimeMs))}` : `go depth ${depth}`);
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
