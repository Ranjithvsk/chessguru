import type { TimeControl } from "./envelope";

// Redis channel names + key names + timing constants, shared by ws + game-engine + lobby.
export const ch = {
  /** inbox of one engine node — gateways/lobby publish routed events here */
  engineIn: (node: string) => `game:in:${node}`,
  /** per-game fan-out — gateways subscribe for every game they hold a socket on */
  gameOut: (g: string) => `game:out:${g}`,
  /** per-gateway targeted replies (state / error / pong / matched) */
  wsReply: (gw: string) => `ws:reply:${gw}`,
  /** lobby inbox — gateways forward seek/challenge events here */
  lobbyIn: "lobby:in",
};

export const keys = {
  owner: (g: string) => `game:owner:${g}`,
  state: (g: string) => `game:state:${g}`,
  enginePid: (node: string) => `engine:pid:${node}`,
  engineNodes: "engine:nodes",
  /** seek pool ZSET (score = rating), per exact time control + rated flag */
  seekPool: (tc: string, rated: boolean) => `seek:pool:${tc}:${rated ? 1 : 0}`,
  seekMeta: "seek:meta", // HASH seekId -> JSON
  seekByUser: "seek:byuser", // HASH userId -> seekId (one live seek per user)
  challenge: (id: string) => `challenge:${id}`,
};

export const LEASE_MS = 15000;
export const HEARTBEAT_MS = 5000;
export const NODE_TTL_MS = 15000;

/** Lichess-style speed bucket from estimated game duration (initial + 40·inc ms). */
export function speedOf(tc: TimeControl): string {
  const est = tc.initial + 40 * tc.increment;
  if (est < 180_000) return "bullet";
  if (est < 480_000) return "blitz";
  if (est < 1_500_000) return "rapid";
  return "classical";
}

/** Canonical pool bucket string for a time control. */
export function tcKey(tc: TimeControl): string {
  return `${tc.initial}-${tc.increment}`;
}
