// Rewrite each round's rd + r (user-rating-after) under the NEW model.
// Owner ask 2026-08-24: history page should reflect the new rating deltas,
// not what the old capped model recorded.
//
// For each active user in past 5 days: walk rounds chronologically, replay
// through the new weighted-average model + theme fatigue, and updateOne
// each round doc's rd/r fields.
//
// Rounds outside the 5-day window are left alone (too much churn + they
// are old enough that no one is looking at them regularly).
//
// Also updates userperfs.puzzle.re[] to the new rating trajectory.

import { MongoClient } from "mongodb";
import { updatePuzzleRating, DEFAULT_VOLATILITY } from "/home/ubuntu/chessguru/v2/apps/api/dist/glicko/glicko.js";

const client = new MongoClient("mongodb://localhost:27017");
await client.connect();
const db = client.db("chessguru");

const cutoff = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
const active = await db.collection("rounds").aggregate([
  { $match: { d: { $gte: cutoff }, k: "puzzle" } },
  { $group: { _id: { $arrayElemAt: [{ $split: ["$_id", ":"] }, 0] }, n: { $sum: 1 } } },
  { $match: { n: { $gte: 5 } } },
]).toArray();

console.log(`Rewriting round history for ${active.length} users in past 5 days.\n`);
let totalRoundsUpdated = 0;

for (const a of active) {
  const uid = a._id;
  const perf = await db.collection("userperfs").findOne({ _id: uid });
  if (!perf?.puzzle?.gl) continue;

  // Current rating is post-replay. Sum up new-model deltas from the replay
  // simulation to derive the pre-window starting point.
  const currentR = Math.round(perf.puzzle.gl.r);
  const rows = await db.collection("rounds").find({
    _id: { $regex: `^${uid}:` }, k: "puzzle", d: { $gte: cutoff },
  }).sort({ d: 1 }).toArray();

  // First simulate to figure out per-round new deltas
  // (same math as apply-replay-adjustments.mjs — needs to match)
  // Walk from a startR that will end at currentR (deterministically).
  // Since Option A already wrote the new rating, we simulate FORWARD from
  // the startR that yields currentR at the end.
  const rounds = rows;
  // Estimate startR: walk backward, cumulatively subtract each new-model
  // delta from currentR. But we don't know the deltas yet — chicken/egg.
  // Simpler: use the same simulation as apply-replay used. Solve for startR
  // such that final sim rating == currentR. But apply-replay used
  //   startR = currentR_beforeReplay - observedNet   → then simulated → newR
  // and wrote newR as puzzle.gl.r. So startR is well-defined:
  const rPreReplay = perf.puzzle.rPreReplay ?? currentR;
  const observedNet = rounds.reduce((s, r) => s + (r.rd || 0), 0);
  const startR = rPreReplay - observedNet;

  // Now replay + build the per-round rewrites
  let sim = { gl: { r: startR, d: 100, v: DEFAULT_VOLATILITY }, nb: perf.puzzle.nb || 100, re: [], la: null };
  const solveTimes = [];
  const rewrites = [];
  const trajectory = [];
  for (const r of rounds) {
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
    const newR = Math.round(sim.gl.r);
    rewrites.push({ _id: r._id, oldRd: r.rd, newRd: delta, oldR: r.r, newR });
    trajectory.push(newR);
    solveTimes.push({ d, sel });
  }

  // Bulk update rounds
  const bulk = db.collection("rounds").initializeUnorderedBulkOp();
  for (const rw of rewrites) {
    bulk.find({ _id: rw._id }).updateOne({ $set: { rd: rw.newRd, r: rw.newR } });
  }
  const bulkResult = await bulk.execute();
  totalRoundsUpdated += bulkResult.modifiedCount;

  // Update userperfs.puzzle.re[] to reflect new trajectory (last 100 entries)
  // Prepend NEW trajectory (reversed so latest is first) + keep any older entries
  const oldRe = perf.puzzle.re || [];
  const preTrajectoryRe = oldRe.slice(rewrites.length);   // entries older than our window
  const newRe = [...trajectory.slice().reverse(), ...preTrajectoryRe].slice(0, 100);
  await db.collection("userperfs").updateOne({ _id: uid }, { $set: { "puzzle.re": newRe } });

  console.log(`  ${uid.padEnd(20)} ${rounds.length} rounds rewritten (final r=${Math.round(sim.gl.r)})`);
}

console.log(`\nTotal rounds updated: ${totalRoundsUpdated}`);
await client.close();
