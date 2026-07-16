// Seed rated endgame (KPK) puzzles into Mongo `study_puzzles` (type "kpk"): a graded
// spread for rating-matched practice, plus FAMOUS positions carrying the author's own
// words from the endgame books. Verdicts come from the exact in-app KPK oracle, so
// every seeded puzzle is guaranteed correct. Idempotent (upsert on fen).
//
// Run:  cd v2 && ./apps/web/node_modules/.bin/tsx scripts/seed-endgame.ts
import { MongoClient } from "mongodb";
import { buildDTM, setTable, evaluateKPK } from "../apps/web/src/lib/endgame/kpk";
import { classify, type Tier, type Classified } from "../apps/web/src/lib/endgame/generator";
import { principalVariation } from "../apps/web/src/lib/endgame/play";
import { rng, randInt } from "../apps/web/src/lib/endgame/rng";

const MONGO = process.env.MONGO_URI ?? "mongodb://localhost:27017/chessguru";
const TYPE = "kpk";

const B_MULLER = "Secrets of Pawn Endings";
const B_FLEAR = "Starting Out: Pawn Endgames";

// Famous positions — the author's actual words. Verdict/answer come from the oracle.
const FAMOUS: { book: string; author: string; topic: string; quote: string; fen: string; rating: number }[] = [
  { book: B_MULLER, author: "Karsten Müller & Frank Lamprecht", topic: "The rule of the square",
    quote: "Square rule: if the king is in the square of the pawn, or if he can step into it, then he can capture the pawn.",
    fen: "8/8/8/4k2P/8/8/8/K7 w - - 0 1", rating: 900 },
  { book: B_MULLER, author: "Karsten Müller & Frank Lamprecht", topic: "Outside the square",
    quote: "If the king is not in the square, the pawn can be queened without being supported by its own king.",
    fen: "8/8/8/7P/5k2/8/8/K7 w - - 0 1", rating: 950 },
  { book: B_MULLER, author: "Karsten Müller & Frank Lamprecht", topic: "The visual square",
    quote: "The superimposed square that encloses the pawn's diagonal to the 8th rank serves as a visual aid.",
    fen: "8/8/8/8/P7/6k1/8/6K1 w - - 0 1", rating: 1000 },
  { book: B_FLEAR, author: "Glenn Flear", topic: "The square of a pawn",
    quote: "In pawn endings there aren't any other pieces to help out, so a king has to stop and round up opposing passed pawns on his own.",
    fen: "8/8/4k3/8/P7/8/8/6K1 w - - 0 1", rating: 1050 },
  { book: B_FLEAR, author: "Glenn Flear", topic: "Just in time",
    quote: "…a8=Q+ Kxa8 — just in time! Instead of calculating move-by-move, draw an imaginary square from the pawn.",
    fen: "8/8/8/4k2P/8/8/8/K7 b - - 0 1", rating: 1000 },
  { book: B_FLEAR, author: "Glenn Flear", topic: "The opposition",
    quote: "It's as if the kings face each other off — the first to move losing the argument.",
    fen: "3k4/8/3K4/3P4/8/8/8/8 b - - 0 1", rating: 1400 },
  { book: B_FLEAR, author: "Glenn Flear", topic: "Key squares",
    quote: "The squares in front of the pawn are sometimes known as the key squares.",
    fen: "3k4/8/3K4/3P4/8/8/8/8 w - - 0 1", rating: 1450 },
  { book: B_FLEAR, author: "Glenn Flear", topic: "The rook's pawn",
    quote: "A passed rook's pawn (an a- or h-pawn) is less dangerous for the defender — he has extra drawing chances.",
    fen: "k7/8/8/8/8/8/P7/4K3 w - - 0 1", rating: 1500 },
];

const TIER_BASE: Record<Tier, number> = {
  square_basic: 750, double_step: 950, square_edge: 1150, square_tempo: 1300,
  rook_pawn: 1500, key_square: 1650, holds_draw: 1800,
};
const PER_TIER = 70;

