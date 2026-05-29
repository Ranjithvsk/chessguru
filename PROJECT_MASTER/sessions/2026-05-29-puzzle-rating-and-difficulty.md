# Session log: puzzle rating double-deduction + difficulty no-response

**Date:** 2026-05-29 · file: `public/index.html`

## Bugs reported
1. Rating was deducted on **every** wrong move (2nd wrong attempt deducted again). It should
   deduct only **once**; and once failed, solving the puzzle should award **no** rating.
2. Changing **Difficulty** did nothing.

## Root causes
1. `onMove` wrong branch did `if(!window._hintShown)submit(false)` on every wrong move (no
   once-only guard), and the solve branch always `submit(true,...)`. Also `_hintShown` was never
   reset per puzzle.
2. The Difficulty `<select>` called `loadNext()`, which reloads the puzzle id stored in
   `localStorage.cg_puzzle` (set by `showPuzzle`) — so it re-loaded the *same* puzzle and ignored
   the new difficulty.

## Fix
- Added a per-puzzle `window._failed` flag; reset `_failed` and `_hintShown` at the top of
  `showPuzzle()`.
- Wrong branch: `if(!_failed && !_hintShown){ submit(false); } _failed=true;` → deduct once only.
- Solve branch: `if(!_failed && !_hintShown){ submit(true); }` → no award if the puzzle was failed
  (or a hint was used).
- Difficulty `<select>` onchange: `loadNext()` → `loadNextClean()` (clears the stored puzzle and
  fetches a fresh one at the current difficulty).

## Verified (Playwright, instrumented fetch)
- 3 wrong moves → exactly **1** `win:false` submission (was 3).
- Solving after a fail → **0** `win:true` submissions.
- Difficulty change → 1 fresh `GET /puzzles/random?...&difficulty=hardest`.

## Notes
- Matches Lichess behaviour (first miss = fail, no points on eventual solve). Updates
  known-issues #14 (now fixed for index.html). `theme.html` already had the `_submittedFalse`
  guard for the deduction half; its difficulty dial uses a different control.

## Backup
`archive/public/index.html.bak-ratingfix-20260529-131723`.
