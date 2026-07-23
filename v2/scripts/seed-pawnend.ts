// Seed rated PAWN-ENDGAME practice puzzles into Mongo `study_puzzles` (type
// "pawn-endgames") for the StudyTrainer (user plays WHITE vs full-strength SF):
//   1. Dvoretsky's Endgame Manual Ch.1 entries already shipped in Book.tsx —
//      kings+pawns only, with their real Maia-rater ratings (win AND draw goals).
//   2. Lichess puzzle DB (Mongo `puzzles`): themes pawnEndgame, converged ratings
//      (plays>400, glicko.d<90), pieceCount<=7, spread 600→3000 — every candidate
//      verified as an OBJECTIVE win via the lichess tablebase before seeding.
// Positions where the solver is Black are colour-flipped so the user is always White.
// Idempotent (upsert on fen).
//
// Run:  cd v2 && ./apps/web/node_modules/.bin/tsx scripts/seed-pawnend.ts
import { readFileSync } from "fs";
import { MongoClient } from "mongodb";
import { Chess } from "chess.js";

const MONGO = process.env.MONGO_URI ?? "mongodb://localhost:27017/chessguru";
const TYPE = "pawn-endgames";
const BOOK = "Dvoretsky's Endgame Manual";
const PER_BAND = 45;
const BANDS: [number, number][] = [[600, 1000], [1000, 1400], [1400, 1800], [1800, 2200], [2200, 2600], [2600, 3000]];

// ── colour flip: mirror ranks + swap case, so the side to move becomes White ──
function flipFen(fen: string): string {
  const [board, turn, castle, ep, half, full] = fen.split(/\s+/);
  const flippedBoard = board!.split("/").reverse().map((row) =>
    [...row].map((ch) => (/[a-z]/.test(ch) ? ch.toUpperCase() : /[A-Z]/.test(ch) ? ch.toLowerCase() : ch)).join("")
  ).join("/");
  const flippedEp = ep && ep !== "-" ? ep[0]! + (9 - Number(ep[1])) : "-";
  return `${flippedBoard} ${turn === "w" ? "b" : "w"} ${castle ?? "-"} ${flippedEp} ${half ?? "0"} ${full ?? "1"}`;
}
const flipUci = (m: string) =>
  m.slice(0, 1) + (9 - Number(m[1])) + m.slice(2, 3) + (9 - Number(m[3])) + (m.slice(4) || "");

const pawnOnly = (fen: string) => /^[KkPp1-8/]+$/.test(fen.split(/\s+/)[0]!);
const legal = (fen: string) => { try { new Chess(fen); return true; } catch { return false; } };

// ── 1. Dvoretsky entries out of Book.tsx (regex; the data is inline there) ────
function dvoretsky(): any[] {
  const src = readFileSync(new URL("../apps/web/src/pages/Book.tsx", import.meta.url), "utf8");
  const start = src.indexOf("const EM_PUZZLES");
  const end = src.indexOf("];", start);
  const body = src.slice(start, end);
  const docs: any[] = [];
  for (const chunk of body.split(/\{ n: /).slice(1)) {
    const g = (re: RegExp) => chunk.match(re)?.[1];
    const num = g(/num: "([^"]+)"/), fen = g(/fen: "([^"]+)"/), side = g(/side: "([wb])"/);
    const goal = g(/goal: "(win|draw)"/), rating = g(/rating: (\d+)/), diff = g(/diff: "([^"]+)"/);
    if (!num || !fen || !side || !goal || !rating) continue;
    if (!pawnOnly(fen)) continue;                       // kings + pawns only (skip Q-vs-P etc.)
    const f = side === "b" ? flipFen(fen) : fen;
    if (!f.includes(" w ") || !legal(f)) continue;      // solver must be White to move
    docs.push({
      type: TYPE, fen: f, result: goal, dtm: null, solution: [],
      rating: Number(rating), rd: 200, vol: 0.06, nb: 0,
      seedMethod: "dvoretsky-book", book: BOOK, topic: diff ?? null, srcNum: num,
      flipped: side === "b", createdAt: new Date(),
    });
  }
  return docs;
}