function uciLine(fen: string): string[] {
  return principalVariation(fen).filter((s: any) => s.move).map((s: any) => s.move.from + s.move.to + (s.move.promotion || ""));
}
function makeDoc(fen: string, rating: number, extra: Record<string, unknown> = {}) {
  const e = evaluateKPK(fen);
  if (!e.legal) return null;
  return { type: TYPE, fen, result: e.result, dtm: e.dtmPlies ?? null, solution: uciLine(fen),
    rating: Math.max(500, Math.min(2200, Math.round(rating))), rd: 350, vol: 0.06, nb: 0,
    seedMethod: "kpk-oracle", createdAt: new Date(), ...extra };
}

async function main() {
  console.log("building KPK table…");
  setTable(buildDTM());
  const docs: any[] = [];
  const seen = new Set<string>();
  const add = (d: any) => { if (d && !seen.has(d.fen)) { seen.add(d.fen); docs.push(d); } };

  for (const f of FAMOUS) {
    const d = makeDoc(f.fen, f.rating, { famous: true, book: f.book, author: f.author, quote: f.quote, topic: f.topic });
    if (!d) { console.log("SKIP (illegal famous):", f.fen); continue; }
    console.log(`famous ${f.topic} → ${d.result} (${f.book})`);
    add(d);
  }
  // Single-pass bucket fill (far faster than per-tier reject-sampling).
  const preds: Record<Tier, (c: Classified) => boolean> = {
    square_basic: (c) => !c.kingMatters && !c.rookPawn && !c.doubleStep && !c.defenderToMove && Math.abs(c.margin) >= 2,
    square_edge:  (c) => !c.kingMatters && !c.rookPawn && !c.doubleStep && Math.abs(c.margin) <= 1,
    square_tempo: (c) => !c.kingMatters && c.defenderToMove && Math.abs(c.margin) <= 1,
    double_step:  (c) => !c.kingMatters && c.doubleStep,
    rook_pawn:    (c) => c.rookPawn && c.oracle === "draw" && c.d <= 3,
    key_square:   (c) => c.kingMatters && c.oracle === "win",
    holds_draw:   (c) => c.kingMatters && c.oracle === "draw" && !c.rookPawn,
  };
  const tiers = Object.keys(TIER_BASE) as Tier[];
  const bucket: Record<string, number> = Object.fromEntries(tiers.map((t) => [t, 0]));
  const r = rng(20260716);
  const randomFen = (): string | null => {
    const wp = 8 + randInt(r, 48), wk = randInt(r, 64), bk = randInt(r, 64);
    if (wk === bk || wk === wp || bk === wp) return null;
    const b = Array<string>(64).fill(""); b[wk] = "K"; b[bk] = "k"; b[wp] = "P";
    const rows: string[] = [];
    for (let rr = 7; rr >= 0; rr--) { let s = "", e = 0; for (let f = 0; f < 8; f++) { const c = b[rr * 8 + f]; if (c) { if (e) { s += e; e = 0; } s += c; } else e++; } if (e) s += e; rows.push(s); }
    return `${rows.join("/")} ${r() < 0.5 ? "w" : "b"} - - 0 1`;
  };
  let attempts = 0;
  while (attempts < 500000 && tiers.some((t) => bucket[t]! < PER_TIER)) {
    attempts++;
    const fen = randomFen(); if (!fen || seen.has(fen)) continue;
    const c = classify(fen); if (!c) continue;
    for (const t of tiers) {
      if (bucket[t]! < PER_TIER && preds[t](c)) {
        const d = makeDoc(c.fen, TIER_BASE[t] + (attempts % 161) - 80);
        if (d) { add(d); bucket[t]!++; }
        break;
      }
    }
  }
  console.log("tiers:", bucket, "(attempts", attempts + ")");

  const client = new MongoClient(MONGO);
  await client.connect();
  const col = client.db().collection("study_puzzles");
  try { await col.createIndex({ type: 1, rating: 1 }); await col.createIndex({ type: 1, book: 1 }); await col.createIndex({ fen: 1 }, { unique: true }); } catch { /* */ }
  let ins = 0;
  for (const d of docs) {
    const r = await col.updateOne({ fen: d.fen }, { $setOnInsert: d }, { upsert: true });
    if (r.upsertedCount) ins++;
  }
  const total = await col.countDocuments({ type: TYPE });
  const famous = await col.countDocuments({ type: TYPE, famous: true });
  console.log(`\ninserted ${ins} new · study_puzzles type=${TYPE}: ${total} total, ${famous} famous`);
  await client.close();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
