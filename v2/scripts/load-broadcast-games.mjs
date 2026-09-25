#!/usr/bin/env node
// Pull recent Lichess broadcast games into the ChessGuru DB (broadcastgames).
//
// The original loader this collection's comment refers to was never committed
// and is not on any box, so the library had gone stale — newest game 2026.07.28,
// roughly two months behind. This replaces it.
//
// Usage:
//   node load-broadcast-games.mjs --dry            # report only, write nothing
//   node load-broadcast-games.mjs --tours=20       # how many recent tournaments
//
// De-duplication is by the MOVES fingerprint (mh), not by id: the original rows
// use an id recipe that cannot be reproduced, and the same game is broadcast by
// several tournaments. Two games with identical move lists ARE the same game.
//
// Every new row is written with the fields the app needs — mh, dateKey, eco,
// openingName — so a freshly loaded game is searchable and sortable the moment
// it lands, rather than waiting for a separate backfill.
import { MongoClient } from "mongodb";
import { Chess } from "chess.js";

const argv = process.argv.slice(2);
const DRY = argv.includes("--dry");
const TOURS = Number((argv.find((a) => a.startsWith("--tours=")) || "").split("=")[1]) || 12;
const UA = "ChessGuru/1.0 (academy game library; contact ranjith.vsk@gmail.com)";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function movesHash(moves) {
  const s = (moves || []).join(" ");
  let a = 0x811c9dc5, b = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    a ^= s.charCodeAt(i); a = (a * 0x01000193) >>> 0;
    b ^= s.charCodeAt(s.length - 1 - i); b = (b * 0x01000193) >>> 0;
  }
  return ("00000000" + a.toString(16)).slice(-8) + ("00000000" + b.toString(16)).slice(-8);
}
const slug = (n) => String(n || "").trim().toLowerCase()
  .replace(/\s*,\s*/g, "-").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** Split a multi-game PGN. A header line after moves have started is the next game. */
function splitGames(raw) {
  const out = []; let cur = []; let seen = false;
  const flush = () => { const t = cur.join("\n").trim(); if (t) out.push(t); cur = []; seen = false; };
  for (const line of String(raw || "").split(/\r?\n/)) {
    const h = /^\s*\[/.test(line);
    if (h && seen) flush();
    if (!h && line.trim()) seen = true;
    cur.push(line);
  }
  flush(); return out;
}

// A Lichess API token lifts the anonymous per-IP rate limit. Optional: without
// one everything still works, just more slowly. Set LICHESS_TOKEN in the
// environment (a plain read token from lichess.org/account/oauth/token is
// enough — no scope is needed for public broadcasts).
const TOKEN = (process.env.LICHESS_TOKEN || "").trim();

// A bare fetch() gave up on the first socket reset, and the hourly log showed
// the cost: ~7 of 25 tournaments a run ending in "fetch failed (fetch failed)",
// each one silently skipped for that hour. Lichess is simply slow on big
// tournaments — a round PGN for the Olympiad measures ~7.5s — so a dropped
// connection is normal traffic, not an outage, and the answer is to wait and
// ask again rather than to skip the tournament.
const ATTEMPTS = 3;
async function getText(url, attempt = 1) {
  const headers = { "User-Agent": UA, Accept: "application/x-chess-pgn, application/x-ndjson, */*" };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  try {
    // Node's fetch has no default timeout at all: a stalled connection hangs
    // until the process is killed, which is how the nightly run hit its wrapper
    // timeout. 90s is generous for the slowest round we have measured.
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(90_000) });
    if (r.status === 429) { console.log("  rate limited — backing off 60s"); await sleep(60_000); return getText(url, attempt); }
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r.text();
  } catch (e) {
    if (attempt >= ATTEMPTS) throw e;
    await sleep(attempt * 3_000);           // 3s, then 6s
    return getText(url, attempt + 1);
  }
}

/** chess.js 1.4 will not parse a broadcast PGN as published: the movetext
 *  carries { [%eval 0.18] [%clk 1:00:50] } annotations and "1..." black
 *  continuation numbers, and it rejects the lot with "Expected end of input,
 *  game termination marker, move number". Measured on a real dump: 8 of 88
 *  games parsed as-is, 85 of 88 with the annotations stripped. Everything we
 *  keep — the moves, the result, the headers — survives stripping; only the
 *  clocks and engine evals are discarded, and we store neither. */
