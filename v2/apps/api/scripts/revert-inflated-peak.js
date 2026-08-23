// Cap historical rating snapshots (user's own rating after each solve) at
// the user's NEW current rating post-correction. Companion to the FULL=true
// rating correction — without this, "Personal Best" on the History page + the
// puzzle.re[] trailing sparkline still show the pre-correction inflated
// peaks (e.g. Mageswaran's re[] max was 2809 while his current is 2556).
//
// What we clamp:
//   1. userperfs.puzzle.re[]        — trailing 100 user-rating snapshots
//   2. rounds[i].r                   — user rating AFTER each solve (used by
//                                       PublicResultsHome "personal best" scan)
//
// Users touched: same 12 users the gradual-rating-correction script flagged.
// Formula: rounds.r = min(rounds.r, new_current + 20). +20 tolerance to keep
// a tiny bit of "climbed slightly above current" wiggle so future genuine
// growth is not blocked.
//
// Runs: DRY_RUN=true|false mongosh chessguru --quiet revert-inflated-peak.js

const DRY_RUN = process.env.DRY_RUN !== "false";
const TOLERANCE = 20;

// Only the users whose global rating was actually corrected by the FULL=true
// pass on 2026-08-23. Their historical peaks are known artifacts of the
// 1500-fresh-seed / easy-grind inflation bug. Other users' peaks reflect
// real skill (Glicko rating naturally drifts down after losses; the peak
// is a legitimate personal-best of their actual play).
const CORRECTED_USERS = new Set([
  "deepakcharanv",
  "yakshith",
  "mageswaran",
  "theerajkumarr",
  "harinitharanjith",
  "dakshavs",
  "rohitcharan",
  "ashwanth",
  "janvi-2",
  "mohammedaffan",
  "pranavs",
  "akshita",
]);

async function revert() {
  const users = db.userperfs.find({ _id: { $in: Array.from(CORRECTED_USERS) } }).toArray();
  print(`Scanning ${users.length} of the ${CORRECTED_USERS.size} corrected users. Mode: ${DRY_RUN ? "DRY RUN" : "APPLY"}`);
  print("");

  let usersTouched = 0;
  const summary = [];

  for (const u of users) {
    const currentR = Math.round(u.puzzle.gl.r);
    const cap = currentR + TOLERANCE;
    const re = u.puzzle.re || [];
    const peakInRe = re.length ? Math.max(...re) : 0;
    if (peakInRe <= cap) continue;  // nothing to clamp

    const newRe = re.map(r => Math.min(r, cap));
    const roundsAgg = db.rounds.aggregate([
      { $match: { _id: { $regex: "^" + u._id + ":" }, k: "puzzle", r: { $gt: cap } } },
      { $count: "n" },
    ]).toArray();
    const roundsToClamp = roundsAgg[0]?.n || 0;

    if (!DRY_RUN) {
      db.userperfs.updateOne({ _id: u._id }, { $set: { "puzzle.re": newRe } });
      // Clamp rounds.r via updateMany with $min
      db.rounds.updateMany(
        { _id: { $regex: "^" + u._id + ":" }, k: "puzzle", r: { $gt: cap } },
        [{ $set: { r: cap } }],
      );
    }

    summary.push({
      uid: u._id, currentR, oldPeakRe: peakInRe, newPeakCap: cap, roundsClamped: roundsToClamp,
    });
    usersTouched++;
  }

  summary.sort((a, b) => b.oldPeakRe - a.oldPeakRe);
  print(`${DRY_RUN ? "Would touch" : "Touched"} ${usersTouched} users:`);
  print(`${"user".padEnd(20)} current  oldPeak(re) → newCap  rounds.r>cap`);
  for (const s of summary) {
    print(`  ${s.uid.padEnd(18)} ${String(s.currentR).padStart(4)}    ${String(s.oldPeakRe).padStart(4)} → ${String(s.newPeakCap).padStart(4)}    ${s.roundsClamped}`);
  }
}

revert();
