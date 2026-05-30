import type Redis from "ioredis";
import { keys, NODE_TTL_MS, pickOwner } from "@chessguru/protocol";

/** Live-node membership + heartbeat, and the placement function over it. */
export class Cluster {
  constructor(private cmd: Redis, private nodeId: string) {}

  /** Announce this node and record its pid (so the M0 verifier can SIGKILL it). */
  async register(): Promise<void> {
    await this.cmd.set(keys.enginePid(this.nodeId), String(process.pid));
    await this.beat();
  }

  /** Refresh this node's heartbeat score. */
  async beat(): Promise<void> {
    await this.cmd.zadd(keys.engineNodes, String(Date.now()), this.nodeId);
  }

  /** Nodes whose heartbeat is recent enough to be considered alive. */
  async liveNodes(): Promise<string[]> {
    const min = Date.now() - NODE_TTL_MS;
    return this.cmd.zrangebyscore(keys.engineNodes, min, "+inf");
  }

  /** Deterministic cold-placement target for a game. */
  async placeOwner(gameId: string): Promise<string | null> {
    return pickOwner(gameId, await this.liveNodes());
  }

  /** Clean exit: drop from the ring + remove pid. (Not called on SIGKILL — by design.) */
  async deregister(): Promise<void> {
    await this.cmd.zrem(keys.engineNodes, this.nodeId).catch(() => {});
    await this.cmd.del(keys.enginePid(this.nodeId)).catch(() => {});
  }
}
