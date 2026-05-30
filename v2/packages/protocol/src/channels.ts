// Redis channel names + key names + timing constants, shared by ws + game-engine.
export const ch = {
  /** inbox of one engine node — gateways publish routed events here */
  engineIn: (node: string) => `game:in:${node}`,
  /** per-game fan-out — gateways subscribe for every game they hold a socket on */
  gameOut: (g: string) => `game:out:${g}`,
  /** per-gateway targeted replies (state / error / pong-from-engine) */
  wsReply: (gw: string) => `ws:reply:${gw}`,
};

export const keys = {
  /** single-activation lease: value = owning nodeId, TTL = LEASE_MS */
  owner: (g: string) => `game:owner:${g}`,
  /** hot recovery state for a game (JSON GameState) */
  state: (g: string) => `game:state:${g}`,
  /** pid of an engine node (lets the M0 verifier SIGKILL the right process) */
  enginePid: (node: string) => `engine:pid:${node}`,
  /** ZSET: member = nodeId, score = last-heartbeat epoch ms */
  engineNodes: "engine:nodes",
};

/** Owner lease lifetime; a dead owner is reclaimable after this. */
export const LEASE_MS = 15000;
/** How often an engine renews leases + its node heartbeat. */
export const HEARTBEAT_MS = 5000;
/** A node is considered dead if its heartbeat is older than this. */
export const NODE_TTL_MS = 15000;
