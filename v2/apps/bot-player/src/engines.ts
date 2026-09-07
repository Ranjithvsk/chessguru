import { UciProc } from "./uci";

const LC0 = process.env.LC0_BIN ?? "/home/dreamworld/opt/engines/src/lc0/build/lc0";
const MAIA1_DIR = process.env.MAIA1_WEIGHTS ?? "/home/dreamworld/opt/engines/weights/maia1";
const ENGINE_SRC = process.env.ENGINE_SRC ?? "/home/dreamworld/opt/engines/src";
const MAIA1_LEVELS = [1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900] as const;
/** Hard address-space ceiling for the survey engines (`prlimit --as`). None of them has a hash
 *  option and Minace in particular allocates without bound on a long search: on 2026-09-07 it
 *  reached 10-20 GB four times and each OOM-kill took every terminal on the box down with it.
 *  At the cap malloc fails, the engine dies, and UciProc respawns it on the next move. */
const PLAIN_ENGINE_AS_BYTES = Number(process.env.PLAIN_ENGINE_AS_MB ?? 2048) * 1024 * 1024;

export interface Think {
  uci: string;
  /** 0..1 chance two independent policy draws agree. 1 = the move is forced. Paces thinkMs. */
  collision: number;
}

export interface ThinkCtx {
  moves: string[];
  opponentRating: number;
}

export interface BotEngine {
  readonly id: string;
  /** Epoch ms of the last think. The pool reaps processes nobody has used. */
  lastUsed: number;
  think(ctx: ThinkCtx): Promise<Think>;
  kill(): void;
}

/** Play the top policy move, breaking near-ties at random: a move is eligible only if the
 *  net rates it at least this fraction of its best move.
 *
 *  Do NOT turn this into full-distribution sampling. Maia's rating calibration is *defined*
 *  by argmax play, so drawing from the tail makes a net play well below its own band and
 *  destroys the "level is the rating by construction" property that is the whole reason to
 *  prefer Maia-1 over Maia-3's compressed dial. Variety between games is meant to come from
 *  the engine mix, not from degrading each engine's move choice.
 *
 *  Ties are worth breaking though, and they carry real signal. In the Blackburne Shilling
 *  trap maia-1100 rates Nxe5?? 24.58% and Nxd4 24.52% — a genuine coin flip for an 1100,
 *  and reproducing it as a coin flip is more honest than always falling for the trap. */
const TIE_RATIO = 0.8;

/** One Maia-1 rating level, hosted by lc0.
 *
 *  These are POLICY-ONLY networks: the human-likeness is the raw policy head, so every `go`
 *  must be `go nodes 1`. Give it a real search and you get a weak Leela instead of a human
 *  at that rating. Unlike Maia-3 there is no strength dial to calibrate — the level *is* the
 *  rating, because each net was trained only on human games in that band. */
export class Maia1Engine implements BotEngine {
  readonly id: string;
  lastUsed = Date.now();
  private tail: Promise<unknown> = Promise.resolve();
  private readonly proc: UciProc;

  constructor(private readonly level: number) {
    this.id = `maia1-${level}`;
    this.proc = new UciProc(LC0, [`--weights=${MAIA1_DIR}/maia-${level}.pb.gz`, "--backend=eigen"], {
      timeoutMs: 20000,
      // At `nodes 1` this prints the whole policy head, so one `go` yields both the move
      // distribution and its concentration — no resampling needed.
      setoptions: ["setoption name VerboseMoveStats value true"],
    });
  }

  think(ctx: ThinkCtx): Promise<Think> {
    const run = this.tail.then(() => this.thinkNow(ctx));
    this.tail = run.catch(() => {});
    return run;
  }

  private async thinkNow({ moves }: ThinkCtx): Promise<Think> {
    this.lastUsed = Date.now();
    await this.proc.ready();
    this.proc.send(`position startpos${moves.length ? ` moves ${moves.join(" ")}` : ""}`);
    const out = await this.proc.waitFor((l) => l.startsWith("bestmove"), "go nodes 1");

    const policy = parsePolicy(out);
    const best = out[out.length - 1]?.split(/\s+/)[1];
    if (!policy.length) {
      if (!best || best === "(none)") throw new Error(`${this.id} produced no move`);
      return { uci: best, collision: 0.5 };
    }
    return { uci: pickMove(policy), collision: collisionOf(policy) };
  }

