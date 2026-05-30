import type Redis from "ioredis";
import { keys, LEASE_MS } from "@chessguru/protocol";

/** Hot recovery state for a game. In M0 a "game" is just an append-only log. */
export interface GameState {
  log: string[];
  seq: number;
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
  // Keep hot state alive well past a single lease so a re-placed grain can always
  // rehydrate after an owner dies (lease ≤15s; state lives 4×).
  await cmd.set(keys.state(g), JSON.stringify(st), "PX", LEASE_MS * 4);
}
