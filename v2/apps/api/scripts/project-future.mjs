// For each active player, project the next 50 puzzle solves under the NEW
// model — assuming they keep playing the SAME theme mix at the SAME accuracy
// they showed in the past 5 days. Owner ask 2026-08-24 "run future test".
//
// For each user:
//   1. Analyse past 5d to derive theme distribution + per-theme win rate
//   2. Simulate 50 additional solves distributed proportionally by theme
//      with the observed accuracy
//   3. Report projected rating

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

console.log(`\nProjecting next 50 solves for ${active.length} users`);
console.log("Based on their observed theme distribution + accuracy over past 5 days.\n");
console.log("uid                  rating   acc%   top themes                    proj Δ   proj R  trend");
console.log("─".repeat(105));

const results = [];
for (const a of active) {
  const uid = a._id;
  const perf = await db.collection("userperfs").findOne({ _id: uid }, { projection: { "puzzle.gl": 1, "puzzle.nb": 1 } });
  if (!perf?.puzzle?.gl) continue;
  const currentR = Math.round(perf.puzzle.gl.r);

  // Gather past-5d theme distribution + accuracy
  const rows = await db.collection("rounds").find({
    _id: { $regex: `^${uid}:` }, k: "puzzle", d: { $gte: cutoff },
  }).project({ w: 1, sel: 1 }).toArray();
  const byTheme = {};
  for (const r of rows) {
    const t = r.sel || "mix";
    if (!byTheme[t]) byTheme[t] = { n: 0, w: 0 };
    byTheme[t].n++;
    if (r.w) byTheme[t].w++;
  }
  const totalSolves = rows.length;
  const totalWins = rows.filter((r) => r.w).length;
  const overallAcc = totalWins / totalSolves;

  // Build simulation plan for next 50 solves — sample themes by frequency
  const plan = [];
  for (let i = 0; i < 50; i++) {
    // Pick theme weighted by past frequency
    let cum = 0, pick = Math.random() * totalSolves;
    let chosenTheme = null;
    for (const [t, s] of Object.entries(byTheme)) {
      cum += s.n;
      if (pick <= cum) { chosenTheme = t === "mix" ? null : t; break; }
    }
    // Determine win/loss by that themes observed accuracy
    const themeAcc = chosenTheme && byTheme[chosenTheme] ? byTheme[chosenTheme].w / byTheme[chosenTheme].n : overallAcc;
    const win = Math.random() < themeAcc;
    plan.push({ theme: chosenTheme, win });
  }

  // Simulate under new model with theme fatigue
  let sim = { gl: { r: currentR, d: Math.max(100, perf.puzzle.gl.d || 100), v: DEFAULT_VOLATILITY }, nb: perf.puzzle.nb || 100, re: [], la: null };
  const solveTimes = [];
  const now = Date.now();
  let simTime = now;
  for (const p of plan) {
    simTime += 30_000;   // assume 30s between solves
    while (solveTimes.length > 0 && (simTime - solveTimes[0].t) > 30 * 60_000) solveTimes.shift();
    const themeCount = p.theme ? solveTimes.filter((s) => s.theme === p.theme).length : 0;
    let fatigue = 1;
    if (p.win && p.theme && themeCount > 0) fatigue = 1 / (1 + themeCount / 15);
    // Puzzle rating = simulated at-level (matches current picker behaviour under global-only)
    const puzzleR = sim.gl.r;
    const upd = updatePuzzleRating(sim, { r: puzzleR, d: 80, v: DEFAULT_VOLATILITY }, p.win, p.theme);
    let delta = upd.ratingDiff;
    if (p.win && fatigue < 1 && delta > 0) {
      delta = Math.round(delta * fatigue);
      sim = { ...upd.userPerf, gl: { ...upd.userPerf.gl, r: sim.gl.r + delta } };
    } else {
      sim = upd.userPerf;
    }
    solveTimes.push({ t: simTime, theme: p.theme });
  }
  const projectedR = Math.round(sim.gl.r);
  const projectedDelta = projectedR - currentR;

  // Top 3 themes for display
  const topThemes = Object.entries(byTheme).sort((a, b) => b[1].n - a[1].n).slice(0, 3)
    .map(([t, s]) => `${t}(${s.n}·${Math.round(100 * s.w / s.n)}%)`).join(" ");

  const trend = projectedDelta > 30 ? "climbing ↗" : projectedDelta > 5 ? "gentle ↗" : projectedDelta > -5 ? "flat →" : projectedDelta > -30 ? "gentle ↘" : "dropping ↘";
  results.push({ uid, currentR, acc: overallAcc, topThemes, projectedDelta, projectedR, trend });
}

results.sort((a, b) => b.projectedDelta - a.projectedDelta);

for (const r of results) {
  console.log(
    r.uid.padEnd(20) +
    String(r.currentR).padStart(7) + "  " +
    (Math.round(r.acc * 100) + "%").padStart(4) + "   " +
    r.topThemes.padEnd(30).slice(0, 30) + "  " +
    (r.projectedDelta >= 0 ? "+" + r.projectedDelta : String(r.projectedDelta)).padStart(7) + "  " +
    String(r.projectedR).padStart(5) + "  " +
    r.trend
  );
}

console.log(`\nAssumptions:`);
console.log(`  - 50 solves distributed by their observed theme frequency`);
console.log(`  - Per-theme accuracy from their past 5 days`);
console.log(`  - Puzzle rating = at-level (matches new picker behaviour)`);
console.log(`  - Theme fatigue applied on same-theme wins (1/(1 + n/15) after 30 min window)`);
console.log(`  - Random draw simulation — re-run for slightly different projections`);
await client.close();