function stripAnnotations(pgn) {
  return String(pgn)
    .replace(/\{[^}]*\}/g, " ")     // { [%eval ...] [%clk ...] }
    .replace(/\$\d+/g, " ")          // NAGs
    .replace(/[ \t]+/g, " ");
}

const cli = new MongoClient("mongodb://127.0.0.1:27017");
await cli.connect();
const db = cli.db("chessguru");
// corpusgames, not the retired broadcastgames (2026-09-24). Writing straight into the
// search corpus removes the hourly copy step (chessdb-broadcast-topup) that used to
// bridge the two collections, and the "already held" check below now dedupes against
// the permanent corpus instead of a staging copy of it.
const col = db.collection("corpusgames");
// Round ledger. Completeness depends on this: the tournament index only shows
// the most recent N, so anything that ages off between runs would be lost
// forever. Recording every round we have ever seen — and whether it was
// FINISHED when we last read it — means a round is fetched until it is
// complete and then never again, so the budget goes to rounds we still owe.
const seenRounds = db.collection("broadcastRoundsSeen");
await seenRounds.createIndex({ done: 1, lastTriedAt: 1 }).catch(() => {});

// opening book, for eco/openingName on the way in
const book = new Map();
for (const o of await db.collection("openingnames").find({}, { projection: { eco: 1, name: 1 } }).toArray()) {
  book.set(String(o._id), { eco: o.eco, name: o.name });
}
const fenKey = (f) => f.split(" ").slice(0, 4).join(" ");

console.log(`fetching ${TOURS} recent broadcast tournaments${DRY ? "  (DRY RUN — nothing will be written)" : ""}`);
const index = await getText(`https://lichess.org/api/broadcast?nb=${TOURS}`);
const tours = index.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
console.log(`  ${tours.length} tournaments`);

let seenGames = 0, dupes = 0, added = 0, skipped = 0, unfinished = 0;
const toInsert = [];

// ONE REQUEST PER TOURNAMENT. /api/broadcast/<tourId>.pgn returns every round
// of a tournament in a single response — measured at 300 games / 1.25MB for a
// live Olympiad section. The previous loop fetched each round separately,
// roughly 11x the requests for the same games, which is what made the rate
// limit bite.
//
// The ledger is per-tournament for the same reason completeness needed one at
// all: the index only shows the most recent N, so a tournament that scrolls
// off between runs would otherwise be lost. A tournament is only marked done
// once every one of its rounds is finished upstream AND we have read it since.
const seenTours = db.collection("broadcastToursSeen");
await seenTours.createIndex({ done: 1, lastTriedAt: 1 }).catch(() => {});

for (const t of tours) {
  const tour = t?.tour ?? {};
  if (!tour.id) continue;
  const rounds = Array.isArray(t?.rounds) ? t.rounds : [];
  const allFinished = rounds.length > 0 && rounds.every((r) => r.finished);
  await seenTours.updateOne(
    { _id: String(tour.id) },
    {
      $set: { name: tour.name ?? "?", rounds: rounds.length, allFinished },
      $setOnInsert: { done: false, firstSeenAt: new Date() },
    },
    { upsert: true },
  );
}

// Work the BACKLOG, oldest attempt first, so a missed run is harmless and a
// tournament that aged off the index is still collected.
const backlog = await seenTours
  .find({ done: { $ne: true } })
  .sort({ lastTriedAt: 1 })
  .limit(TOURS)
  .toArray();
console.log(`  ${backlog.length} tournaments to fetch (of ${await seenTours.countDocuments({})} ever seen, ${await seenTours.countDocuments({ done: true })} complete)`);

