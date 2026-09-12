import { randomBytes } from "node:crypto";
import Redis from "ioredis";
import { MongoClient } from "mongodb";
import { keys, speedOf, type TimeControl } from "@chessguru/protocol";
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

// Weights guard (owner 2026-09-12: "add the guard"). On 2026-09-12 the Maia-1 nets had been deleted
// from disk; lc0 still handshook, every `go` failed, and the bots played RANDOM moves for days
// without anyone noticing. Now: if a net or the lc0 binary is unreadable, the bot logs it loudly and
// refuses to join any seek until the files are back — no bot is better than a silent random mover.
import { accessSync, constants as fsConstants } from "node:fs";
const MAIA1_LEVELS_REQUIRED = [1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900];
const LC0_BIN_PATH = process.env.LC0_BIN ?? "/home/dreamworld/opt/engines/src/lc0/build/lc0";
const MAIA1_DIR_PATH = process.env.MAIA1_WEIGHTS ?? "/home/dreamworld/opt/engines/weights/maia1";
let lastGuardLog = 0;
function missingEngineFiles(): string[] {
  const missing: string[] = [];
  try { accessSync(LC0_BIN_PATH, fsConstants.X_OK); } catch { missing.push(LC0_BIN_PATH); }
  for (const lvl of MAIA1_LEVELS_REQUIRED) {
    const f = `${MAIA1_DIR_PATH}/maia-${lvl}.pb.gz`;
    try { accessSync(f, fsConstants.R_OK); } catch { missing.push(f); }
  }
  return missing;
}
function enginesHealthy(): boolean {
  const missing = missingEngineFiles();
  if (!missing.length) return true;
  if (Date.now() - lastGuardLog > 60_000) {
    lastGuardLog = Date.now();
    console.error(`[bot] REFUSING TO PLAY — ${missing.length} engine file(s) missing or unreadable: ${missing.join(", ")}`);
  }
  return false;
}
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
// A human opponent is never at your exact rating. Owner 2026-09-12: "human-like opponent, not the
// same exact rating, but the rating level of the player". Each bot game is drawn from a ±150 band
// around the student's strength (in 25-point steps), clamped to the levels the nets cover, so a
// 1400 student meets 1275 one game and 1525 the next — and the stamped rating follows.
const BAND = 150, STEP = 25, MIN_LEVEL = 1000, MAX_LEVEL = 2100;
const humanLike = (skill: number): number => {
  const offset = (Math.floor(Math.random() * (2 * BAND / STEP + 1)) - BAND / STEP) * STEP;
  return Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, Math.round((skill + offset) / STEP) * STEP));
};

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
  const poolKeys = (await cmd.keys("seek:pool:*")).filter((k) => !k.includes("|acad:")); // classmates-only pools: humans only
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
  if (!enginesHealthy()) return;
  if (seeking || live >= MAX_CONCURRENT) return;
  const threshold = WAIT_MIN_MS + Math.random() * (WAIT_MAX_MS - WAIT_MIN_MS);
  const now = Date.now();

  // Rated seeks too (owner call 2026-09-07): the bot's own live rating is stamped to the
  // level it is about to play at, so a student's rating moves as it would against a
  // human of that strength. Never another bot.
  const open = (await waitingSeeks()).filter((m) => !isBot(m.by));
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
  const skill = humanLike(skillOf(target));
  const engine = engines.acquire(pickEngine(skill));
  console.log(
    `[bot] ${name} entering ${target.pool} for ${target.by} (waited ${Math.round((now - target.ts) / 1000)}s, rating ${target.rating}, skill ${skill}, engine ${engine.id})`,
  );

  // Glicko sees the bot as an established player at exactly the strength it plays.
  // Between games the engine's own rating update drifts this; re-stamp every time so
  // the human's update is computed against the level actually at the board.
  if (target.rated) await stampRating(name, speedOf(target.clock), skill);

  const session = new BotSession(name, botKey, target.clock, target.rated, skill, engine, (log) => {
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

async function stampRating(name: string, speed: string, rating: number): Promise<void> {
  try {
    await mongo
      .db()
      .collection("live_perfs")
      .updateOne({ _id: `u:${name}` as never }, { $set: { [speed]: { gl: { r: rating, d: 80, v: 0.06 }, nb: 25, la: new Date() } } }, { upsert: true });
  } catch (e) {
    console.error("[bot] could not stamp rating:", (e as Error).message);
  }
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
  const missingAtBoot = missingEngineFiles();
  console.log(missingAtBoot.length ? `[bot] engine files MISSING at boot (${missingAtBoot.length}) — bots will not seek until fixed` : `[bot] engine files ok: lc0 + ${MAIA1_LEVELS_REQUIRED.length} Maia-1 nets`);
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
