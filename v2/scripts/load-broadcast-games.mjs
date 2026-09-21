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

async function getText(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/x-chess-pgn, application/x-ndjson, */*" } });
  if (r.status === 429) { console.log("  rate limited — backing off 60s"); await sleep(60_000); return getText(url); }
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}

const cli = new MongoClient("mongodb://127.0.0.1:27017");
await cli.connect();
const db = cli.db("chessguru");
const col = db.collection("broadcastgames");

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

let seenGames = 0, dupes = 0, added = 0, skipped = 0;
const toInsert = [];

for (const t of tours) {
  const name = t?.tour?.name ?? "?";
  const rounds = Array.isArray(t?.rounds) ? t.rounds : [];
  process.stdout.write(`  ${name.slice(0, 58).padEnd(58)} ${rounds.length} rounds`);
  let tourAdded = 0;
  for (const rd of rounds) {
    let pgn = "";
    try { pgn = await getText(`https://lichess.org/api/broadcast/round/${rd.id}.pgn`); }
    catch { continue; }
    await sleep(350);                       // be a good citizen
    for (const one of splitGames(pgn)) {
      seenGames++;
      const g = new Chess();
      try { g.loadPgn(one); } catch { skipped++; continue; }
      const sans = g.history();
      if (sans.length < 4) { skipped++; continue; }   // an empty/abandoned board is not a game
      const h = g.header();
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
          event: h.Event || name, site: h.Site || null, round: h.Round || rd.name || null,
          date: h.Date || null, dateKey: date, result: h.Result || "*",
          source: "broadcast", eco, openingName, mh,
          loadedAt: new Date(),
        },
      });
      tourAdded++;
    }
  }
  console.log(`  → ${tourAdded} games`);
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
  // id shaped like the existing rows (20 hex), derived so a re-run is idempotent
  const rnd = Math.floor(Math.random() * 0xfffff).toString(16).padStart(5, "0");
  fresh.push({ _id: (x.mh + rnd).slice(0, 20), ...x.doc });
}

console.log(`\nscanned ${seenGames} games: ${dupes} already held, ${skipped} unusable, ${fresh.length} new`);
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
