#!/usr/bin/env node
// Import Lichess's monthly broadcast archives (database.lichess.org/#broadcasts).
//
// The hourly API crawler covers what is happening NOW, but it can only see the
// tournaments still on the recent-tournaments index. These dumps are the
// complete record — 80 monthly files going back years — so this is what makes
// "don't miss any games" actually true rather than merely likely.
//
// Every game is de-duplicated by its MOVE-LIST fingerprint against what we
// already hold, so re-importing a month, or importing a month the crawler has
// already partly covered, adds only what is genuinely new. A ledger records
// which dumps are done so a month is never re-downloaded for nothing.
//
//   node sync-broadcast-dumps.mjs [--months=2] [--all] [--dry]
import { MongoClient } from "mongodb";
import { Chess } from "chess.js";
import { spawn } from "node:child_process";
import readline from "node:readline";
import https from "node:https";

const argv = process.argv.slice(2);
const DRY = argv.includes("--dry");
const ALL = argv.includes("--all");
const MONTHS = Number((argv.find((a) => a.startsWith("--months=")) || "").split("=")[1]) || 2;
const LIST = "https://database.lichess.org/broadcast/list.txt";

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
const col = db.collection("broadcastgames");
const feeds = db.collection("dataFeeds");

const book = new Map();
for (const o of await db.collection("openingnames").find({}, { projection: { eco: 1, name: 1 } }).toArray()) {
  book.set(String(o._id), { eco: o.eco, name: o.name });
}
const fenKey = (f) => f.split(" ").slice(0, 4).join(" ");

const listText = await (await fetch(LIST, { headers: { "User-Agent": "ChessGuru/1.0" } })).text();
const urls = listText.split("\n").map((s) => s.trim()).filter(Boolean);
const done = new Set((await feeds.findOne({ _id: "broadcast-dumps" }))?.done ?? []);
// Newest first; the most recent months are the ones most likely to hold games
// the crawler has not seen.
const todo = urls.filter((u) => !done.has(u)).slice(0, ALL ? urls.length : MONTHS);
console.log(`${urls.length} dumps published, ${done.size} already imported, taking ${todo.length}`);

/** Stream a .zst straight through zstd — these are hundreds of MB and there is
 *  no reason for any of it to touch the disk or sit in memory. */
function pgnLines(url) {
  const z = spawn("zstd", ["-dc"], { stdio: ["pipe", "pipe", "ignore"] });
  https.get(url, { headers: { "User-Agent": "ChessGuru/1.0" } }, (res) => {
    if (res.statusCode !== 200) { z.stdin.end(); return; }
    res.pipe(z.stdin);
  }).on("error", () => z.stdin.end());
  return readline.createInterface({ input: z.stdout, crlfDelay: Infinity });
}

for (const url of todo) {
  const name = url.split("/").pop();
  process.stdout.write(`  ${name} ... `);
  let block = [];
  let seen = 0, added = 0, dupes = 0, unfinished = 0, bad = 0;
  let pending = [];

  const flushGames = async () => {
    if (!pending.length) return;
    const hashes = pending.map((p) => p.mh);
    const known = new Set((await col.find({ mh: { $in: hashes } }, { projection: { mh: 1 } }).toArray()).map((r) => r.mh));
    const fresh = [];
    const seenHere = new Set();
    for (const p of pending) {
      if (known.has(p.mh) || seenHere.has(p.mh)) { dupes++; continue; }
      seenHere.add(p.mh);
      const rnd = Math.floor(Math.random() * 0xfffff).toString(16).padStart(5, "0");
      fresh.push({ _id: (p.mh + rnd).slice(0, 20), ...p.doc });
    }
    if (fresh.length && !DRY) { try { await col.insertMany(fresh, { ordered: false }); } catch { /* races on _id */ } }
    added += fresh.length;
    pending = [];
  };

  const handle = async (pgn) => {
    seen++;
    const g = new Chess();
    try { g.loadPgn(stripAnnotations(pgn)); } catch { bad++; return; }
    const sans = g.history();
    if (sans.length < 4) { bad++; return; }
    const h = g.header();
    if (!/^(1-0|0-1|1\/2-1\/2)$/.test(String(h.Result || "").trim())) { unfinished++; return; }
    let eco = null, openingName = null;
    try {
      const c = new Chess();
      for (const san of sans.slice(0, 24)) {
        if (!c.move(san)) break;
        const e = book.get(fenKey(c.fen()));
        if (e) { eco = e.eco; openingName = e.name; }
      }
    } catch { /* unnamed */ }
    const white = h.White || "?", black = h.Black || "?";
    const date = /^\d{4}\.\d{2}\.\d{2}$/.test(h.Date || "") ? h.Date : null;
    pending.push({
      mh: movesHash(sans),
      doc: {
        moves: sans, ply: sans.length,
        whiteName: white, blackName: black, whiteId: slug(white), blackId: slug(black),
        whiteElo: Number(h.WhiteElo) || null, blackElo: Number(h.BlackElo) || null,
        event: h.Event || null, site: h.Site || null, round: h.Round || null,
        date: h.Date || null, dateKey: date, result: h.Result,
        source: "broadcast", eco, openingName, mh: movesHash(sans),
        loadedAt: new Date(), fromDump: name,
      },
    });
    if (pending.length >= 2000) await flushGames();
  };

  for await (const line of pgnLines(url)) {
    if (line.startsWith("[Event ") && block.length) { await handle(block.join("\n")); block = []; }
    block.push(line);
  }
  if (block.length) await handle(block.join("\n"));
  await flushGames();

  if (!DRY) {
    await feeds.updateOne({ _id: "broadcast-dumps" },
      { $addToSet: { done: url }, $set: { lastImport: name, checkedAt: new Date() } }, { upsert: true });
  }
  console.log(`${seen} games → ${added} new, ${dupes} already held, ${unfinished} unfinished, ${bad} unusable`);
}
console.log(DRY ? "DRY RUN — nothing written." : "done");
await cli.close();
