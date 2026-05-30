import type { GameState } from "./snapshot";

export interface AppendResult {
  ok: boolean;
  code?: string;
  /** index of the appended entry, when ok */
  seq?: number;
}

/**
 * The M0 stand-in for a chess RoundGrain: an append-only log with the exact
 * ordering/idempotency contract a real game needs. `seq` is the entry index;
 * an append must declare the seq it expects to write (== current length).
 * M1 replaces this class with a chess position + legality, leaving the
 * directory / mailbox / lease / snapshot machinery untouched.
 */
export class EchoGrain {
  log: string[] = [];

  get seq(): number {
    return this.log.length;
  }

  hydrate(st: GameState | null): void {
    if (st) this.log = st.log.slice();
  }

  state(): GameState {
    return { log: this.log.slice(), seq: this.log.length };
  }

  tail(from: number): string[] {
    return this.log.slice(Math.max(0, from));
  }

  append(text: string, expectedSeq: number): AppendResult {
    if (expectedSeq !== this.log.length) return { ok: false, code: "stale-seq" };
    this.log.push(text);
    return { ok: true, seq: this.log.length - 1 };
  }
}
