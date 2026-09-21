#!/usr/bin/env node
// Keep the opening book in step with lichess-org/chess-openings.
//
// The book maps a POSITION (board+turn+castling+ep) to {eco, name}, and a game
// is named by replaying its first 24 plies and keeping the deepest position the
// book knows. So the book going stale does not just miss new lines — it leaves
// games carrying names Lichess no longer uses. When this first ran our copy was
// 113 openings behind and 14 had been renamed upstream ("Budapest Defense" is
// "Budapest Gambit" now).
//
// Only re-names games when the book actually changed, because re-naming is a
// full pass over 1.09M games and there is no reason to pay that weekly for
// nothing.
//
//   node sync-openings.mjs [--force]
import { MongoClient } from "mongodb";
import { Chess } from "chess.js";
import crypto from "node:crypto";

const FILES = ["a", "b", "c", "d", "e"];
const BASE = "https://raw.githubusercontent.com/lichess-org/chess-openings/master";
const FORCE = process.argv.includes("--force");
const key = (fen) => fen.split(" ").slice(0, 4).join(" ");

const cli = new MongoClient("mongodb://127.0.0.1:27017");
await cli.connect();
const db = cli.db("chessguru");
const feeds = db.collection("dataFeeds");

let raw = "";
for (const f of FILES) {
  const r = await fetch(`${BASE}/${f}.tsv`, { headers: { "User-Agent": "ChessGuru/1.0" } });
  if (!r.ok) { console.error(`fetch ${f}.tsv failed: ${r.status}`); process.exit(1); }
  raw += await r.text();
}
const digest = crypto.createHash("sha1").update(raw).digest("hex");
const prev = await feeds.findOne({ _id: "chess-openings" });
if (!FORCE && prev?.digest === digest) {
  console.log(`unchanged (${digest.slice(0, 12)}) — nothing to do`);
  await feeds.updateOne({ _id: "chess-openings" }, { $set: { checkedAt: new Date() } });
  await cli.close();
  process.exit(0);
}

const book = new Map();
const ops = [];
for (const line of raw.split("\n")) {
  if (!line.trim() || line.startsWith("eco\t")) continue;
  const [eco, name, pgn] = line.split("\t");
  if (!eco || !name || !pgn) continue;
  const c = new Chess();
  try { c.loadPgn(pgn); } catch { continue; }
  if (!c.history().length) continue;
  const k = key(c.fen());
  book.set(k, { eco, name });
  ops.push({ updateOne: { filter: { _id: k }, update: { $set: { eco, name, src: "lichess-chess-openings" } }, upsert: true } });
}
const w = await db.collection("openingnames").bulkWrite(ops, { ordered: false });
console.log(`book: ${ops.length} positions — ${w.upsertedCount} added, ${w.modifiedCount} updated`);

// Re-name the library against the refreshed book.
const col = db.collection("broadcastgames");
const t0 = Date.now();
let n = 0, changed = 0, writes = [];
for await (const g of col.find({}, { projection: { moves: 1, eco: 1, openingName: 1 } })) {
  let eco = null, name = null;
  try {
    const c = new Chess();
    for (const san of (g.moves || []).slice(0, 24)) {
      if (!c.move(san)) break;
      const e = book.get(key(c.fen()));
      if (e) { eco = e.eco; name = e.name; }
    }
  } catch { /* unnamed */ }
  n++;
  if (eco !== (g.eco ?? null) || name !== (g.openingName ?? null)) {
    changed++;
    writes.push({ updateOne: { filter: { _id: g._id }, update: { $set: { eco, openingName: name } } } });
  }
  if (writes.length === 3000) { await col.bulkWrite(writes, { ordered: false }); writes = []; }
}
if (writes.length) await col.bulkWrite(writes, { ordered: false });
console.log(`renamed ${changed} of ${n} games in ${Math.round((Date.now() - t0) / 1000)}s`);

await feeds.updateOne(
  { _id: "chess-openings" },
  { $set: { digest, positions: ops.length, renamed: changed, syncedAt: new Date(), checkedAt: new Date() } },
  { upsert: true },
);
await cli.close();
