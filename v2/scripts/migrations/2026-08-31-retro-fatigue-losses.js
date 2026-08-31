// Retro-apply symmetric fatigue dampening to LOSSES on grinding sessions.
// Ran once on 2026-08-31 after commit 1b27ab8 (fatigue on losses).
//
// What it does
// ------------
// For every user with `puzzle`/`blindfold` perf, replay their rated rounds
// chronologically. For each LOSS where the theme is not "mix" AND the same
// theme was played in the prior 30 min (i.e. grinding), compute the same
// dampening the new code now applies at write-time:
//
//   fatigueMul   = 1 / (1 + sameThemeCount / 15)
//   dampenedRd   = round(rd * fatigueMul)   // rd < 0 → smaller magnitude
//   ptsOwedBack  = dampenedRd - rd          // > 0
//
// Sum per user, bump gl.r by owed. Wins were already dampened by old code;
// nothing to correct on that side.
//
// Safety
// ------
// - Snapshot userperfs to Drive BEFORE running (see AUDIT_PATH header).
// - Skip users with nb < 30 (provisional; legit swings).
// - Skip users owed > 200 pts (implausible; flagged for manual review).
// - Idempotent-ish: re-running would double-apply, so DO NOT rerun without
//   restoring the backup first.
//
// Results (2026-08-31 15:03 IST):
//   scanned: 65 users
//   updated: 31 (full lifetime, +2192 pts total)
//   skipped (provisional): 36
//   skipped (>200pt manual): 5   ← handled separately with last-100-only pass
//                                  (see 2026-08-31-retro-fatigue-losses-last100.js)
//
// Restore command if this all needs to be reverted:
//   mongorestore --drop -d chessguru \
//     /home/dreamworld/dreamworld-drive/system/userperfs-backup-2026-08-31/chessguru/

const AUDIT_PATH = "/home/dreamworld/dreamworld-drive/system/userperfs-backup-2026-08-31/audit-fatigue-retro.log";
const fs = require("fs");
const audit = fs.createWriteStream(AUDIT_PATH, { flags: "a" });
audit.write(`# retro-fatigue run @ ${new Date().toISOString()}\n`);
audit.write(`# columns: userId | perfKey | oldR | newR | delta | roundsDampened | wouldBeDelta200Skipped\n`);

const users = db.userperfs.find(
  { $or: [{ puzzle: { $exists: true } }, { blindfold: { $exists: true } }] },
  { _id: 1, puzzle: 1, blindfold: 1 },
).toArray();
print(`scanning ${users.length} users`);

let totalUsers = 0, totalUpdated = 0, totalPtsRestored = 0, totalSkippedProv = 0, totalSkippedLarge = 0;

for (const u of users) {
  totalUsers++;
  for (const perfKey of ["puzzle", "blindfold"]) {
    const perf = u[perfKey];
    if (!perf || !perf.gl) continue;
    if ((perf.nb || 0) < 30) { totalSkippedProv++; continue; }

    const uidRe = { $regex: `^${u._id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:` };
    const rounds = db.rounds
      .find({ _id: uidRe, k: perfKey, rd: { $ne: 0 } }, { d: 1, sel: 1, rd: 1 })
      .sort({ d: 1 })
      .toArray();
    if (rounds.length === 0) continue;

    let owed = 0, dampenedCount = 0;
    for (let i = 0; i < rounds.length; i++) {
      const r = rounds[i];
      if (r.rd >= 0) continue;                     // wins path unchanged
      if (!r.sel || r.sel === "mix") continue;     // fatigue doesn't fire on mix
      const cutoff = new Date(r.d.getTime() - 30 * 60_000);
      let sameTheme = 0;
      for (let j = i - 1; j >= 0; j--) {
        if (rounds[j].d < cutoff) break;
        if (rounds[j].sel === r.sel) sameTheme++;
      }
      if (sameTheme === 0) continue;               // fresh theme → no fatigue
      const mul = 1 / (1 + sameTheme / 15);
      const gain = Math.round(r.rd * mul) - r.rd;
      if (gain > 0) { owed += gain; dampenedCount++; }
    }

    if (owed === 0) continue;
    if (owed > 200) {
      audit.write(`SKIP-LARGE\t${u._id}\t${perfKey}\t${Math.round(perf.gl.r)}\t${Math.round(perf.gl.r)}\t+${owed}\t${dampenedCount}\n`);
      totalSkippedLarge++;
      continue;
    }
    const oldR = Math.round(perf.gl.r);
    const newR = oldR + owed;
    db.userperfs.updateOne({ _id: u._id }, { $inc: { [`${perfKey}.gl.r`]: owed } });
    audit.write(`OK\t${u._id}\t${perfKey}\t${oldR}\t${newR}\t+${owed}\t${dampenedCount}\n`);
    totalUpdated++;
    totalPtsRestored += owed;
  }
}

audit.write(`# summary: users=${totalUsers} updated=${totalUpdated} pts_restored=${totalPtsRestored} skipped_provisional=${totalSkippedProv} skipped_large=${totalSkippedLarge}\n`);
audit.end();
print(`\n=== RESULT ===`);
print(`users scanned:                       ${totalUsers}`);
print(`perf rows updated:                   ${totalUpdated}`);
print(`total pts restored:                  +${totalPtsRestored}`);
print(`skipped (provisional):               ${totalSkippedProv}`);
print(`skipped (>200pt, needs review):      ${totalSkippedLarge}`);
