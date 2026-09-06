import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

// Maia-3 is AGPL. It runs as its own unmodified process and is reached only over the
// UCI stdio boundary — never imported, patched or vendored. See
// PROJECT_MASTER/plans/human-like-bot-opponent.md.
const BIN = process.env.MAIA_BIN ?? "/home/dreamworld/opt/maia3/.venv/bin/maia3-uci";
const MODEL = process.env.MAIA_MODEL ?? "maia3-5m";
const GO_TIMEOUT_MS = 15000;

export interface Think {
  /** The move to play — the first policy sample. */
  uci: string;
  /** Estimated collision probability of the policy, 0..1. High = the move is forced. */
  collision: number;
}

/** One long-lived engine process, serialised. SelfElo/OppoElo are process-global, so
 *  two games must never be mid-`go` at the same time. */
export class MaiaEngine {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buf = "";
  private lineHandler: ((line: string) => void) | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  private elos: [number, number] | null = null;

  private start(): void {
    // Keep this argv in lockstep with scripts/maia_calibration.py — the SelfElo mapping
    // in think.ts is only valid for the exact engine configuration it was measured on.
    const p = spawn(BIN, ["--model", MODEL, "--device", "cpu", "--no-use-amp", "--use-uci-history"], { stdio: ["pipe", "pipe", "pipe"] });
    p.stdout.setEncoding("utf8");
    p.stdout.on("data", (chunk: string) => {
      this.buf += chunk;
      let i: number;
      while ((i = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        if (line) this.lineHandler?.(line);
      }
    });
    p.stderr.on("data", () => {}); // model load chatter
    p.on("exit", (code) => {
      console.error(`[bot] engine exited (${code}) — will respawn on next use`);
      if (this.proc === p) this.proc = null;
      this.elos = null;
    });
    this.proc = p;
  }

  private send(cmd: string): void {
    this.proc?.stdin.write(`${cmd}\n`);
  }

  /** Send a command and collect output up to the line matching `done`. */
  private until(cmd: string, done: (l: string) => boolean): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const lines: string[] = [];
      const timer = setTimeout(() => {
        this.lineHandler = null;
        this.kill();
        reject(new Error(`engine timeout on "${cmd}"`));
      }, GO_TIMEOUT_MS);
      this.lineHandler = (line) => {
        lines.push(line);
        if (!done(line)) return;
        clearTimeout(timer);
        this.lineHandler = null;
        resolve(lines);
      };
      this.send(cmd);
    });
  }

  kill(): void {
    this.proc?.kill("SIGKILL");
    this.proc = null;
    this.elos = null;
  }

  private async ready(): Promise<void> {
    if (this.proc) return;
    this.start();
    this.buf = "";
    await this.until("uci", (l) => l === "uciok");
    await this.until("isready", (l) => l === "readyok");
  }

  /** Queue a think. `samples` independent policy draws; the first is the move played,
   *  the agreement rate across the rest estimates how forced the position is. */
  think(moves: string[], selfElo: number, oppoElo: number, samples = 4): Promise<Think> {
    const run = this.tail.then(() => this.thinkNow(moves, selfElo, oppoElo, samples));
    this.tail = run.catch(() => {});
    return run;
  }

  private async thinkNow(moves: string[], selfElo: number, oppoElo: number, samples: number): Promise<Think> {
    await this.ready();
    if (!this.elos || this.elos[0] !== selfElo || this.elos[1] !== oppoElo) {
      this.send(`setoption name SelfElo value ${selfElo}`);
      this.send(`setoption name OppoElo value ${oppoElo}`);
      this.elos = [selfElo, oppoElo];
    }
    const position = `position startpos${moves.length ? ` moves ${moves.join(" ")}` : ""}`;

    const drawn: string[] = [];
    for (let i = 0; i < samples; i++) {
      this.send(position);
      const out = await this.until("go", (l) => l.startsWith("bestmove"));
      const best = out[out.length - 1]?.split(/\s+/)[1];
      if (!best || best === "(none)") break;
      drawn.push(best);
    }
    const first = drawn[0];
    if (!first) throw new Error("engine produced no move");

    return { uci: first, collision: collisionProbability(drawn) };
  }
}

/** Unbiased estimate of the chance two independent policy draws agree (order-2 Renyi
 *  collision probability). 1 = only one move ever comes back. */
function collisionProbability(draws: string[]): number {
  const n = draws.length;
  if (n < 2) return 0.5;
  const counts = new Map<string, number>();
  for (const d of draws) counts.set(d, (counts.get(d) ?? 0) + 1);
  let pairs = 0;
  for (const c of counts.values()) pairs += c * (c - 1);
  return pairs / (n * (n - 1));
}
