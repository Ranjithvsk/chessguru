// Companion to 2026-08-31-retro-fatigue-losses.js — handles the 5 users the
// main pass skipped (owed > 200 pt cap). Owner decision (2026-08-31 16:15
// IST): apply based on their LAST 100 rated rounds only, not full lifetime.
// Modest, plausible corrections.
//
// Ran once immediately after the main pass.
//
// Results:
//   srinithi_sn       1484 → 1567  (+83,  19 grind losses in last 100)
//   harinitharanjith  1144 → 1163  (+19,   9 grind losses in last 100)
//   raksshan          1716 → 1768  (+52,  16 grind losses in last 100)
//   haadhvithasri      933 → 1011  (+78,  14 grind losses in last 100)
//   akshita           1167 → 1298  (+131, 11 grind losses in last 100)
//   subtotal:                       +363 pts over 5 users
//
// Combined with the main pass (+2192 over 31 users) the grand total is
// +2555 pts restored across 36 students on 2026-08-31.

const targets = ["srinithi_sn", "harinitharanjith", "raksshan", "haadhvithasri", "akshita"];
print("=== 5 skipped-large users: applying LAST 100 rounds only ===");

for (const uid of targets) {
  const u = db.userperfs.findOne({ _id: uid }, { puzzle: 1 });
  if (!u || !u.puzzle) { print(uid, "no puzzle perf"); continue; }
  const uidRe = { $regex: `^${uid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:` };
  // Newest 100 rated rounds, then reverse to chronological for fatigue math.
  const rounds = db.rounds
    .find({ _id: uidRe, k: "puzzle", rd: { $ne: 0 } }, { d: 1, sel: 1, rd: 1 })
    .sort({ d: -1 })
    .limit(100)
    .toArray();
  rounds.reverse();
  let owed = 0, dampened = 0;
  for (let i = 0; i < rounds.length; i++) {
    const r = rounds[i];
    if (r.rd >= 0 || !r.sel || r.sel === "mix") continue;
    const cutoff = new Date(r.d.getTime() - 30 * 60_000);
    let sameTheme = 0;
    for (let j = i - 1; j >= 0; j--) {
      if (rounds[j].d < cutoff) break;
      if (rounds[j].sel === r.sel) sameTheme++;
    }
    if (sameTheme === 0) continue;
    const gain = Math.round(r.rd * 1 / (1 + sameTheme / 15)) - r.rd;
    if (gain > 0) { owed += gain; dampened++; }
  }
  const oldR = Math.round(u.puzzle.gl.r);
  if (owed === 0) { print(`  ${uid}: no last-100 grinding losses — no change`); continue; }
  db.userperfs.updateOne({ _id: uid }, { $inc: { "puzzle.gl.r": owed } });
  print(`  ${uid.padEnd(20)}  ${oldR} → ${oldR + owed}  (+${owed}, ${dampened} grind losses in last 100)`);
}
