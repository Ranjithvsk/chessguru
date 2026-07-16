// Seed the "Key squares" study module (Mongo study_puzzles, type "keysq") — a
// SEPARATE trainer with its own Glicko rating and a different question: "tap every
// key square." One position per pawn placement; the answer (the key squares) is
// computed by the exact KPK oracle via keySquares(). Rook pawns are trick positions
// (no key squares → the defender draws in the corner). Idempotent (upsert on fen).
//
// Run:  cd v2 && ./apps/web/node_modules/.bin/tsx scripts/seed-keysquares.ts
import { MongoClient } from "mongodb";
import { buildDTM, setTable, evaluateKPK } from "../apps/web/src/lib/endgame/kpk";
import { keySquares } from "../apps/web/src/lib/endgame/keySquares";

const MONGO = process.env.MONGO_URI ?? "mongodb://localhost:27017/chessguru";
const TYPE = "keysq";
const FILES = "abcdefgh";
const idx = (s: string) => ({ f: FILES.indexOf(s[0]!), r: +s[1]! });
const name = (f: number, r: number) => FILES[f]! + r;
const cheby = (a: string, b: string) => { const A = idx(a), B = idx(b); return Math.max(Math.abs(A.f - B.f), Math.abs(A.r - B.r)); };

function fen(wk: string, pawn: string, bk: string): string {
  const b = Array.from({ length: 8 }, () => Array(8).fill(""));
  const put = (s: string, c: string) => { const { f, r } = idx(s); b[8 - r]![f] = c; };
  put(wk, "K"); put(pawn, "P"); put(bk, "k");
  const rows = b.map((row) => { let o = "", e = 0; for (const c of row) { if (c) { if (e) { o += e; e = 0; } o += c; } else e++; } if (e) o += e; return o; });
  return rows.join("/") + " w - - 0 1";
}

// Place the two kings on plausible, legal squares clear of the pawn & key squares.
function placeKings(pawn: string, keys: string[]): { wk: string; bk: string } | null {
  const busy = new Set([pawn, ...keys]);
  const wkOpts = ["a1", "b1", "c1", "a2", "h1", "g1", "b2"];
  const bkOpts = ["h8", "g8", "f8", "h7", "a8", "b8", "g7"];
  for (const wk of wkOpts) for (const bk of bkOpts) {
    if (busy.has(wk) || busy.has(bk) || wk === bk) continue;
    if (cheby(wk, bk) <= 1) continue;             // kings can't be adjacent
    const e = evaluateKPK(fen(wk, pawn, bk));
    if (e.legal) return { wk, bk };
  }
  return null;
}

// Difficulty rating: rook-pawn trick hardest; 6-square harder than 3; edge files &
// advanced pawns a touch harder.
function ratePawn(pawn: string, keys: string[], rook: boolean): number {
  const { f, r } = idx(pawn);
  if (rook) return 1450 + (r >= 5 ? 60 : 0);
  let base = keys.length >= 6 ? 1250 : 1000;
  if (f === 1 || f === 6) base += 90;             // b/g files (edge of the non-rook range)
  if (r >= 5) base += 80;                          // advanced
  if (r === 2) base -= 60;                         // home rank easiest
  return base;
}

async function main() {
  console.log("building KPK table…");
  setTable(buildDTM());
  const docs: any[] = [];
  for (let f = 0; f < 8; f++) {
    for (let r = 2; r <= 6; r++) {
      const pawn = name(f, r);
      const ks = keySquares(fen("a1", pawn, "h8"));   // key squares are king-independent
      const kings = placeKings(pawn, ks.squares);
      if (!kings) { console.log("skip (no legal kings):", pawn); continue; }
      const ff = fen(kings.wk, pawn, kings.bk);
      docs.push({
        type: TYPE, kind: "keysquares", fen: ff, pawn,
        rookPawn: ks.rookPawn, solution: ks.squares, nKeys: ks.squares.length,
        result: ks.rookPawn ? "draw" : "win",
        rating: ratePawn(pawn, ks.squares, ks.rookPawn), rd: 350, vol: 0.06, nb: 0,
        seedMethod: "kpk-oracle", createdAt: new Date(),
      });
    }
  }
  const client = new MongoClient(MONGO);
  await client.connect();
  const col = client.db().collection("study_puzzles");
  try { await col.createIndex({ type: 1, rating: 1 }); await col.createIndex({ fen: 1 }, { unique: true }); } catch { /* */ }
  let ins = 0;
  for (const d of docs) {
    const r = await col.updateOne({ fen: d.fen }, { $setOnInsert: d }, { upsert: true });
    if (r.upsertedCount) ins++;
  }
  const total = await col.countDocuments({ type: TYPE });
  const rook = await col.countDocuments({ type: TYPE, rookPawn: true });
  console.log(`\ninserted ${ins} new · study_puzzles type=${TYPE}: ${total} total (${rook} rook-pawn trick), ratings ${Math.min(...docs.map(d => d.rating))}–${Math.max(...docs.map(d => d.rating))}`);
  await client.close();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
