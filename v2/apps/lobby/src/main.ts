import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { MongoClient } from "mongodb";
import {
  ch,
  decode,
  encode,
  keys,
  NODE_TTL_MS,
  pickOwner,
  speedOf,
  tcKey,
  type Color,
  type EngineInbound,
  type LobbyAccept,
  type LobbyChallenge,
  type LobbyInbound,
  type LobbySeek,
  type LobbyUnseek,
  type ReplyOut,
  type ServerMsg,
  type TimeControl,
} from "@chessguru/protocol";

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const MONGO = process.env.MONGO_URI ?? "mongodb://127.0.0.1:27017/chessguru";
const cmd = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
const sub = new Redis(REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false });
cmd.on("error", (e) => console.error("[lobby] cmd redis:", e.message));
sub.on("error", (e) => console.error("[lobby] sub redis:", e.message));
const mongo = new MongoClient(MONGO);

const BASE_RANGE = 200; // ± rating for an immediate match
const WIDEN_PER_SEC = 40; // window growth per second waited (the sweep)

// Atomically pop the first compatible seek in a rating window (≠ excludeMember).
const MATCH_LUA = `
local cands = redis.call('ZRANGEBYSCORE', KEYS[1], ARGV[1], ARGV[2])
for i=1,#cands do
  if cands[i] ~= ARGV[3] then
    redis.call('ZREM', KEYS[1], cands[i])
    return cands[i]
  end
end
return false`;

interface SeekMeta {
  seekId: string;
  by: string;
  gw: string;
  conn: string;
  clock: TimeControl;
  rated: boolean;
  rating: number;
  ts: number;
  pool: string;
}

function reply(gw: string, conn: string, msg: ServerMsg): void {
  const payload: ReplyOut = { conn, msg };
  void cmd.publish(ch.wsReply(gw), encode(payload));
}

async function ratingOf(userId: string, speed: string): Promise<number> {
  if (!userId.startsWith("u:")) return 1500;
  const doc = (await mongo.db().collection("live_perfs").findOne({ _id: userId as never })) as Record<string, { gl?: { r?: number } }> | null;
  return doc?.[speed]?.gl?.r ?? 1500;
}

async function liveNodes(): Promise<string[]> {
  return cmd.zrangebyscore(keys.engineNodes, Date.now() - NODE_TTL_MS, "+inf");
}

async function getMeta(seekId: string): Promise<SeekMeta | null> {
  const raw = await cmd.hget(keys.seekMeta, seekId);
  return raw ? (JSON.parse(raw) as SeekMeta) : null;
}

async function removeSeek(m: SeekMeta): Promise<void> {
  await cmd.zrem(keys.seekPool(m.pool, m.rated), m.seekId);
  await cmd.hdel(keys.seekMeta, m.seekId);
  await cmd.hdel(keys.seekByUser, m.by);
}

async function pair(white: SeekMeta, black: SeekMeta): Promise<void> {
  const gid = `g-${randomUUID().slice(0, 12)}`;
  const clock = white.clock;
  const rated = white.rated && black.rated;
  const owner = pickOwner(gid, await liveNodes());
  if (owner) {
    const setup: EngineInbound = { kind: "setup", g: gid, white: white.by, black: black.by, clock, rated, gw: "lobby", conn: "", by: "lobby", hop: 0 };
    void cmd.publish(ch.engineIn(owner), encode(setup));
  }
  reply(white.gw, white.conn, { v: 1, t: "matched", d: { game: gid, color: "white" as Color, opponent: black.by, clock, rated } });
  reply(black.gw, black.conn, { v: 1, t: "matched", d: { game: gid, color: "black" as Color, opponent: white.by, clock, rated } });
  console.log(`[lobby] paired ${white.by}(W) vs ${black.by}(B) -> ${gid}`);
}

