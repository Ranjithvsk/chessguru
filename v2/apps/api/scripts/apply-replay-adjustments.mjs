// Retro-apply the NEW model's rating changes to every active user.
// Recomputes what each user's rating WOULD BE if their last 5 days had run
// under the current (Lichess weighted-avg + theme fatigue) model, then
// writes that as their global rating.
//
// Also:
//   1. Backs up prior rating to userperfs.puzzle.gl.rPreReplay for undo
//   2. Sets deviation to max(current, 100) so slow-climb from here is normal
//   3. Prepends new rating to re[] history
//   4. Clamps all per-themes to newR ± 300
//
// Owner directive 2026-08-24 Option A: full deltas applied. Big drops
// (up to -780) for over-inflated users; small gains for under-rewarded.

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
]).toArray();

console.log(`Applying Option A adjustment to ${active.length} users.`);
console.log();

let bumpedUp = 0, bumpedDown = 0, unchanged = 0;
let totalPositive = 0, totalNegative = 0;
const results = [];

for (const a of active) {
  const uid = a._id;
  const perf = await db.collection("userperfs").findOne({ _id: uid });
  if (!perf?.puzzle?.gl) continue;
  const currentR = Math.round(perf.puzzle.gl.r);
  const rows = await db.collection("rounds").find({
    _id: { $regex: `^${uid}:` }, k: "puzzle", d: { $gte: cutoff },
  }).sort({ d: 1 }).project({ w: 1, pr: 1, sel: 1, d: 1, rd: 1 }).toArray();
  const observedNet = rows.reduce((s, r) => s + (r.rd || 0), 0);
  const startR = currentR - observedNet;
  let sim = { gl: { r: startR, d: 100, v: DEFAULT_VOLATILITY }, nb: perf.puzzle.nb || 100, re: [], la: null };
  const solveTimes = [];
  for (const r of rows) {
    const d = new Date(r.d);
    while (solveTimes.length > 0 && (d - solveTimes[0].d) > 30 * 60_000) solveTimes.shift();
    const sel = r.sel && r.sel !== "mix" ? r.sel : null;
    const themeCount = sel ? solveTimes.filter((s) => s.sel === sel).length : 0;
    let fatigue = 1;
    if (r.w && sel && themeCount > 0) fatigue = 1 / (1 + themeCount / 15);
    const upd = updatePuzzleRating(sim, { r: r.pr || 1500, d: 80, v: DEFAULT_VOLATILITY }, r.w, sel);
    let delta = upd.ratingDiff;
    if (r.w && fatigue < 1 && delta > 0) {
      delta = Math.round(delta * fatigue);
      sim = { ...upd.userPerf, gl: { ...upd.userPerf.gl, r: sim.gl.r + delta } };
    } else {
      sim = upd.userPerf;
    }
    solveTimes.push({ d, sel });
  }
  const newR = Math.round(sim.gl.r);
  const swing = newR - currentR;

  // Apply
  const sets = {
    "puzzle.gl.r": newR,
    "puzzle.gl.d": Math.max(100, perf.puzzle.gl.d || 100),   // bump deviation a bit so future rating can move
    "puzzle.rPreReplay": currentR,                              // undo trail
    "puzzle.replayAppliedAt": new Date(),
  };
  // Prepend new rating to re[] so history reflects it
  const re = [newR, ...((perf.puzzle.re || []).filter((v) => typeof v === "number"))].slice(0, 100);
  sets["puzzle.re"] = re;
  // Clamp per-themes to new global ± 300
  for (const ns of ["themes", "themesBf"]) {
    const themes = perf[ns] || {};
    for (const [t, tp] of Object.entries(themes)) {
      const r = Math.round(tp?.gl?.r || 0);
      if (!r) continue;
      const clamped = Math.max(newR - 300, Math.min(newR + 300, r));
      if (clamped !== r) sets[`${ns}.${t}.gl.r`] = clamped;
    }
  }
  await db.collection("userperfs").updateOne({ _id: uid }, { $set: sets });
  results.push({ uid, currentR, newR, swing });
  if (swing > 0) { bumpedUp++; totalPositive += swing; }
  else if (swing < 0) { bumpedDown++; totalNegative += swing; }
  else unchanged++;
}

// Print summary sorted by absolute swing
results.sort((a, b) => Math.abs(b.swing) - Math.abs(a.swing));
console.log("uid                current →   new     swing");
console.log("─".repeat(60));
for (const r of results) {
  console.log(
    r.uid.padEnd(20) +
    String(r.currentR).padStart(6) + " →  " +
    String(r.newR).padStart(5) + "  " +
    (r.swing >= 0 ? "+" + r.swing : String(r.swing)).padStart(7)
  );
}
console.log();
console.log(`Applied: ${bumpedUp} up, ${bumpedDown} down, ${unchanged} unchanged.`);
console.log(`Total positive: +${totalPositive}. Total negative: ${totalNegative}.`);
console.log(`Backup written to userperfs.puzzle.rPreReplay for each user (undo trail).`);
await client.close();
