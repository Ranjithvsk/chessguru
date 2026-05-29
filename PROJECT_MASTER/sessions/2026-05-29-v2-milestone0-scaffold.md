# Session log: v2 rewrite — Milestone 0 (scaffold)

**Date:** 2026-05-29 · dir: `v2/`

## What
Scaffolded the ChessGuru v2 monorepo (greenfield rewrite, approved). Files only — **no installs run
yet** (shared production VPS; installs/builds to be done carefully, watching memory).

## Structure
```
v2/
  package.json, pnpm-workspace.yaml, tsconfig.base.json, .gitignore, README.md
  packages/types/   shared FE↔BE types (Puzzle, Glicko, Difficulty, MeRating, …)
  apps/web/         React 18 + Vite + TS + Tailwind + chessground + chess.js + TanStack Query
    - colourful design system (brand indigo→violet→pink gradient, emerald/gold accents, dark,
      accessible contrast — fixes the old grey-on-black)
    - Navbar, Board (chessground wrapper), Puzzles page (full solve flow)
    - Vite proxies /api + /auth → existing Express :3000 so it shows REAL puzzles in Phase 0
  apps/api/         NestJS + TS skeleton: Mongoose(forRoot mongodb://…/chessguru) + /api/health
```

## Notable
- **Rating logic done right from the start** in `Puzzles.tsx`: deduct once per fail, **no award after
  a fail or hint** (avoids the bug we just fixed in the old app).
- Difficulty/theme changes fetch a fresh puzzle (no stale-puzzle bug).
- DB = MongoDB (confirmed by owner; mirrors Lichess; reuses existing data).

## Next (Milestone 1)
- Careful `pnpm install` (sequential, watch `free -h`); `pnpm dev:web` to verify the board renders
  against the live API; then `pnpm typecheck`.
- Build the NestJS API: auth, puzzle selection (rating/theme/piece + dedup), Glicko-2, me/rating,
  daily/streak/dashboard/history — repoint the web proxy to :4000.

## Plan
`PROJECT_MASTER/plans/rewrite-stack-decision.md` (APPROVED).
