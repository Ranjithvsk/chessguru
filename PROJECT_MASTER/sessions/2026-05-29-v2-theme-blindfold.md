# Session log: v2 — Theme + Blindfold pages (shared hook)

**Date:** 2026-05-29

## What
Built the Theme and Blindfold pages and refactored Puzzles to share logic.

- **`hooks/usePuzzleGame.ts`** — shared solving engine (fetch, chess state, move validation,
  hint shapes, view-solution, rating with deduct-once / no-award-after-fail). Reused by all three
  pages. Exposes `onMove`, `tryInput` (SAN/UCI text), `showHint`, `viewSolution`, `next`, + state.
- **`pages/Puzzles.tsx`** — refactored to consume the hook (same UI).
- **`pages/Theme.tsx`** — colourful motif chips (fork/pin/mate…) + dropdown; drills the chosen theme.
- **`pages/Blindfold.tsx`** — shared Board with `blindfold` (pieces hidden) + hold-to-`peek`,
  type-a-move input (SAN/UCI via `tryInput`), live White/Black piece lists from FEN, max-pieces
  slider (maxPc), separate blindfold rating; announces the opponent's move.
- `lib/format.ts` (prettify), `lib/api.ts` (randomPuzzle opts + complete mode/rating), routes +
  nav updated (Puzzles / Themes / Blindfold).

## Verified
- `tsc --noEmit` clean (exit 0). `vite build` ok. Published to /var/www/chessguru-v2.
- Browser @ https://harinitharanjith.com/v2/{theme,blindfold}: both render real puzzles on the
  shared board; Theme chips work; Blindfold hides pieces, shows piece lists + opponent move. ✅

## Next
- Opening explorer + Engine Battle + Board Editor pages; then the NestJS API (Phase 1) + login.
