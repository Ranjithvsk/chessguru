import Redis from "ioredis";

const URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

/** A fresh ioredis connection. Use one for commands and a *separate* one for
 *  pub/sub — a connection in subscriber mode can't run normal commands. */
export function newRedis(): Redis {
  return new Redis(URL, { maxRetriesPerRequest: null });
}
