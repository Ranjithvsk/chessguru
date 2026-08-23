// Nightly gradual correction of inflated puzzle ratings. Runs once per day
// via cron. For each affected user, reduces their global puzzle rating by
// a small amount toward a "sustainable rating" computed from actual solve
// performance — until they converge naturally.
//
// Why gradual: dropping a user's rating from 2809 to 2450 overnight would
// alarm them ("what happened to my rating?"). Reducing by 15 pts/day means
// a 400-pt inflation corrects in ~4 weeks, matches natural Glicko cadence,
// and users see the trend as "adjustment from harder puzzles now being
// served" rather than "somebody nerfed me."
//
// Companion to the fixes shipped 2026-08-23 (commit 986132f + delta cap +
// picker floor). Those prevent NEW inflation; this script rolls back the
// existing damage.
//
// Runs: DRY_RUN=true|false mongosh chessguru --quiet gradual-rating-correction.js

const DRY_RUN = process.env.DRY_RUN !== "false";
// MAX_DAILY_DROP is normally 15 pts/day (gentle). Override to a big value
// (e.g. 9999) for a one-shot full correction — puts everyone on target
// immediately. Owner used FULL=true after seeing 12 users flagged 2026-08-23.
const MAX_DAILY_DROP = parseInt(process.env.MAX_DAILY_DROP || "15", 10);
const GAP_THRESHOLD = 50;          // stop when within this of target
const MIN_ROUNDS_FOR_TARGET = 30;  // need this many solves to estimate sustainable rating

function sustainableRating(userId, currentR) {
  // Compute the median puzzle rating from the user's last 60 solves.
  // If they've been winning consistently on puzzles rated ~X, X is their
  // "sustainable" level. Losses count more: puzzle rating on a LOSS is a
  // ceiling signal ("this is where they start failing").
  const rounds = db.rounds.find(
    { _id: { $regex: "^" + userId + ":" }, k: "puzzle", pr: { $exists: true } },
    { pr: 1, w: 1 }
  ).sort({ d: -1 }).limit(60).toArray();
  if (rounds.length < MIN_ROUNDS_FOR_TARGET) return null;

  // For each solve, adjusted "signal rating":
  //   - Win: puzzle rating is a floor (they CAN solve at this level)
  //   - Loss: puzzle rating is a ceiling (they FAIL at this level)
  // Sustainable = median of losses (or median of wins - 100 if no losses).
  const losses = rounds.filter(r => !r.w).map(r => r.pr).sort((a,b) => a-b);
  const wins = rounds.filter(r => r.w).map(r => r.pr).sort((a,b) => a-b);
  let target;
  if (losses.length >= 3) {
    // median of losses = their real ceiling
    target = losses[Math.floor(losses.length / 2)];
  } else if (wins.length >= 10) {
    // rare: user rarely loses — use median-of-wins as floor, no upward adjustment
    target = wins[Math.floor(wins.length / 2)];
  } else {
    return null;
  }
  return target;
}

async function correct() {
  const users = db.userperfs.find({ "puzzle.nb": { $gte: MIN_ROUNDS_FOR_TARGET } }).toArray();
  print(`Scanned ${users.length} users with >=${MIN_ROUNDS_FOR_TARGET} solves.`);
  print(`Mode: ${DRY_RUN ? "DRY RUN (no writes)" : "APPLY (writing)"}`);
  print("");

  let corrected = 0;
  const changes = [];
  for (const u of users) {
    const currentR = Math.round(u.puzzle.gl.r);
    const target = sustainableRating(u._id, currentR);
    if (target == null) continue;
    if (currentR <= target + GAP_THRESHOLD) continue;  // already close enough

    const gap = currentR - target;
    // Normal cron: gentle drop = gap/15 or the cap, whichever is smaller.
    // Full mode (MAX_DAILY_DROP >= 500 or FULL=true): drop = full gap.
    const drop = (MAX_DAILY_DROP >= 500 || process.env.FULL === "true")
      ? gap
      : Math.min(MAX_DAILY_DROP, Math.max(1, Math.round(gap / 15)));
    const newR = currentR - drop;

    changes.push({ uid: u._id, was: currentR, target, drop, newR, gap });

    if (!DRY_RUN) {
      db.userperfs.updateOne(
        { _id: u._id },
        { $set: { "puzzle.gl.r": newR } }
      );
    }
    corrected++;
  }

  changes.sort((a, b) => b.gap - a.gap);
  print(`${DRY_RUN ? "Would reduce" : "Reduced"} ${corrected} users.`);
  print("");
  print(`${"user".padEnd(20)} was → new  (target, gap, drop)`);
  print("-".repeat(70));
  for (const c of changes.slice(0, 40)) {
    print(`  ${c.uid.padEnd(18)} ${String(c.was).padStart(4)} → ${String(c.newR).padStart(4)}  (target=${c.target}, gap=${c.gap}, drop=${c.drop})`);
  }
}

correct();
