// Ingest lichess-org/chess-openings (a-e.tsv) → `openingnames` { _id: epd, eco, name }.
// Run: node scripts/ingest-eco.js   (from apps/api)
const mongoose = require("mongoose");
const { Chess, epdOf, sanTokens } = require("./pgn");

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/chessguru";
const BASE = "https://raw.githubusercontent.com/lichess-org/chess-openings/master";
const FILES = ["a", "b", "c", "d", "e"];

async function main() {
  await mongoose.connect(MONGO_URI);
  const col = mongoose.connection.collection("openingnames");
  let ops = [], total = 0, skipped = 0;
  for (const f of FILES) {
    const res = await fetch(`${BASE}/${f}.tsv`);
    const text = await res.text();
    const lines = text.split("\n").slice(1).filter(Boolean); // drop header
    for (const line of lines) {
      const [eco, name, pgn] = line.split("\t");
      if (!pgn) continue;
      const c = new Chess();
      let ok = true;
      for (const san of sanTokens(pgn)) { try { c.move(san); } catch { ok = false; break; } }
      if (!ok) { skipped++; continue; }
      ops.push({ updateOne: { filter: { _id: epdOf(c) }, update: { $set: { eco, name } }, upsert: true } });
      if (ops.length >= 1000) { await col.bulkWrite(ops, { ordered: false }); total += ops.length; ops = []; }
    }
    process.stdout.write(`  ${f}.tsv done\n`);
  }
  if (ops.length) { await col.bulkWrite(ops, { ordered: false }); total += ops.length; }
  const count = await col.countDocuments();
  console.log(`openingnames: upserted ${total} ops, ${skipped} skipped, collection now ${count} docs`);
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
