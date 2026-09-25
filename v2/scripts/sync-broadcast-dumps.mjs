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
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import https from "node:https";

const argv = process.argv.slice(2);
const DRY = argv.includes("--dry");
const ALL = argv.includes("--all");
const MONTHS = Number((argv.find((a) => a.startsWith("--months=")) || "").split("=")[1]) || 2;
const LIST = "https://database.lichess.org/broadcast/list.txt";
// A wall-clock budget. The first scheduled run was killed by the wrapper at
// 170 minutes with the ledger unwritten, so it would have started the same
// dump again the next night and got no further. Stopping ourselves means the
// dumps we DID finish are recorded.
const BUDGET_MS = Number((argv.find((a) => a.startsWith("--budget=")) || "").split("=")[1] || 40) * 60_000;
const startedAt = Date.now();

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
// corpusgames, not the retired broadcastgames (2026-09-24) -- see the note in
// load-broadcast-games.mjs.
const col = db.collection("corpusgames");
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
/** Downloads a dump to disk, then streams it line by line from there.
 *
 *  It used to parse straight off the socket, and that could not work: the whole
 *  30MB file transfers in 2.6s when nothing is consuming it, but parsing 49k
 *  games takes five minutes, and an HTTP connection held open that long while
 *  being read a trickle at a time gets dropped. Every single run ended in
 *  "connection aborted mid-file".
 *
 *  Worse, when the drop happened there was no 'error' event to notice it: the
 *  response simply stopped, nothing ended zstd's stdin, zstd never saw EOF, and
 *  readline waited forever. Measured at 1h27m wall for 6m of CPU, parked in
 *  ep_poll with zstd idle at 0% and no remote socket left open — which is what
 *  kept hitting the nightly 170-minute wrapper timeout with the ledger
 *  unwritten, so the same month was re-imported every night for ever.
 *
 *  Fetching to a temp file first takes the network out of the parse entirely:
 *  the transfer is short and unthrottled, and a truncated download is caught by
 *  comparing against Content-Length rather than silently read as a short file.
 */
const STALL_MS = 120_000;

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(dest);
    let timer = null, expected = null, got = 0, settled = false;
    const done = (err) => {
      if (settled) return; settled = true;
      if (timer) clearTimeout(timer);
      out.close(() => (err ? reject(err) : resolve(got)));
    };
    const arm = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { req.destroy(); done(new Error(`stalled — no data for ${STALL_MS / 1000}s`)); }, STALL_MS);
    };
    const req = https.get(url, { headers: { "User-Agent": "ChessGuru/1.0" } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return done(new Error(`HTTP ${res.statusCode}`)); }
      expected = Number(res.headers["content-length"]) || null;
      arm();
      res.on("data", (c) => { got += c.length; arm(); });
      res.on("aborted", () => done(new Error("connection aborted mid-file")));
      res.pipe(out);
      out.on("finish", () => {
        // A truncated download decompresses into a short but perfectly valid
        // PGN, so without this check a partial month would look complete and be
        // recorded as imported.
        if (expected && got !== expected) return done(new Error(`truncated: ${got} of ${expected} bytes`));
        done(null);
      });
    });
    req.on("error", (e) => done(e));
    // A connect to a black-holed address fires neither 'response' nor 'error'
    // until the OS gives up minutes later.
    req.setTimeout(STALL_MS, () => { req.destroy(); done(new Error(`no response within ${STALL_MS / 1000}s`)); });
    arm();
  });
}

function pgnLines(file) {
  const z = spawn("zstd", ["-dc", file], { stdio: ["ignore", "pipe", "ignore"] });
  const state = { error: null };
  z.on("exit", (code) => { if (code !== 0 && !state.error) state.error = new Error(`zstd exited ${code}`); });
  return { lines: readline.createInterface({ input: z.stdout, crlfDelay: Infinity }), state };
}

for (const url of todo) {
  if (Date.now() - startedAt > BUDGET_MS) { console.log("  time budget reached — stopping cleanly"); break; }
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
      // corpusgames shape -- see load-broadcast-games.mjs. _id left to Mongo; the old 20-hex
      // id becomes _srcId so /broadcasts/:id still resolves links shared before the move.
      const y = String(p.doc.dateKey || p.doc.date || "").slice(0, 4);
      fresh.push({
        ...p.doc,
        _srcId: (p.mh + rnd).slice(0, 20),
        source: "broadcast",
        fromBroadcast: true,
        year: /^\d{4}$/.test(y) ? Number(y) : null,
      });
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
    // The dump STATES the opening: every game carries [ECO] and [Opening]
    // headers. Replaying 24 plies per game to derive what we have been handed
    // is the whole cost of this import — 49k games x a second chess.js replay —
    // and it is what made a 30MB file take hours. Derive only when the headers
    // are missing, which is rare.
    let eco = h.ECO || null;
    let openingName = h.Opening || null;
    if (!eco) {
      try {
        const c = new Chess();
        for (const san of sans.slice(0, 24)) {
          if (!c.move(san)) break;
          const e = book.get(fenKey(c.fen()));
          if (e) { eco = e.eco; openingName = e.name; }
        }
      } catch { /* unnamed */ }
    }
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
        // TimeControl: captured by nothing before 2026-09-24, so the corpus has no
        // blitz/rapid/classical distinction for anything ingested earlier. ~76 monthly
        // archives are still to import, and they will now arrive carrying it.
        timeControl: h.TimeControl || null,
        source: "broadcast", eco, openingName, mh: movesHash(sans),
        loadedAt: new Date(), fromDump: name,
      },
    });
    if (pending.length >= 2000) await flushGames();
  };

  const tmp = path.join(os.tmpdir(), `cg-dump-${process.pid}-${name}`);
  let bytes;
  try {
    bytes = await download(url, tmp);
  } catch (e) {
    await fs.promises.rm(tmp, { force: true });
    console.log(`download failed (${e.message}) — will retry`);
    continue;
  }
  process.stdout.write(`${(bytes / 1048576).toFixed(0)}MB ... `);
  const { lines, state } = pgnLines(tmp);
  let overBudget = false;
  for await (const line of lines) {
    if (line.startsWith("[Event ") && block.length) {
      await handle(block.join("\n")); block = [];
      // The budget used to be checked only BETWEEN dumps, which is no help when
      // a single dump is the thing that overruns. Check it here too, and treat
      // running out of time as a failure so the dump is not recorded as done.
      if (Date.now() - startedAt > BUDGET_MS) { overBudget = true; break; }
    }
    block.push(line);
  }
  if (!overBudget && !state.error && block.length) await handle(block.join("\n"));
  await flushGames();     // keep whatever we did parse; the games are deduped on re-import

  await fs.promises.rm(tmp, { force: true });
  const problem = state.error ? state.error.message : overBudget ? "time budget reached" : null;
  if (problem) {
    // Deliberately NOT marked done: a partial read must be retried, or we would
    // lose the rest of the month forever.
    console.log(`${seen} games → ${added} new, ${dupes} already held — INCOMPLETE (${problem}), will retry`);
    if (overBudget) { console.log("  stopping cleanly"); break; }
    continue;
  }

  if (!DRY) {
    await feeds.updateOne({ _id: "broadcast-dumps" },
      { $addToSet: { done: url }, $set: { lastImport: name, checkedAt: new Date() } }, { upsert: true });
  }
  console.log(`${seen} games → ${added} new, ${dupes} already held, ${unfinished} unfinished, ${bad} unusable`);
}
console.log(DRY ? "DRY RUN — nothing written." : "done");
await cli.close();
