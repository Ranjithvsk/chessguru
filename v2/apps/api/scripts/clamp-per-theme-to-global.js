// Second-pass migration: clamp per-theme ratings for corrected users so
// they don't exceed current global by more than +100. Without this, per-theme
// ratings above current global would drive the picker to serve puzzles
// ABOVE user's real level; wins on those trigger big Glicko gains that
// re-inflate global (owner report 2026-08-23 after seeing Deepak's mateIn1
// still at 2760 while global sits at 2446).
//
// Applies only to the 12 users whose global rating was corrected today.
// For each per-theme entry where per-theme.r > global + 100, reset to
// global + 100 (keep them slightly above global to preserve a small
// legitimate per-theme differential — some themes ARE genuinely stronger).
// nb + la + re untouched.

const DRY_RUN = process.env.DRY_RUN !== "false";
const OVERSHOOT_ALLOWED = 100;

const CORRECTED_USERS = new Set([
  "deepakcharanv", "yakshith", "mageswaran", "theerajkumarr", "harinitharanjith",
  "dakshavs", "rohitcharan", "ashwanth", "janvi-2", "mohammedaffan", "pranavs", "akshita",
]);

async function clamp() {
  print(`Mode: ${DRY_RUN ? "DRY RUN" : "APPLY"}`);
  print("");
  let touched = 0;
  const summary = [];
  for (const uid of CORRECTED_USERS) {
    const perf = db.userperfs.findOne({ _id: uid });
    if (!perf?.puzzle?.gl?.r) continue;
    const global = Math.round(perf.puzzle.gl.r);
    const cap = global + OVERSHOOT_ALLOWED;
    const themes = perf.themes || {};
    const sets = {};
    for (const [t, tp] of Object.entries(themes)) {
      const r = Math.round(tp?.gl?.r || 0);
      if (r <= cap) continue;
      sets[`themes.${t}.gl`] = { r: cap, d: Math.max(150, tp.gl.d || 200), v: tp.gl.v || 0.09 };
      summary.push({ uid, theme: t, was: r, now: cap, nb: tp.nb || 0 });
      touched++;
    }
    if (!DRY_RUN && Object.keys(sets).length) {
      db.userperfs.updateOne({ _id: uid }, { $set: sets });
    }
  }
  summary.sort((a, b) => b.was - a.was);
  print(`${DRY_RUN ? "Would clamp" : "Clamped"} ${touched} per-theme entries:`);
  print("");
  print(`${"user".padEnd(20)} ${"theme".padEnd(18)} was → now  (nb)`);
  for (const s of summary) {
    print(`  ${s.uid.padEnd(18)} ${s.theme.padEnd(18)} ${String(s.was).padStart(4)} → ${String(s.now).padStart(4)}  (${s.nb})`);
  }
}
clamp();