  kill(): void {
    this.proc.kill();
  }
}

const POLICY_LINE = /^info string ([a-h][1-8][a-h][1-8][qrbn]?)\s.*\(P:\s*([\d.]+)%\)/;

/** lc0's VerboseMoveStats rows, normalised to a probability distribution. The root summary
 *  row is named `node`, so requiring a UCI move filters it out. */
function parsePolicy(lines: string[]): { uci: string; p: number }[] {
  const out: { uci: string; p: number }[] = [];
  let total = 0;
  for (const line of lines) {
    const m = POLICY_LINE.exec(line);
    if (!m) continue;
    const p = Number(m[2]);
    if (!(p > 0)) continue;
    out.push({ uci: m[1]!, p });
    total += p;
  }
  if (!total) return [];
  for (const e of out) e.p /= total;
  return out.sort((a, b) => b.p - a.p);
}

/** The best move, or a uniform pick among moves the net rates as good as the best. */
function pickMove(policy: { uci: string; p: number }[]): string {
  const floor = policy[0]!.p * TIE_RATIO;
  const tied = policy.filter((e) => e.p >= floor);
  return tied[Math.floor(Math.random() * tied.length)]!.uci;
}

/** Order-2 Renyi collision probability of the policy. */
function collisionOf(policy: { uci: string; p: number }[]): number {
  let sum = 0;
  for (const e of policy) sum += e.p * e.p;
  return Math.min(1, sum);
}

export interface PlainSpec {
  id: string;
  bin: string;
  args?: string[];
  cwd?: string;
  setoptions?: string[];
  movetimeMs?: number;
  /** Engine ignores `go movetime`; drive it with `go infinite` + a timed `stop`. */
  stopBased?: boolean;
}

/** Any ordinary UCI engine. These have no policy head, so `collision` is a flat guess and
 *  the think-time model falls back to its clock-based estimate alone. */
export class PlainUciEngine implements BotEngine {
  readonly id: string;
  lastUsed = Date.now();
  private tail: Promise<unknown> = Promise.resolve();
  private readonly proc: UciProc;
  private readonly movetimeMs: number;

  constructor(private readonly spec: PlainSpec) {
    this.id = spec.id;
    this.movetimeMs = spec.movetimeMs ?? 600;
    this.proc = new UciProc("prlimit", [`--as=${PLAIN_ENGINE_AS_BYTES}`, spec.bin, ...(spec.args ?? [])], {
      cwd: spec.cwd,
      timeoutMs: 20000,
      setoptions: spec.setoptions,
      label: spec.bin,
    });
  }

  think(ctx: ThinkCtx): Promise<Think> {
    const run = this.tail.then(() => this.thinkNow(ctx));
    this.tail = run.catch(() => {});
    return run;
  }

  private async thinkNow({ moves }: ThinkCtx): Promise<Think> {
    this.lastUsed = Date.now();
    await this.proc.ready();
    this.proc.send(`position startpos${moves.length ? ` moves ${moves.join(" ")}` : ""}`);

    const done = this.proc.waitFor((l) => l.startsWith("bestmove"), this.spec.stopBased ? "go infinite" : `go movetime ${this.movetimeMs}`);
    const stopper = this.spec.stopBased ? setTimeout(() => this.proc.send("stop"), this.movetimeMs) : null;
    let out: string[];
    try {
      out = await done;
    } finally {
      if (stopper) clearTimeout(stopper);
    }

    const best = out[out.length - 1]?.split(/\s+/)[1];
    if (!best || best === "(none)") throw new Error(`${this.id} produced no move`);
    return { uci: best, collision: 0.5 };
  }

  kill(): void {
    this.proc.kill();
  }
}

/** The survivors of the 2026-09-06 open-source engine survey. None of them has a strength
 *  dial and they all land around 1800-2000, so they exist purely to vary the *style* a
 *  player of roughly that strength meets — see PROJECT_MASTER/sessions/2026-09-06-low-rated-engine-survey.md. */
