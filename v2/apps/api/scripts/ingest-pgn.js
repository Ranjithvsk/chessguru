// Ingest PGN file(s) → `openingpositions` aggregates.
// Run: node scripts/ingest-pgn.js [--db masters] [--maxply 24] [--flush 2000] <file.pgn ...>
const fs = require("fs");
const mongoose = require("mongoose");
const { iterGames, walkGame, RESULT_BUCKET } = require("./pgn");

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/chessguru";

function parseArgs(argv) {
  const o = { db: "masters", maxply: 24, flush: 2000, files: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--db") o.db = argv[++i];
    else if (a === "--maxply") o.maxply = +argv[++i];
    else if (a === "--flush") o.flush = +argv[++i];
    else o.files.push(a);
  }
  return o;
}

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  if (!opt.files.length) { console.error("usage: ingest-pgn.js [--db masters] [--maxply 24] <file.pgn ...>"); process.exit(1); }
  await mongoose.connect(MONGO_URI);
  const col = mongoose.connection.collection("openingpositions");

  // accumulator: Map<id, {w,d,b,g, moves:Map<uci,{san,w,d,b}>}>
  let acc = new Map();
  let gamesInBatch = 0, gamesTotal = 0, gamesUsed = 0;

  const flush = async () => {
    if (!acc.size) return;
    const ops = [];
    for (const [id, p] of acc) {
      const inc = { w: p.w, d: p.d, b: p.b, g: p.g };
      const set = {};
      for (const [uci, m] of p.moves) {
        inc[`moves.${uci}.w`] = m.w; inc[`moves.${uci}.d`] = m.d; inc[`moves.${uci}.b`] = m.b;
        set[`moves.${uci}.san`] = m.san;
      }
      ops.push({ updateOne: {
        filter: { _id: id },
        update: { $inc: inc, $set: set, $setOnInsert: { db: opt.db, key: id.slice(id.indexOf("|") + 1) } },
        upsert: true,
      } });
    }
    await col.bulkWrite(ops, { ordered: false });
    acc = new Map();
  };

  const bump = (id, bucket, uci, san) => {
    let p = acc.get(id);
    if (!p) { p = { w: 0, d: 0, b: 0, g: 0, moves: new Map() }; acc.set(id, p); }
    p[bucket]++; p.g++;
    let m = p.moves.get(uci);
    if (!m) { m = { san, w: 0, d: 0, b: 0 }; p.moves.set(uci, m); }
    m[bucket]++;
  };

  for (const file of opt.files) {
    const text = fs.readFileSync(file, "utf8");
    for (const { result, moves } of iterGames(text)) {
      gamesTotal++;
      const bucket = RESULT_BUCKET[result];
      if (!bucket) continue;
      let used = false;
      const ok = walkGame(result, moves, opt.maxply, (epd, uci, san) => {
        bump(`${opt.db}|${epd}`, bucket, uci, san); used = true;
      });
      if (ok && used) { gamesUsed++; gamesInBatch++; }
      if (gamesInBatch >= opt.flush) { await flush(); gamesInBatch = 0; process.stdout.write(`  …${gamesUsed}/${gamesTotal} games\r`); }
    }
    process.stdout.write(`\n  ${file}: parsed (running total ${gamesUsed}/${gamesTotal})\n`);
  }
  await flush();
  const positions = await col.countDocuments({ db: opt.db });
  console.log(`\ndb=${opt.db}: ${gamesUsed} games used / ${gamesTotal} seen → ${positions} positions`);
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
