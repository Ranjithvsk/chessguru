import type Redis from "ioredis";
import { keys, LEASE_MS } from "@chessguru/protocol";
import type { Clock, GameStatus, Players, TimeControl } from "@chessguru/protocol";

/** Hot recovery state: enough to rebuild the position by replay AND restore the
 *  clock across a re-placement (turnStartedAt is epoch-ms, so it's portable). */
export interface GameState {
  initialFen: string;
  moves: string[];
  players: Players;
  status: GameStatus;
  result: string | null;
  startedAt: number;
  finishedAt?: number;
  timeControl: TimeControl;
  clockRemaining: Clock;
  clockStarted: boolean;
  turnStartedAt: number | null;
}

export async function readState(cmd: Redis, g: string): Promise<GameState | null> {
  const raw = await cmd.get(keys.state(g));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GameState;
  } catch {
    return null;
  }
}

export async function writeState(cmd: Redis, g: string, st: GameState): Promise<void> {
  // Keep hot state alive well past one lease so a re-placed grain can rehydrate.
  await cmd.set(keys.state(g), JSON.stringify(st), "PX", LEASE_MS * 4);
}
