import { randomBytes } from "node:crypto";
import type Redis from "ioredis";
import { MongoClient, type Db } from "mongodb";
import { keys } from "@chessguru/protocol";

// Who is on the other end of a socket. Same rule as the API's video-signal WS
// (apps/api/src/video/video-signal.ts): the `cgsid` cookie carries `s:<sid>.<sig>`;
// the sid is 256 bits of randomness and the Mongo `sessions` row is the proof, so
// the HMAC is not re-checked here. Before this the gateway seated whoever the
// client *said* it was (`hello.token`), which let anyone seek as any account.

const MONGO_URI = process.env.MONGO_URI ?? "mongodb://127.0.0.1:27017/chessguru";
const TRUST_TOKENS = process.env.PLAY_TRUST_TOKENS === "1";

let dbP: Promise<Db> | null = null;
function db(): Promise<Db> {
  if (!dbP) dbP = new MongoClient(MONGO_URI).connect().then((c) => c.db());
  return dbP;
}

export function extractSid(cookieHeader?: string): string | null {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(/(?:^|;\s*)cgsid=([^;]+)/);
  if (!m) return null;
  let raw: string;
  try {
    raw = decodeURIComponent(m[1] ?? "");
  } catch {
    return null;
  }
  const stripped = raw.startsWith("s:") ? raw.slice(2) : raw;
  const dot = stripped.indexOf(".");
  const sid = dot === -1 ? stripped : stripped.slice(0, dot);
  return sid.length >= 16 ? sid : null;
}

/** `u:<userId>` for a live signed-in session, else null. Never throws. */
export async function sessionUser(cookieHeader?: string): Promise<string | null> {
  const sid = extractSid(cookieHeader);
  if (!sid) return null;
  try {
    const row = (await (await db()).collection("sessions").findOne({ _id: sid as never })) as
      | { session?: string | { userId?: unknown } }
      | null;
    if (!row?.session) return null;
    const payload = typeof row.session === "string" ? (JSON.parse(row.session) as { userId?: unknown }) : row.session;
    const userId = payload?.userId;
    return typeof userId === "string" && userId ? `u:${userId}` : null;
  } catch {
    return null;
  }
}

/** Mint (once) and return the shared bot key. Whichever of gateway / play-bot boots
 *  first creates it; the other reads it. Browsers cannot reach Redis, so knowing
 *  the key proves the caller is our own process. */
export async function botKey(cmd: Redis): Promise<string> {
  await cmd.set(keys.botKey, randomBytes(24).toString("base64url"), "NX");
  return (await cmd.get(keys.botKey)) ?? "";
}

/** A client-chosen guest id. Kept in its own namespace so it can never be a `u:` account. */
export function guestId(guest: unknown, fallback: string): string {
  const g = typeof guest === "string" ? guest.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) : "";
  return `g:${g || fallback}`;
}

export const trustTokens = TRUST_TOKENS;