// ── 2. lichess pawnEndgame puzzles, tablebase-verified objective wins ─────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function tbCategory(fen: string): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch("https://tablebase.lichess.ovh/standard?fen=" + encodeURIComponent(fen));
      if (res.status === 429) { console.log("  tb 429 — backing off 65s"); await sleep(65000); continue; }
      if (!res.ok) return null;
      const j: any = await res.json();
      return j.category ?? null;                        // from the SIDE TO MOVE's perspective
    } catch { await sleep(2000); }
  }
  return null;
}

async function lichess(db: any): Promise<any[]> {
  const col = db.collection("puzzles");
  const docs: any[] = [];
  for (const [lo, hi] of BANDS) {
    const cands: any[] = await col.aggregate([
      { $match: { themes: "pawnEndgame", plays: { $gt: 400 }, "glicko.d": { $lt: 90 }, pieceCount: { $lte: 7 },
                  "glicko.r": { $gte: lo, $lt: hi } } },
      { $match: { themes: { $ne: "equality" } } },
      { $sample: { size: PER_BAND * 2 } },
    ]).toArray();
    let kept = 0;
    for (const p of cands) {
      if (kept >= PER_BAND) break;
      const line: string[] = String(p.line ?? "").split(/\s+/).filter(Boolean);
      if (line.length < 2) continue;
      let g: Chess;
      try { g = new Chess(p.fen); g.move({ from: line[0]!.slice(0, 2), to: line[0]!.slice(2, 4), promotion: (line[0]![4] as any) || undefined }); }
      catch { continue; }
      let fen = g.fen();
      if (!pawnOnly(fen)) continue;
      const cat = await tbCategory(fen);                // verify: objectively WON for the solver
      await sleep(350);
      if (cat !== "win") continue;
      const flipped = fen.includes(" b ");
      let sol = line.slice(1);
      if (flipped) { fen = flipFen(fen); sol = sol.map(flipUci); }
      if (!legal(fen)) continue;
      docs.push({
        type: TYPE, fen, result: "win", dtm: null, solution: sol,
        rating: Math.round(p.glicko.r), rd: Math.max(60, Math.round(p.glicko.d)), vol: 0.06, nb: 0,
        seedMethod: "lichess-tb", lichessId: String(p._id), plays: p.plays, flipped, createdAt: new Date(),
      });
      kept++;
    }
    console.log(`band ${lo}-${hi}: kept ${kept}/${cands.length} candidates`);
  }
  return docs;
}

async function main() {
  const client = new MongoClient(MONGO);
  await client.connect();
  const db = client.db();

  const dv = dvoretsky();
  console.log(`dvoretsky pawn-only entries: ${dv.length} (win ${dv.filter((d) => d.result === "win").length} / draw ${dv.filter((d) => d.result === "draw").length})`);
  const li = await lichess(db);
  console.log(`lichess verified wins: ${li.length}`);

  const col = db.collection("study_puzzles");
  let ins = 0;
  for (const d of [...dv, ...li]) {
    const r = await col.updateOne({ fen: d.fen }, { $setOnInsert: d }, { upsert: true });
    if (r.upsertedCount) ins++;
  }
  const total = await col.countDocuments({ type: TYPE });
  const agg = await col.aggregate([{ $match: { type: TYPE } }, { $group: { _id: null, min: { $min: "$rating" }, max: { $max: "$rating" }, avg: { $avg: "$rating" } } }]).toArray();
  console.log(`\ninserted ${ins} new · type=${TYPE}: ${total} total · ratings ${agg[0]?.min}–${agg[0]?.max} (avg ${Math.round(agg[0]?.avg ?? 0)})`);
  await client.close();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
