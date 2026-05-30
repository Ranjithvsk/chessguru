import Redis from "ioredis";

const URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

/** One connection for commands, a separate one for pub/sub (subscriber mode
 *  can't issue normal commands). */
export function newRedis(): Redis {
  return new Redis(URL, { maxRetriesPerRequest: null });
}
