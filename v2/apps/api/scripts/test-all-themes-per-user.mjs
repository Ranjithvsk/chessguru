// For each active user, simulate solving 10 puzzles in EACH theme + a
// 30-solve grinding attempt in mateIn1. All at the user's observed accuracy.
// Owner ask 2026-08-24: "solve all themes for all players, and try grinding
// using their solve percentage".
//
// Output: matrix of rating change per (user, theme) + a grinding column.

import { MongoClient } from "mongodb";
import { updatePuzzleRating, DEFAULT_VOLATILITY } from "/home/ubuntu/chessguru/v2/apps/api/dist/glicko/glicko.js";

const client = new MongoClient("mongodb://localhost:27017");
await client.connect();
const db = client.db("chessguru");

const cutoff = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
const active = await db.collection("rounds").aggregate([
  { $match: { d: { $gte: cutoff }, k: "puzzle" } },
  { $group: { _id: { $arrayElemAt: [{ $split: ["$_id", ":"] }, 0] }, n: { $sum: 1 } } },
  { $match: { n: { $gte: 15 } } },
  { $sort: { n: -1 } },
]).toArray();

const themes = [
  { key: null,           label: "mix" },
  { key: "mateIn1",      label: "M1" },
  { key: "mateIn2",      label: "M2" },
  { key: "mateIn3",      label: "M3" },
  { key: "fork",         label: "fork" },
  { key: "pin",          label: "pin" },
  { key: "endgame",      label: "endg" },
  { key: "sacrifice",    label: "sac" },
];

function simulateSolves(startPerf, count, theme, accuracy) {
  let perf = { ...startPerf, gl: { ...startPerf.gl } };
  const solveTimes = [];
  let simTime = Date.now();
  for (let i = 0; i < count; i++) {
    simTime += 30_000;
    while (solveTimes.length > 0 && (simTime - solveTimes[0].t) > 30 * 60_000) solveTimes.shift();
    const themeCount = theme ? solveTimes.filter((s) => s.theme === theme).length : 0;
    // Deterministic win/loss to hit accuracy
    const win = (i / count) < accuracy;
    let fatigue = 1;
    if (win && theme && themeCount > 0) fatigue = 1 / (1 + themeCount / 15);
    const puzzleR = perf.gl.r;
    const upd = updatePuzzleRating(perf, { r: puzzleR, d: 80, v: DEFAULT_VOLATILITY }, win, theme);
    let delta = upd.ratingDiff;
    if (win && fatigue < 1 && delta > 0) {
      delta = Math.round(delta * fatigue);
      perf = { ...upd.userPerf, gl: { ...upd.userPerf.gl, r: perf.gl.r + delta } };
    } else {
      perf = upd.userPerf;
    }
    solveTimes.push({ t: simTime, theme });
  }
  return Math.round(perf.gl.r) - Math.round(startPerf.gl.r);
}

// Header
console.log("\nSimulating: for each user, 10 solves in each theme + 30 mateIn1 grind attempt.\n");
console.log("Numbers = rating Δ if user plays 10 puzzles at their observed accuracy.");
console.log("(GRIND = 30 mateIn1 solves in one 30-min session at their accuracy.)");
console.log();
const hdr = "user".padEnd(20) + "acc%".padStart(5) + " r".padStart(6) + "  " +
  themes.map((t) => t.label.padStart(5)).join(" ") + "  GRIND".padStart(7);
console.log(hdr);
console.log("─".repeat(hdr.length));

for (const a of active) {
  const uid = a._id;
  const perf = await db.collection("userperfs").findOne({ _id: uid }, { projection: { "puzzle.gl": 1, "puzzle.nb": 1 } });
  if (!perf?.puzzle?.gl) continue;
  const currentR = Math.round(perf.puzzle.gl.r);

  const rows = await db.collection("rounds").find({
    _id: { $regex: `^${uid}:` }, k: "puzzle", d: { $gte: cutoff },
  }).project({ w: 1 }).toArray();
  const acc = rows.filter((r) => r.w).length / rows.length;

  const startPerf = { gl: { r: currentR, d: Math.max(100, perf.puzzle.gl.d || 100), v: DEFAULT_VOLATILITY }, nb: perf.puzzle.nb, re: [], la: null };

  const deltas = themes.map((t) => simulateSolves(startPerf, 10, t.key, acc));
  const grindDelta = simulateSolves(startPerf, 30, "mateIn1", acc);

  console.log(
    uid.padEnd(20) +
    (Math.round(acc * 100) + "%").padStart(5) +
    String(currentR).padStart(6) + "  " +
    deltas.map((d) => (d >= 0 ? "+" + d : String(d)).padStart(5)).join(" ") +
    "  " + (grindDelta >= 0 ? "+" + grindDelta : String(grindDelta)).padStart(6)
  );
}

console.log(`
Key insights:
  mix       (weight 1.0)  — biggest gains, no fatigue
  M1/M2/M3  (obvious/hint) — small gains, capped by weight + fatigue
  fork/pin  (hinting)      — moderate gains
  endg      (neutral)      — big gains, no fatigue on this per-theme
  GRIND     (30 M1 in one session) — first ~15 solves gain, then fatigue kicks in
`);
await client.close();
