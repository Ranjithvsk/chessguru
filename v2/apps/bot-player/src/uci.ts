import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

/** A line-oriented UCI process.
 *
 *  Every engine we drive is GPL or AGPL, so each one runs as its own unmodified process
 *  reached only over this stdio boundary — never imported, patched or vendored. See
 *  PROJECT_MASTER/plans/human-like-bot-opponent.md.
 *
 *  Only one `waitFor` may be outstanding at a time; callers serialise their own commands. */
export class UciProc {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buf = "";
  private lineHandler: ((line: string) => void) | null = null;

  constructor(
    private readonly bin: string,
    private readonly args: string[],
    private readonly opts: {
      cwd?: string;
      timeoutMs: number;
      /** Sent between `uciok` and `isready`. */
      setoptions?: string[];
      onExit?: () => void;
    },
  ) {}

  private start(): void {
    const p = spawn(this.bin, this.args, { stdio: ["pipe", "pipe", "pipe"], cwd: this.opts.cwd });
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
    p.stderr.on("data", () => {}); // model-load chatter
    p.on("exit", (code) => {
      if (this.proc !== p) return;
      this.proc = null;
      this.opts.onExit?.();
      console.error(`[bot] ${this.bin} exited (${code}) — will respawn on next use`);
    });
    // lc0 quits the moment stdin reaches EOF, so the pipe stays open for the process's life.
    this.proc = p;
  }

  send(cmd: string): void {
    this.proc?.stdin.write(`${cmd}\n`);
  }

  /** Collect output until `done` matches, optionally sending `cmd` first. */
  waitFor(done: (line: string) => boolean, cmd?: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const lines: string[] = [];
      const timer = setTimeout(() => {
        this.lineHandler = null;
        this.kill();
        reject(new Error(`engine timeout on "${cmd ?? "wait"}"`));
      }, this.opts.timeoutMs);
      this.lineHandler = (line) => {
        lines.push(line);
        if (!done(line)) return;
        clearTimeout(timer);
        this.lineHandler = null;
        resolve(lines);
      };
      if (cmd) this.send(cmd);
    });
  }

  kill(): void {
    this.proc?.kill("SIGKILL");
    this.proc = null;
  }

  /** Spawn and handshake if the process is not already up. */
  async ready(): Promise<void> {
    if (this.proc) return;
    this.start();
    this.buf = "";
    await this.waitFor((l) => l === "uciok", "uci");
    for (const o of this.opts.setoptions ?? []) this.send(o);
    await this.waitFor((l) => l === "readyok", "isready");
  }
}
