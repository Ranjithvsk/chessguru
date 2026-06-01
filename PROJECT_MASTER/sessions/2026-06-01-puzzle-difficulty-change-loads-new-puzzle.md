# Session 2026-06-01 - Puzzle difficulty change loads new puzzle

## User report
On the live ChessGuru puzzle page, while on an Epaulette Mate puzzle, changing difficulty to Easy did not load a new puzzle.

## Root cause
`v2/apps/web/src/hooks/usePuzzleGame.ts` intentionally resumes the current unsolved puzzle from `localStorage.cg_puzzle` so refresh keeps the same puzzle. `Puzzles.tsx` cleared that key when the theme changed, but not when difficulty changed. The query key changed, but the query function still loaded the saved puzzle by id before asking `/api/puzzles/random`, so the old Epaulette Mate puzzle stayed on screen.

## Fix
`v2/apps/web/src/pages/Puzzles.tsx` now removes `cg_puzzle` before updating difficulty. That lets the existing query-key change request a fresh random puzzle for the selected difficulty.

## Verification
- `corepack pnpm --filter @chessguru/web run typecheck` passed.
- `bash v2/scripts/deploy.sh` built and published both `/` and `/v2`.
- Verified the published static bundle contains the new `localStorage.removeItem("cg_puzzle")` difficulty-change handler.

## Files touched
- `v2/apps/web/src/pages/Puzzles.tsx`
- `PROJECT_MASTER/sessions/2026-06-01-puzzle-difficulty-change-loads-new-puzzle.md`

## Open items
None.
