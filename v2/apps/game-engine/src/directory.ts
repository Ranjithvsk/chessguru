import type Redis from "ioredis";
import { keys, LEASE_MS } from "@chessguru/protocol";

/** The grain directory: single-activation + lease over Redis (ADR-0008 D2). */
export class Directory {
  constructor(private cmd: Redis, private nodeId: string) {}

  /** Try to become the owner of `g`. Atomic: only succeeds if currently unowned. */
  async claim(g: string): Promise<boolean> {
    const res = await this.cmd.set(keys.owner(g), this.nodeId, "PX", LEASE_MS, "NX");
    return res === "OK";
  }

  async current(g: string): Promise<string | null> {
    return this.cmd.get(keys.owner(g));
  }

  /** Extend our lease on `g`. Called on every event + by the heartbeat. */
  async renew(g: string): Promise<void> {
    await this.cmd.pexpire(keys.owner(g), LEASE_MS);
  }

  async owns(g: string): Promise<boolean> {
    return (await this.current(g)) === this.nodeId;
  }

  /** Compare-and-delete: only release the lease if it's still ours. */
  async release(g: string): Promise<void> {
    await this.cmd
      .eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        keys.owner(g),
        this.nodeId,
      )
      .catch(() => {});
  }
}
