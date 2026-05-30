import type Redis from "ioredis";
import { keys, LEASE_MS } from "@chessguru/protocol";
import type { Clock, Color, GameStatus, Players, TimeControl } from "@chessguru/protocol";

/** Hot recovery state: rebuild the position by replay + restore clock + flow. */
export interface GameState {
  initialFen: string;
  moves: string[];
  players: Players;
  status: GameStatus;
  result: string | null;
  startedAt: number;
  finishedAt?: number;
  rated: boolean;
  timeControl: TimeControl;
  clockRemaining: Clock;
  clockStarted: boolean;
  turnStartedAt: number | null;
  pendingDraw: Color | null;
  rematchReq: { white: boolean; black: boolean };
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
  await cmd.set(keys.state(g), JSON.stringify(st), "PX", LEASE_MS * 4);
}
