// One-off retro for deepakcharanv: recompute his last 100 rated puzzle rounds
// under the NEW difficulty-aware fatigue divisor (hardest=8, harder=10,
// normal=15) and apply the net rating delta.
//
// Ran once on 2026-08-31 immediately after committing the difficulty-aware
// fatigue change. Only deepakcharanv was affected (his mateIn2 hardest-mode
// 47-puzzle grind that day was the reproducer).
//
// Result: 2480 → 2451 (adj −29 across 49 affected rounds).
//
// NOT idempotent. DO NOT re-run.

const uidRe = { $regex: "^deepakcharanv:" };
const rounds = db.rounds
  .find({ _id: uidRe, k: "puzzle", rd: { $ne: 0 } }, { d: 1, sel: 1, rd: 1, df: 1 })
  .sort({ d: -1 })
  .limit(100)
  .toArray();
rounds.reverse();

let netAdj = 0;
for (let i = 0; i < rounds.length; i++) {
  const r = rounds[i];
  if (!r.sel || r.sel === "mix") continue;
  const div = r.df === "hardest" ? 8 : r.df === "harder" ? 10 : 15;
  if (div === 15) continue;                                    // same as pre-change

  const cutoff = new Date(r.d.getTime() - 30 * 60_000);
  let n = 0;
  for (let j = i - 1; j >= 0; j--) {
    if (rounds[j].d < cutoff) break;
    if (rounds[j].sel === r.sel) n++;
  }
  if (n === 0) continue;

  const oldMul = 1 / (1 + n / 15);
  const newMul = 1 / (1 + n / div);
  // Stored rd is the ALREADY-DAMPENED value under the old divisor.
  // Back it out (rawPreFatigue = rd / oldMul), then apply newMul.
  const newRd = Math.round((r.rd / oldMul) * newMul);
  netAdj += newRd - r.rd;
}

const before = db.userperfs.findOne({ _id: "deepakcharanv" }, { puzzle: 1 }).puzzle.gl.r;
db.userperfs.updateOne({ _id: "deepakcharanv" }, { $inc: { "puzzle.gl.r": netAdj } });
const after = db.userperfs.findOne({ _id: "deepakcharanv" }, { puzzle: 1 }).puzzle.gl.r;
print(`deepakcharanv puzzle.gl.r: ${Math.round(before)} → ${Math.round(after)} (adj ${netAdj >= 0 ? "+" : ""}${netAdj})`);
