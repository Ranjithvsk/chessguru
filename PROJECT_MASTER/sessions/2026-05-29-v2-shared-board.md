# Session log: v2 — shared chess board component

**Date:** 2026-05-29 · file: `v2/apps/web/src/components/Board.tsx`

## What
Built out the single **shared** chessground board that every page reuses. One component, configured
by props — no per-page duplication, one board library (chessground), one chess.js.

## Capabilities (props)
`fen, orientation, turnColor, movableColor ("white"|"black"|"both"), dests, lastMove,
check (king highlight), viewOnly (Engine Battle spectator), coordinates, blindfold (hide pieces),
shapes (hint arrows / engine PV), onMove, onSelect, className`.
Plus a shared helper `destsFromChess(game)` to build legal-move dests from a chess.js instance.

## How pages will use the same board
- Puzzles / Theme: movableColor=player, dests, onMove (already wired).
- Blindfold: `blindfold` prop (CSS hides pieces; `.peek` reveals); added the CSS rule.
- Opening / Board Editor: free movement + shapes for engine PV.
- Engine Battle: `viewOnly` spectator.

Backward-compatible with the Puzzles page (same props + new optional ones) — nothing else changes.

## Not yet
- `pnpm install` + typecheck/run still pending (shared prod VPS — do carefully).
