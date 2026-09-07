import type { BotEngine, Think, ThinkCtx } from "./engines";
import { selfEloFor } from "./think";
import { UciProc } from "./uci";

// Maia-3 is AGPL. It runs as its own unmodified process and is reached only over the
// UCI stdio boundary — never imported, patched or vendored. See
// PROJECT_MASTER/plans/human-like-bot-opponent.md.
const BIN = process.env.MAIA_BIN ?? "/home/dreamworld/opt/maia3/.venv/bin/maia3-uci";
const MODEL = process.env.MAIA_MODEL ?? "maia3-5m";
const GO_TIMEOUT_MS = 15000;
const SAMPLES = 4;

/** One rating-conditioned network whose strength is set per game by `SelfElo`. Those options
 *  are process-global, so thinks are serialised and two games can never be mid-`go` at once.
 *
 *  Maia-3 gives no policy distribution, so the position's forcedness is estimated by drawing
 *  the same position several times and measuring how often the draws agree. */
export class Maia3Engine implements BotEngine {
  readonly id = "maia3";
  lastUsed = Date.now();
  private tail: Promise<unknown> = Promise.resolve();
  private elos: [number, number] | null = null;
  private readonly proc: UciProc;

  constructor() {
    // Keep this argv in lockstep with scripts/maia_calibration.py — the SelfElo mapping
    // in think.ts is only valid for the exact engine configuration it was measured on.
    this.proc = new UciProc(BIN, ["--model", MODEL, "--device", "cpu", "--no-use-amp", "--use-uci-history"], {
      timeoutMs: GO_TIMEOUT_MS,
      onExit: () => {
        this.elos = null;
      },
    });
  }

  think(ctx: ThinkCtx): Promise<Think> {
    const run = this.tail.then(() => this.thinkNow(ctx));
    this.tail = run.catch(() => {});
    return run;
  }

  private async thinkNow({ moves, opponentRating }: ThinkCtx): Promise<Think> {
    this.lastUsed = Date.now();
    await this.proc.ready();

    const selfElo = selfEloFor(opponentRating);
    if (!this.elos || this.elos[0] !== selfElo || this.elos[1] !== opponentRating) {
      this.proc.send(`setoption name SelfElo value ${selfElo}`);
      this.proc.send(`setoption name OppoElo value ${opponentRating}`);
      this.elos = [selfElo, opponentRating];
    }
    const position = `position startpos${moves.length ? ` moves ${moves.join(" ")}` : ""}`;

    const drawn: string[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      this.proc.send(position);
      const out = await this.proc.waitFor((l) => l.startsWith("bestmove"), "go");
      const best = out[out.length - 1]?.split(/\s+/)[1];
      if (!best || best === "(none)") break;
      drawn.push(best);
    }
    const first = drawn[0];
    if (!first) throw new Error("engine produced no move");

    return { uci: first, collision: collisionProbability(drawn) };
  }

  kill(): void {
    this.proc.kill();
    this.elos = null;
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
