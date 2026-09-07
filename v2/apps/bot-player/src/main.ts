import { randomBytes } from "node:crypto";
import Redis from "ioredis";
import { MongoClient } from "mongodb";
import { keys, type TimeControl } from "@chessguru/protocol";
import { Maia3Engine } from "./engine";
import { EnginePool, pickEngine } from "./engines";
import { buildNamePool } from "./names";
import { BotSession, type GameLog } from "./session";

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const MONGO = process.env.MONGO_URI ?? "mongodb://127.0.0.1:27017/chessguru";
const POLL_MS = 2000;
const WAIT_MIN_MS = Number(process.env.BOT_WAIT_MIN_MS ?? 11000);
const WAIT_MAX_MS = Number(process.env.BOT_WAIT_MAX_MS ?? 18000);
const MAX_CONCURRENT = Number(process.env.BOT_MAX_GAMES ?? 6);
const SWEEP_MS = 60000;

const cmd = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
cmd.on("error", (e) => console.error("[bot] redis:", e.message));
const mongo = new MongoClient(MONGO);
const engines = new EnginePool(() => new Maia3Engine());
// pm2 restarts us with SIGINT; never leave an engine behind (see EnginePool.killAll).
process.on("exit", () => engines.killAll());
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => process.exit(0));

interface SeekMeta {
  seekId: string;
  by: string;
  clock: TimeControl;
  rated: boolean;
  rating: number;
  /** Lobby's strength estimate (live rating, else puzzle rating). Older metas lack it. */
  skill?: number;
  ts: number;
  pool: string;
}

const skillOf = (m: SeekMeta): number => m.skill ?? m.rating;

let namePool: string[] = [];
let botKey = "";
const inUse = new Set<string>();
let seeking = false; // at most one bot seek at a time, so bots can never match each other
let live = 0;

function isBot(userId: string): boolean {
  return userId.startsWith("u:") && namePool.includes(userId.slice(2));
}

function pickName(): string | null {
  const free = namePool.filter((n) => !inUse.has(n));
  return free[Math.floor(Math.random() * free.length)] ?? null;
}

async function waitingSeeks(): Promise<SeekMeta[]> {
  const poolKeys = await cmd.keys("seek:pool:*");
  if (!poolKeys.length) return [];
  const ids: string[] = [];
  for (const key of poolKeys) ids.push(...(await cmd.zrange(key, 0, -1)));
  if (!ids.length) return [];
  const raws = await cmd.hmget(keys.seekMeta, ...ids);
  const out: SeekMeta[] = [];
  for (const raw of raws) {
    if (!raw) continue;
    try {
      out.push(JSON.parse(raw) as SeekMeta);
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

async function tick(): Promise<void> {
  if (seeking || live >= MAX_CONCURRENT) return;
  const threshold = WAIT_MIN_MS + Math.random() * (WAIT_MAX_MS - WAIT_MIN_MS);
  const now = Date.now();

  // Rated seeks are left to humans: the strength mapping is not calibrated against real
  // players yet, so a bot must not touch anyone's rating.
  const open = (await waitingSeeks()).filter((m) => !m.rated && !isBot(m.by));
  const pool = open.find((m) => now - m.ts >= threshold)?.pool;
  if (!pool) return;

  // The lobby pops by ZRANGEBYSCORE, so a wide-range seek is paired with the LOWEST
  // rated player in the pool — that, not the longest waiter, is who we will face.
  const target = open
    .filter((m) => m.pool === pool)
    .reduce((lo, m) => (m.rating < lo.rating ? m : lo));
  const name = pickName();
  if (!name) return;

  seeking = true;
  inUse.add(name);
  live++;
  const skill = skillOf(target);
  const engine = engines.acquire(pickEngine(skill));
  console.log(
    `[bot] ${name} entering ${target.pool} for ${target.by} (waited ${Math.round((now - target.ts) / 1000)}s, rating ${target.rating}, skill ${skill}, engine ${engine.id})`,
  );

  const session = new BotSession(name, botKey, target.clock, skill, engine, (log) => {
    seeking = false;
    inUse.delete(name);
    live--;
    if (log?.game) void recordGame(log);
  });
  // The seek is answered or withdrawn within a few seconds; the game outlives that.
  setTimeout(() => {
    seeking = false;
  }, 7000);
  session.run();
}

async function recordGame(log: GameLog): Promise<void> {
  try {
    await mongo.db().collection("bot_games").insertOne(log);
  } catch (e) {
    console.error("[bot] could not record game:", (e as Error).message);
  }
  console.log(`[bot] ${log.bot} finished ${log.game}: ${log.result ?? "?"} (${log.reason ?? "?"}) in ${log.plies} plies`);
}

/** The gateway only seats a `u:<name>` identity for a hello that carries the key it
 *  minted into Redis (or that we mint first — SET NX, whoever boots first wins). */
async function loadBotKey(): Promise<string> {
  await cmd.set(keys.botKey, randomBytes(24).toString("base64url"), "NX");
  const k = await cmd.get(keys.botKey);
  if (!k) throw new Error("bot key unavailable");
  return k;
}

async function main(): Promise<void> {
  await mongo.connect();
  botKey = await loadBotKey();
  namePool = await buildNamePool(mongo.db());
  // Load the weights now: the first think otherwise costs seconds, which would show up as
  // an implausibly long stare at move one of the first game after a restart.
  await engines
    .acquire({ kind: "maia1", id: "maia1-1500", level: 1500 })
    .think({ moves: [], opponentRating: 1500 })
    .catch((e) => console.error("[bot] warmup:", e.message));
  console.log(`[bot] up — ${namePool.length} names, waits ${WAIT_MIN_MS}-${WAIT_MAX_MS}ms, max ${MAX_CONCURRENT} games`);
  setInterval(() => void tick().catch((e) => console.error("[bot] tick:", e.message)), POLL_MS);
  setInterval(() => engines.sweep(), SWEEP_MS);
}

void main().catch((e) => {
  console.error("[bot] fatal:", e);
  process.exit(1);
});
