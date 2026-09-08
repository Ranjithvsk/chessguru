# Plan: Fair Play Trainer — anti-cheat model + Suspicious solving panel

**Status:** PROPOSED 2026-09-08 (Phase 0 LIVE the same day). Owner: *"anti cheating in puzzle
trainer model, suspicious solve panel, let's design briefly, and plan"*. Shareable page:
https://claude.ai/code/artifacts (Fair Play Trainer) — this file is the repo copy.

## The case
mageswaran (guna): 1314 → 3043 in 19 days; 91% wins at 9.8 s median on 2500–2800 puzzles
(deepakcharanv 67%/26 s, akshayprathab 63%/32 s, coach gunachess 32%/46 s); 2600+ wins in
2.6–3.8 s with 1.2–1.3 s between every move. Old detector fired 0 times (only looked ≥300 above
the player). See sessions/2026-09-08-play-games-history.md.

## Live today (Phase 0)
Rating-independent flags (`assessSuspicion`: fast_hard, metronome, streak, fast_above_level);
flagged wins move no rating; Suspicious solving panel (`/academy/performance`, compact on
`/academy`); owner reset with `ratingAdjustments` audit; Master Games keeps the floor.

## Model — eight signals → trust score 0–100 (rolling 30 d, z-scored against the academy's
honest strong players)
1. Hard-puzzle speed floor (live) 2. Move rhythm / metronome (live) 3. Crowd baseline: per-puzzle
typical solve time, nightly (P1) 4. Accuracy-vs-difficulty curve (P1) 5. Focus loss between load
and first move — client telemetry (P1) 6. Sessions & streaks (P1) 7. Theme flatness (P2) 8. Play
rating cross-check (P2).
Bands: Clear <25 nothing · Watch 25–60 listed, flagged solves unrated, student told nothing ·
Review ≥60 owner notified same day, rated gains held until a coach clears/resets.

## Panel v2
List as today + per-student drawer: speed-vs-difficulty scatter (flagged dots), rhythm strip,
session timeline, actions (Review solve, Clear with note, Hold gains, Reset, Message — all
audited), Monday digest email to the owner.

## Principles
Speed alone is never punished (thresholds calibrated on local honest strong players); the student
is not told which solve was flagged; every action audited; coaches decide, the system only holds.

## Phases
- **P0 done 8 Sep** — check: 2.5 s win on a 2550 by a 1600 player → 3 flags, rating unchanged.
- **P1 ~2 days** — nightly baselines, crowd + accuracy + focus signals, trust score + bands, drawer,
  Monday digest. Check: replayed over August the case reaches Review by day 4; deepakcharanv,
  akshayprathab, coach stay Clear.
- **P2 ~2 days** — coach actions, theme-flatness + play cross-check, proctored homework/exams.
- **P3 after a month** — coach decisions as labels → fitted model replaces hand weights; monthly
  fairness report. Target: <1 false alarm / 500 solves on cleared students; median time-to-Review
  <24 h.

## Decisions for the owner
Tell the student when gains are held? · Coaches allowed to reset own roster? · Review threshold 60?

---

## Status — Phase 1 BUILT & LIVE 2026-09-08

Owner decisions: students never told · reset owner-only · Review at 60. Built exactly as scoped with two tuning changes found by the replay over August: **drills don't count** (one-move puzzles never flag; mate-theme drills get 2 s limits and are left out of the speed/accuracy components — ashwanth and haritha were false positives without this) and **one stray flag a month is forgiven**. Backtest: mageswaran reaches Review on the first assisted day (28 Aug, score 62 → 100); deepakcharanv, akshayprathab, gunachess, ashwanth, haritha all Clear. Details: `sessions/2026-09-08-play-games-history.md` ("Fair Play Trainer — Phase 1"). Code: `apps/api/src/fairplay/`, `glicko.ts assessSuspicion`, `AcademySuspiciousPanel.tsx`, scripts `fairplay-backtest.ts` / `fairplay-nightly.ts`.