export const PLAIN_VARIETY: PlainSpec[] = [
  { id: "sunfish", bin: "python3", args: ["-u", "sunfish.py"], cwd: `${ENGINE_SRC}/sunfish` },
  { id: "minace", bin: `${ENGINE_SRC}/Minace/Minace/dist/Release/GNU-Linux-x86/minace` },
  { id: "mchess2", bin: `${ENGINE_SRC}/mchess2/mchess.exe` },
  { id: "weak", bin: `${ENGINE_SRC}/weak-chess-engine/weak` },
  { id: "claudia", bin: `${ENGINE_SRC}/Claudia/claudia`, stopBased: true },
];

export type EngineSpec =
  | { kind: "maia1"; id: string; level: number }
  | { kind: "maia3"; id: string }
  | { kind: "plain"; id: string; plain: PlainSpec };

function stockfishSpec(rating: number): EngineSpec {
  // Bucketed so the pool doesn't spawn a fresh process for every distinct opponent rating.
  const elo = Math.round(Math.min(3190, Math.max(1320, rating)) / 50) * 50;
  return {
    kind: "plain",
    id: `stockfish-${elo}`,
    plain: {
      id: `stockfish-${elo}`,
      bin: `${ENGINE_SRC}/Stockfish/src/stockfish`,
      setoptions: ["setoption name UCI_LimitStrength value true", `setoption name UCI_Elo value ${elo}`],
    },
  };
}

function maia1Spec(rating: number): EngineSpec {
  const level = MAIA1_LEVELS.reduce((best, l) => (Math.abs(l - rating) < Math.abs(best - rating) ? l : best));
  return { kind: "maia1", id: `maia1-${level}`, level };
}

const VARIETY_CHANCE = Number(process.env.BOT_VARIETY_CHANCE ?? 0.25);

/** Alternatives to the Maia-1 ladder that are honestly playable at this rating. Every entry
 *  is gated on the band it was actually measured in — an uncalibrated ~1900 engine must
 *  never be handed to a 1200 student. */
function varietyFor(rating: number): EngineSpec[] {
  const pool: EngineSpec[] = [];
  // Maia-3's SelfElo dial is compressed 0.46x, so it only reaches ~1130-1690 in practice.
  if (rating >= 1130 && rating <= 1690) pool.push({ kind: "maia3", id: "maia3" });
  if (rating >= 1700 && rating <= 2100) for (const s of PLAIN_VARIETY) pool.push({ kind: "plain", id: s.id, plain: s });
  if (rating > 1500) pool.push(stockfishSpec(rating));
  return pool;
}

export function pickEngine(rating: number): EngineSpec {
  const alt = varietyFor(rating);
  if (alt.length && Math.random() < VARIETY_CHANCE) return alt[Math.floor(Math.random() * alt.length)]!;
  // The ladder tops out at 1900; past that only Stockfish's UCI_Elo still reaches.
  return rating > 2000 ? stockfishSpec(rating) : maia1Spec(rating);
}

const IDLE_MS = 10 * 60 * 1000;

/** Keeps one process per engine id alive across games. lc0 costs ~105MB resident and ~160ms
 *  to hand-shake, so caching matters far less than not leaking nine nets plus the variety
 *  set forever. */
export class EnginePool {
  private readonly live = new Map<string, BotEngine>();

  constructor(private readonly makeMaia3: () => BotEngine) {}

  acquire(spec: EngineSpec): BotEngine {
    const hit = this.live.get(spec.id);
    if (hit) {
      hit.lastUsed = Date.now();
      return hit;
    }
    const engine =
      spec.kind === "maia1" ? new Maia1Engine(spec.level) : spec.kind === "maia3" ? this.makeMaia3() : new PlainUciEngine(spec.plain);
    this.live.set(spec.id, engine);
    return engine;
  }

  sweep(): void {
    const cutoff = Date.now() - IDLE_MS;
    for (const [id, engine] of this.live) {
      if (engine.lastUsed >= cutoff) continue;
      engine.kill();
      this.live.delete(id);
    }
  }

  /** Tear every engine down. Must run on our own exit: a child engine only sees stdin EOF
   *  when we die, and Minace (at least) never exits on EOF — it spins and allocates until
   *  something kills it, which on 2026-09-07 was the kernel, four times. */
  killAll(): void {
    for (const [id, engine] of this.live) {
      engine.kill();
      this.live.delete(id);
    }
  }
}
