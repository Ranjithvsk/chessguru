// Compute solvePattern stats for each user with enough puzzle history.
// Stored under userperfs.puzzle.solvePattern = { type, atLevelPct,
// themeDiversity, fastSolves, sameThemeStreak, lastComputed }.
//
// - atLevelPct: % of wins on puzzles rated within 100 of user's global
// - themeDiversity: distinct non-mix themes played (all-time)
// - fastSolves: solves under 3s (last 60 solves)
// - sameThemeStreak: consecutive solves on same theme (recent tail)
// - type: "legitimate" | "borderline" | "grinder"
//     legitimate → atLevelPct >= 15% AND themeDiversity >= 5
//     borderline → atLevelPct >= 5%
//     grinder    → atLevelPct < 5%
//
// Read by puzzles.service.ts to modulate rating dynamics — grinders get
// stricter anti-inflation rules on top of the global delta cap.
// Runs nightly (or on-demand). Cheap: ~50 users, single-collection scan.

const now = new Date();
const MIN_ROUNDS = 20;

const cur = db.userperfs.find({ "puzzle.nb": { $gte: MIN_ROUNDS } });
let updated = 0;
while (cur.hasNext()) {
  const perf = cur.next();
  const uid = perf._id;
  const g = Math.round(perf.puzzle.gl.r);
  const all = db.rounds.find(
    { _id: { $regex: "^" + uid + ":" }, k: "puzzle" },
    { w: 1, ms: 1, pr: 1, sel: 1, d: 1 },
  ).sort({ d: -1 }).limit(200).toArray();
  if (all.length < MIN_ROUNDS) continue;
  const wins = all.filter(r => r.w).length;
  const atLvl = all.filter(r => r.w && r.pr && r.pr >= g - 100).length;
  const fast = all.filter(r => r.ms && r.ms < 3000).length;
  const themes = new Set(all.map(r => r.sel).filter(t => t && t !== "mix"));
  const diversity = themes.size;
  const atLvlPct = 100 * atLvl / all.length;
  // Recent same-theme streak (from the head — most recent solves)
  let streak = 0;
  const lastTheme = all[0]?.sel;
  if (lastTheme && lastTheme !== "mix") {
    for (const r of all) { if (r.sel === lastTheme) streak++; else break; }
  }
  const type = (atLvlPct >= 15 && diversity >= 5) ? "legitimate"
             : (atLvlPct >= 5)                     ? "borderline"
             :                                       "grinder";
  const solvePattern = {
    type,
    atLevelPct: Math.round(atLvlPct * 10) / 10,
    themeDiversity: diversity,
    fastSolves: fast,
    sameThemeStreak: streak,
    lastTheme: lastTheme || null,
    winPct: Math.round(100 * wins / all.length),
    lastComputed: now,
  };
  db.userperfs.updateOne({ _id: uid }, { $set: { "puzzle.solvePattern": solvePattern } });
  updated++;
}
print(`Updated solvePattern for ${updated} users.`);
