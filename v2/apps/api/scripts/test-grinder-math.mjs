import { updatePuzzleRating, DEFAULT_VOLATILITY } from "../dist/glicko/glicko.js";

function simulate(userR, userD, puzzleR, puzzleD, theme, winRate, N) {
  let perf = { gl: { r: userR, d: userD, v: DEFAULT_VOLATILITY }, nb: 100, re: [], la: null };
  const puzzle = { r: puzzleR, d: puzzleD, v: DEFAULT_VOLATILITY };
  let wins = 0, losses = 0;
  const deltas = [];
  for (let i = 0; i < N; i++) {
    const shouldWin = (i / N) < winRate;
    const res = updatePuzzleRating(perf, puzzle, shouldWin, theme);
    if (shouldWin) wins++; else losses++;
    deltas.push(res.ratingDiff);
    perf = res.userPerf;
  }
  const netDelta = perf.gl.r - userR;
  const avgWin = deltas.filter((d, i) => (i / N) < winRate).reduce((a, b) => a + b, 0) / (wins || 1);
  const avgLoss = deltas.filter((d, i) => (i / N) >= winRate).reduce((a, b) => a + b, 0) / (losses || 1);
  return { startR: userR, endR: Math.round(perf.gl.r), netDelta, wins, losses, avgWin, avgLoss };
}

const cases = [
  { theme: null,       label: "mix (no filter, 1.0)"        },
  { theme: "mateIn1",  label: "mateIn1 (obvious 0.10)"      },
  { theme: "backRankMate", label: "backRankMate (obvious)"  },
  { theme: "mateIn2",  label: "mateIn2 (hinting 0.20)"      },
  { theme: "mateIn3",  label: "mateIn3 (hinting 0.20)"      },
  { theme: "mateIn4",  label: "mateIn4 (hinting 0.20)"      },
  { theme: "mateIn5",  label: "mateIn5 (hinting 0.20)"      },
  { theme: "fork",     label: "fork (hinting 0.20)"         },
  { theme: "endgame",  label: "endgame (neutral 0.70)"      },
];

console.log("\n=== GRINDING 100 PUZZLES — 1500 user, 90% wins, at-level ===");
console.log("Theme".padEnd(28) + "W/L".padStart(8) + "  EndR".padStart(7) + "  Δrat".padStart(7) + "  avgW".padStart(7) + "  avgL".padStart(7));
for (const c of cases) {
  const r = simulate(1500, 80, 1500, 80, c.theme, 0.90, 100);
  console.log(c.label.padEnd(28) + (r.wins+"/"+r.losses).padStart(8) + String(r.endR).padStart(7) + (r.netDelta >= 0 ? "+"+r.netDelta : String(r.netDelta)).padStart(7) + r.avgWin.toFixed(1).padStart(7) + r.avgLoss.toFixed(1).padStart(7));
}

console.log("\n=== EXTREME GRINDER — 1500 user, 99% wins over 200 solves ===");
console.log("Theme".padEnd(28) + "W/L".padStart(10) + "  EndR".padStart(7) + "  Δrat".padStart(7));
for (const c of cases) {
  const r = simulate(1500, 80, 1500, 80, c.theme, 0.99, 200);
  console.log(c.label.padEnd(28) + (r.wins+"/"+r.losses).padStart(10) + String(r.endR).padStart(7) + (r.netDelta >= 0 ? "+"+r.netDelta : String(r.netDelta)).padStart(7));
}

console.log("\n=== REALISTIC GRINDER — 1500 user picks 1400 puzzles, 85% wins ===");
console.log("Theme".padEnd(28) + "W/L".padStart(8) + "  EndR".padStart(7) + "  Δrat".padStart(7));
for (const c of cases) {
  const r = simulate(1500, 80, 1400, 80, c.theme, 0.85, 100);
  console.log(c.label.padEnd(28) + (r.wins+"/"+r.losses).padStart(8) + String(r.endR).padStart(7) + (r.netDelta >= 0 ? "+"+r.netDelta : String(r.netDelta)).padStart(7));
}

console.log("\n=== HEALTHY LEARNER — 1500 user, 60% wins on AT-LEVEL puzzles ===");
console.log("Theme".padEnd(28) + "W/L".padStart(8) + "  EndR".padStart(7) + "  Δrat".padStart(7));
for (const c of cases) {
  const r = simulate(1500, 80, 1500, 80, c.theme, 0.60, 100);
  console.log(c.label.padEnd(28) + (r.wins+"/"+r.losses).padStart(8) + String(r.endR).padStart(7) + (r.netDelta >= 0 ? "+"+r.netDelta : String(r.netDelta)).padStart(7));
}
console.log();