async function onSeek(e: LobbySeek): Promise<void> {
  const speed = speedOf(e.clock);
  const pool = tcKey(e.clock);
  const rating = await ratingOf(e.by, speed);

  // one live seek per user
  const prev = await cmd.hget(keys.seekByUser, e.by);
  if (prev) {
    const pm = await getMeta(prev);
    if (pm) await removeSeek(pm);
  }

  const range = e.ratingRange ?? BASE_RANGE;
  const matchId = (await cmd.eval(MATCH_LUA, 1, keys.seekPool(pool, e.rated), String(rating - range), String(rating + range), "")) as string | null;
  if (matchId) {
    const partner = await getMeta(matchId);
    if (partner) {
      await cmd.hdel(keys.seekMeta, matchId);
      await cmd.hdel(keys.seekByUser, partner.by);
      const me: SeekMeta = { seekId: randomUUID(), by: e.by, gw: e.gw, conn: e.conn, clock: e.clock, rated: e.rated, rating, ts: Date.now(), pool };
      await pair(partner, me); // the waiting seeker gets white
      return;
    }
  }

  const seekId = randomUUID();
  const meta: SeekMeta = { seekId, by: e.by, gw: e.gw, conn: e.conn, clock: e.clock, rated: e.rated, rating, ts: Date.now(), pool };
  await cmd.zadd(keys.seekPool(pool, e.rated), String(rating), seekId);
  await cmd.hset(keys.seekMeta, seekId, JSON.stringify(meta));
  await cmd.hset(keys.seekByUser, e.by, seekId);
  reply(e.gw, e.conn, { v: 1, t: "seek-ack", d: { seekId } });
}

async function onUnseek(e: LobbyUnseek): Promise<void> {
  const prev = await cmd.hget(keys.seekByUser, e.by);
  if (prev) {
    const pm = await getMeta(prev);
    if (pm) await removeSeek(pm);
  }
}

async function onChallenge(e: LobbyChallenge): Promise<void> {
  const id = randomUUID().slice(0, 10);
  await cmd.set(keys.challenge(id), JSON.stringify({ id, from: { by: e.by, gw: e.gw, conn: e.conn }, clock: e.clock, rated: e.rated }), "EX", 300);
  reply(e.gw, e.conn, { v: 1, t: "challenge-created", d: { id } });
}

async function onAccept(e: LobbyAccept): Promise<void> {
  const raw = await cmd.get(keys.challenge(e.id));
  if (!raw) {
    reply(e.gw, e.conn, { v: 1, t: "error", d: { code: "no-challenge", msg: "challenge not found" } });
    return;
  }
  await cmd.del(keys.challenge(e.id));
  const c = JSON.parse(raw) as { from: { by: string; gw: string; conn: string }; clock: TimeControl; rated: boolean };
  const mk = (by: string, gw: string, conn: string): SeekMeta => ({ seekId: "", by, gw, conn, clock: c.clock, rated: c.rated, rating: 0, ts: 0, pool: "" });
  await pair(mk(c.from.by, c.from.gw, c.from.conn), mk(e.by, e.gw, e.conn)); // challenger = white
}

/** Re-attempt waiting seeks with a window that widens by wait time (fairness). */
async function sweep(): Promise<void> {
  const poolKeys = await cmd.keys("seek:pool:*");
  for (const key of poolKeys) {
    const ids = await cmd.zrange(key, 0, -1);
    for (const id of ids) {
      if ((await cmd.zscore(key, id)) === null) continue; // already paired this sweep
      const m = await getMeta(id);
      if (!m) {
        await cmd.zrem(key, id);
        continue;
      }
      const waited = (Date.now() - m.ts) / 1000;
      const range = BASE_RANGE + Math.floor(waited) * WIDEN_PER_SEC;
      const matchId = (await cmd.eval(MATCH_LUA, 1, key, String(m.rating - range), String(m.rating + range), id)) as string | null;
      if (matchId) {
        const partner = await getMeta(matchId);
        await cmd.zrem(key, id);
        await cmd.hdel(keys.seekMeta, id, matchId);
        await cmd.hdel(keys.seekByUser, m.by);
        if (partner) {
          await cmd.hdel(keys.seekByUser, partner.by);
          await pair(m, partner); // the seek we started from gets white
        }
      }
    }
  }
}

async function main(): Promise<void> {
  await mongo.connect();
  await sub.subscribe(ch.lobbyIn);
  sub.on("message", (_c, raw) => {
    const e = decode<LobbyInbound>(raw);
    if (!e) return;
    const p =
      e.kind === "seek" ? onSeek(e)
      : e.kind === "unseek" ? onUnseek(e)
      : e.kind === "challenge" ? onChallenge(e)
      : e.kind === "challenge-accept" ? onAccept(e)
      : Promise.resolve();
    void p.catch((err) => console.error("[lobby] handler error", err));
  });
  setInterval(() => void sweep().catch(() => {}), 3000);
  console.log(`[lobby] up (pid ${process.pid})`);
}

void main().catch((e) => {
  console.error("[lobby] fatal", e);
  process.exit(1);
});
