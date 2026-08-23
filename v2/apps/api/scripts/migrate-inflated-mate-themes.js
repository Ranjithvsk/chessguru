// Surgical migration: reset per-theme puzzle ratings that ballooned above
// the user's global due to the 1500/d=500 fresh-start bug (fixed 2026-08-23
// commit 986132f). Targets ONLY mate-pattern / forcing-sequence themes
// where puzzle Glicko systematically overstates difficulty for skilled
// players. Non-mate themes (fork, pin, sacrifice, etc.) require real
// tactical judgment so their inflated ratings might reflect genuine
// theme-specific strength — those we leave alone.
//
// Reset criteria:
//   1. theme is in FORCING_SEQUENCE_THEMES
//   2. per-theme rating > global rating + 250
//   3. nb < 50  (else assume entrenched — user has played this enough
//                that even inflated rating reflects consistent performance)
//
// Reset action:
//   r = user's global rating  (fresh estimate matching their actual skill)
//   d = 200                    (moderate certainty — some prior signal)
//   nb, la, re kept            (preserves solve history + last-seen)
//
// Runs as DRY_RUN=true (print only) by default. Set DRY_RUN=false to apply.

const DRY_RUN = process.env.DRY_RUN !== "false";

const FORCING_SEQUENCE_THEMES = new Set([
  // All mate-in-N are forced by definition
  "mateIn1", "mateIn2", "mateIn3", "mateIn4", "mateIn5",
  // Named mate patterns — first move is usually a check/sacrifice with
  // only one legal continuation → forcing sequence
  "backRankMate", "smotheredMate", "epauletteMate", "doubleBishopMate",
  "arabianMate", "anastasiaMate", "blindSwineMate", "hookMate",
  "operaMate", "bodenMate", "morphysMate", "killBoxMate",
  "swallowstailMate", "vukovicMate", "pillsburysMate", "triangleMate",
  "dovetailMate",
  // xRayAttack — often reduces to "find the pin/skewer along the line" (forcing)
  "xRayAttack",
]);

const THRESHOLD_DELTA = 250;
const THRESHOLD_MAX_NB = 50;

async function migrate() {
  const coll = db.getCollection("userperfs");
  const users = await coll.find({ themes: { $exists: true } }).toArray();
  print(`Scanned ${users.length} users with theme data.`);
  print(`Mode: ${DRY_RUN ? "DRY RUN (no writes)" : "APPLY (writing)"}`);
  print("");

  let entriesReset = 0;
  let usersAffected = 0;
  const perUser = new Map();

  for (const u of users) {
    const globalR = Math.round((u.puzzle && u.puzzle.gl && u.puzzle.gl.r) || 1500);
    const themes = u.themes || {};
    const setOps = {};
    let touched = 0;

    for (const [t, p] of Object.entries(themes)) {
      if (!FORCING_SEQUENCE_THEMES.has(t)) continue;
      const nb = p.nb || 0;
      const r = Math.round((p.gl && p.gl.r) || 0);
      const d = Math.round((p.gl && p.gl.d) || 500);
      const delta = r - globalR;
      if (delta <= THRESHOLD_DELTA) continue;
      if (nb >= THRESHOLD_MAX_NB) continue;

      // Reset
      const newRating = { r: globalR, d: 200, v: (p.gl && p.gl.v) || 0.09 };
      setOps[`themes.${t}.gl`] = newRating;
      touched++;
      entriesReset++;

      const prior = perUser.get(u._id) || [];
      prior.push({ theme: t, before: `r=${r} d=${d} nb=${nb}`, after: `r=${globalR} d=200 nb=${nb}`, delta });
      perUser.set(u._id, prior);
    }

    if (touched > 0) {
      usersAffected++;
      if (!DRY_RUN) {
        await coll.updateOne({ _id: u._id }, { $set: setOps });
      }
    }
  }

  print(`Users affected: ${usersAffected}`);
  print(`Theme entries reset: ${entriesReset}`);
  print("");
  print("=== Per-user detail (top 20 by biggest reset) ===");
  const flat = [];
  for (const [uid, resets] of perUser.entries()) {
    for (const r of resets) flat.push({ uid, ...r });
  }
  flat.sort((a, b) => b.delta - a.delta);
  for (const r of flat.slice(0, 30)) {
    print(`  ${r.uid.padEnd(18)} ${r.theme.padEnd(20)} was: ${r.before.padEnd(24)} → ${r.after}   (delta was +${r.delta})`);
  }
  print("");
  print(`${DRY_RUN ? "Would reset" : "Reset"} ${entriesReset} per-theme entries for ${usersAffected} users.`);
}

migrate();
