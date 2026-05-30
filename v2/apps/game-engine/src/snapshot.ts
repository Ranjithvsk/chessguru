import type Redis from "ioredis";
import { keys, LEASE_MS } from "@chessguru/protocol";
import type { GameStatus, Players } from "@chessguru/protocol";

/** Hot recovery state for a game — enough to rebuild the position by replay. */
export interface GameState {
  initialFen: string;
  moves: string[];
  players: Players;
  status: GameStatus;
  result: string | null;
  startedAt: number;
  finishedAt?: number;
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
  // Keep hot state alive well past one lease so a re-placed grain can rehydrate
  // after an owner dies (lease ≤15s; state lives 4×).
  await cmd.set(keys.state(g), JSON.stringify(st), "PX", LEASE_MS * 4);
}
