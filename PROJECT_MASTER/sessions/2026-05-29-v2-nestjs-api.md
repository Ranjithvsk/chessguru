# Session log: v2 — NestJS API (Phase 1 core)

**Date:** 2026-05-29

## What
Built and verified the NestJS API (`v2/apps/api`) against the real MongoDB data.

- **Glicko-2** (`glicko/glicko.ts`) — faithful TS port of the original `glicko2.js` (constants frozen).
- **Puzzle format** (`lib/puzzle-format.ts`) — `fmtPuzzle` + `applyLastMove` (chess.js), matches the
  existing Express contract (first solution move → `lastMove`/`preFen`, solution sliced).
- **PuzzlesService** (raw Mongoose connection → real `puzzles`/`userperfs`/`rounds`): `random`
  (rating-band + quality-tier + theme + pieceCount, `$sample`, widen fallback), `byId`, `complete`
  (Glicko-2 update + persist perf/round; guest one-off).
- **Controllers:** `GET /api/themes`, `GET /api/me/rating` (guest), `GET /api/puzzles/random`,
  `GET /api/puzzles/:id`, `POST /api/puzzles/:id/complete`, `GET /auth/me` (guest), `GET /api/health`.
- Added `chess.js` to api deps.

## Verified (ran on :4000 against Mongo)
- `/api/health` → db connected. `/api/themes` → 68. `/api/puzzles/random` → real puzzle (#U4HPL,
  rating 1536) with correct lastMove/preFen/solution. `/api/puzzles/:id` 200. `complete` (guest):
  win +262 / loss −214 from d=500 (correct Glicko-2). `tsc --noEmit` clean; `nest build` clean.
- Server stopped after verification (not yet wired to /v2).

## NOT done yet (next milestones)
- **Auth/sessions** — v1 is guest-only (no register/signin); logged-in features still need the
  existing Express backend. Add bcrypt + express-session (Mongo store) to NestJS next.
- Run under **pm2** (e.g. dw-pos-style) + **cutover**: repoint /v2 `/api` to :4000 (nginx `/v2api`
  or VITE_API_BASE) — only after auth parity, so login isn't regressed.
- Port the richer pool/path selection (current is correct but simpler than the Express version).

## Why not repointed now
The existing Express backend has full auth; the v1 NestJS API is guest-only. Repointing /v2 to it
would regress login, so /v2 stays on the existing backend until NestJS reaches auth parity.
