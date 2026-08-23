// One-shot restore: undo the FULL=true correction for users whose solve
// pattern shows they were playing legitimately, not grinding. Analysis in
// preceding chat 2026-08-23 classified users by:
//   - atLevelPct     = wins on puzzles rated within 100 pts of old peak
//   - themeDiversity = distinct non-mix themes played
//   - fastSolves     = solves under 3s (spamming signal)
// Legitimate: atLevelPct >= 15% AND themeDiversity >= 5
//
// Verdict per user (owner call 2026-08-23):
//   LEGITIMATE — full restore to pre-correction rating
//   HARINITHARANJITH — restore to 1400 (mid-way; borderline-legit, 1084 solves
//                       across 51 themes but only 12% at-level so slight
//                       inflation from mass easy-solving is real)
//   GRINDERS — leave at corrected rating (no restore)

const RESTORE = {
  theerajkumarr:    2708,   // was 2708, corrected → 2471, restoring
  "janvi-2":        1961,   // was 1961, corrected → 1872, restoring
  mohammedaffan:    1357,   // was 1357, corrected → 1270, restoring
  pranavs:          1607,   // was 1607, corrected → 1529, restoring
  harinitharanjith: 1400,   // was 1470, corrected → 1249, restoring to mid
};

const DRY_RUN = process.env.DRY_RUN !== "false";

for (const [uid, newR] of Object.entries(RESTORE)) {
  const perf = db.userperfs.findOne({ _id: uid });
  if (!perf?.puzzle?.gl) { print("MISSING: " + uid); continue; }
  const oldR = Math.round(perf.puzzle.gl.r);
  print(`  ${uid.padEnd(18)} ${oldR} → ${newR}`);
  if (!DRY_RUN) {
    db.userperfs.updateOne(
      { _id: uid },
      { $set: { "puzzle.gl.r": newR, "puzzle.gl.d": 200 } },
    );
    // Also uncap re[] and rounds.r that we clamped earlier — those get re-cap
    // dynamically as user plays. But no need to touch history rows; they're
    // just data. The visible rating is what matters.
  }
}
print("");
print(DRY_RUN ? "DRY RUN — no writes" : "Applied.");
