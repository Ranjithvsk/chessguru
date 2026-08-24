// Full replay: for every user with recent solves, simulate their last 5
// days under the NEW model + fatigue. Compare current rating to what the
// new model would have given them.
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

console.log("\nReplaying " + active.length + " users with 15+ solves in past 5 days.");
console.log("Simulating current-model (weighted avg + theme fatigue only, no volume fatigue).\n");
console.log("uid                  cur.R    5d rounds W/L   OLD Δrd  NEW Δrd  NEW.R  delta");
console.log("─".repeat(88));

const results = [];
for (const a of active) {
  const uid = a._id;
  const perf = await db.collection("userperfs").findOne({ _id: uid }, { projection: { "puzzle.gl": 1, "puzzle.nb": 1 } });
  const currentR = Math.round(perf?.puzzle?.gl?.r || 1500);
  const rows = await db.collection("rounds").find({
    _id: { $regex: `^${uid}:` }, k: "puzzle", d: { $gte: cutoff },
  }).sort({ d: 1 }).project({ w: 1, pr: 1, sel: 1, d: 1, rd: 1 }).toArray();
  const observedNet = rows.reduce((s, r) => s + (r.rd || 0), 0);
  const wins = rows.filter((r) => r.w).length;
  const startR = currentR - observedNet;

  let sim = { gl: { r: startR, d: 100, v: DEFAULT_VOLATILITY }, nb: 100, re: [], la: null };
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
  const newNet = newR - startR;
  const swing = newR - currentR;
  results.push({ uid, currentR, startR, rounds: rows.length, wins, losses: rows.length - wins, observedNet, newNet, newR, swing });
}

// Sort by absolute swing (biggest change first)
results.sort((a, b) => Math.abs(b.swing) - Math.abs(a.swing));

for (const r of results) {
  console.log(
    r.uid.padEnd(20) +
    String(r.currentR).padStart(6) + "  " +
    String(r.rounds).padStart(5) + "  " +
    (r.wins + "/" + r.losses).padStart(7) + " " +
    (r.observedNet >= 0 ? "+" + r.observedNet : String(r.observedNet)).padStart(9) + " " +
    (r.newNet >= 0 ? "+" + r.newNet : String(r.newNet)).padStart(9) + " " +
    String(r.newR).padStart(5) + " " +
    (r.swing >= 0 ? "+" + r.swing : String(r.swing)).padStart(6)
  );
}

console.log();
console.log("Reading: NEW Δrd = what the past 5 days WOULD have given under the new model.");
console.log("         NEW.R = their rating if we retro-applied the new model.");
console.log("         delta = NEW.R - current (what needs to be added/subtracted to reach the new-model rating).");
await client.close();