for (const t of backlog) {
  process.stdout.write(`  ${String(t.name).slice(0, 58).padEnd(58)}`);
  let pgn = "";
  try {
    pgn = await getText(`https://lichess.org/api/broadcast/${t._id}.pgn`);
  } catch (e) {
    await seenTours.updateOne({ _id: t._id }, { $set: { lastTriedAt: new Date() } });
    console.log(`  fetch failed (${String(e.message).slice(0, 30)})`);
    continue;
  }
  await sleep(400);                        // one request at a time, politely
  // Done only when upstream says every round finished AND we have just read it.
  // A DRY run never marks done — it inserts nothing, and a tournament marked
  // done is never fetched again.
  await seenTours.updateOne(
    { _id: t._id },
    { $set: DRY ? { lastTriedAt: new Date() } : { lastTriedAt: new Date(), done: !!t.allFinished } },
  );

  let tourAdded = 0;
  for (const one of splitGames(pgn)) {
    seenGames++;
    const g = new Chess();
    try { g.loadPgn(stripAnnotations(one)); } catch { skipped++; continue; }
    const sans = g.history();
    if (sans.length < 4) { skipped++; continue; }   // an empty/abandoned board is not a game
    const h = g.header();
    // FINISHED GAMES ONLY — a game still being played would be archived frozen
    // mid-play, and would hash differently next run and insert a second time.
    if (!/^(1-0|0-1|1\/2-1\/2)$/.test(String(h.Result || "").trim())) { unfinished++; continue; }
    const mh = movesHash(sans);
    const white = h.White || "?", black = h.Black || "?";
    const date = /^\d{4}\.\d{2}\.\d{2}$/.test(h.Date || "") ? h.Date : null;

    let eco = null, openingName = null;
    try {
      const c = new Chess();
      for (const san of sans.slice(0, 24)) {
        if (!c.move(san)) break;
        const e = book.get(fenKey(c.fen()));
        if (e) { eco = e.eco; openingName = e.name; }
      }
    } catch { /* unnamed */ }

    toInsert.push({
      mh,
      doc: {
        moves: sans, ply: sans.length,
        whiteName: white, blackName: black,
        whiteId: slug(white), blackId: slug(black),
        whiteElo: Number(h.WhiteElo) || null, blackElo: Number(h.BlackElo) || null,
        event: h.Event || t.name, site: h.Site || null, round: h.Round || null,
        date: h.Date || null, dateKey: date, result: h.Result || "*",
        // TimeControl was captured by nothing until 2026-09-24, so the corpus has no
        // blitz/rapid/classical distinction at all for anything ingested before then.
        timeControl: h.TimeControl || null,
        source: "broadcast", eco, openingName, mh,
        loadedAt: new Date(),
      },
    });
    tourAdded++;
  }
  console.log(`  → ${tourAdded} finished games`);
}

// One pass to find which fingerprints we already hold.
const hashes = [...new Set(toInsert.map((x) => x.mh))];
const known = new Set();
for (let i = 0; i < hashes.length; i += 5000) {
  const chunk = hashes.slice(i, i + 5000);
  for (const r of await col.find({ mh: { $in: chunk } }, { projection: { mh: 1 } }).toArray()) known.add(r.mh);
}

const fresh = [];
const seenThisRun = new Set();
for (const x of toInsert) {
  if (known.has(x.mh) || seenThisRun.has(x.mh)) { dupes++; continue; }
  seenThisRun.add(x.mh);
  // corpusgames shape. _id is left to Mongo (ObjectId); the 20-hex id the old collection
  // used lives on as _srcId, which is what /broadcasts/:id falls back to for links already
  // shared. `fromBroadcast` is the flag the broadcast page filters on -- `source` alone is
  // not enough, because the move-hash dedup can leave a game under another source.
  const rnd = Math.floor(Math.random() * 0xfffff).toString(16).padStart(5, "0");
  const y = String(x.doc.dateKey || x.doc.date || "").slice(0, 4);
  fresh.push({
    ...x.doc,
    _srcId: (x.mh + rnd).slice(0, 20),
    source: "broadcast",
    fromBroadcast: true,
    year: /^\d{4}$/.test(y) ? Number(y) : null,
  });
}

console.log(`\nscanned ${seenGames} games: ${dupes} already held, ${unfinished} still being played, ${skipped} unusable, ${fresh.length} new`);
if (fresh.length) {
  const named = fresh.filter((f) => f.eco).length;
  console.log(`  of the new: ${named} named with an ECO, ${fresh.filter((f) => f.dateKey).length} with a usable date`);
  console.log(`  newest: ${fresh.map((f) => f.dateKey).filter(Boolean).sort().slice(-1)[0] ?? "—"}`);
  console.log("  sample:");
  fresh.slice(0, 5).forEach((f) => console.log(`    ${f.dateKey ?? "????"}  ${f.whiteName} vs ${f.blackName}  ${f.result}  ${f.eco ?? ""}  (${String(f.event).slice(0, 40)})`));
}
if (DRY) { console.log("\nDRY RUN — nothing written."); }
else if (fresh.length) {
  const r = await col.insertMany(fresh, { ordered: false });
  console.log(`\ninserted ${r.insertedCount} games`);
}
await cli.close();
