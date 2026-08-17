// Seed zugzwang positions into Mongo `study_puzzles` (type "zugzwang") so the
// Study module can serve them rating-matched via /api/study/puzzle and update
// each position's Glicko rating from user attempts (same as the KPK deck).
//
// Uses the corpus TS file as source of truth — the ZugzwangStudy page and the
// seeded docs share the same ids so client-side "complete" calls resolve.
//
// Run:  cd v2 && ./apps/web/node_modules/.bin/tsx scripts/seed-zugzwang.ts
import { MongoClient } from "mongodb";
import { ZUGZWANG_POSITIONS } from "../apps/web/src/lib/zugzwangCorpus";

const MONGO = process.env.MONGO_URI ?? "mongodb://localhost:27017/chessguru";
const TYPE = "zugzwang";

function outcomeToResult(outcome?: string): "win" | "draw" | "loss" {
  const s = (outcome || "").toLowerCase();
  if (s.includes("draw")) return "draw";
  if (s.includes("black wins") || s.includes("black win")) return "loss";
  return "win";
}

async function main() {
  const client = new MongoClient(MONGO);
  await client.connect();
  const col = client.db().collection("study_puzzles");
  try {
    await col.createIndex({ type: 1, rating: 1 });
    await col.createIndex({ type: 1, pattern: 1 });
    await col.createIndex({ fen: 1 }, { unique: true });
  } catch { /* indexes may already exist */ }

  let ins = 0;
  let up = 0;
  for (const p of ZUGZWANG_POSITIONS) {
    const doc = {
      _id: p.id as any,               // use corpus id so client-side POST resolves
      type: TYPE,
      pattern: p.pattern,
      fen: p.fen,
      result: outcomeToResult(p.outcome),
      dtm: null,
      solution: [p.bestMoveUci],
      rating: Math.max(400, Math.min(2500, Math.round(p.difficulty))),
      rd: 350,
      vol: 0.06,
      nb: 0,
      famous: true,
      name: p.name,
      source: p.source,
      mechanism: p.mechanism,
      bestMoveSan: p.bestMoveSan,
      outcome: p.outcome,
      seedMethod: "zugzwang-corpus-v3",
      createdAt: new Date(),
    };
    const r = await col.updateOne(
      { _id: p.id as any },
      {
        // Rating fields only on FIRST insert — later runs re-seed metadata but
        // leave the Glicko state alone so user-attempt drift isn't wiped.
        $setOnInsert: {
          _id: p.id as any, rating: doc.rating, rd: doc.rd, vol: doc.vol, nb: doc.nb,
          seedMethod: doc.seedMethod, createdAt: doc.createdAt,
        },
        $set: {
          type: doc.type, fen: doc.fen, pattern: doc.pattern, name: doc.name,
          source: doc.source, mechanism: doc.mechanism, bestMoveSan: doc.bestMoveSan,
          outcome: doc.outcome, result: doc.result, solution: doc.solution,
          famous: doc.famous, dtm: doc.dtm,
        },
      },
      { upsert: true },
    );
    if (r.upsertedCount) ins++;
    else up++;
  }
  const total = await col.countDocuments({ type: TYPE });
  const byPattern = await col.aggregate([
    { $match: { type: TYPE } },
    { $group: { _id: "$pattern", n: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]).toArray();
  console.log(`\ninserted ${ins} new · updated ${up} existing · study_puzzles type=${TYPE}: ${total} total`);
  for (const b of byPattern) console.log(`  ${b._id}: ${b.n}`);
  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
