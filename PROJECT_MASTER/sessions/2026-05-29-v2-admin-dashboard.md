# Session log: v2 — Admin / Puzzle Factory dashboard

**Date:** 2026-05-29

## What
Rebuilt the admin "Puzzle Factory" as a live analytics dashboard (the last major area).

- **NestJS** `admin/admin.service.ts` + `admin.controller.ts`:
  - `GET /api/status/overview` — total puzzles, engine-generated, verified, engine games, pools
    (bf/piece/paths), users. Cached 60s.
  - `GET /api/status/distribution` — theme + rating distributions from a **$sample(4000)** (cheap,
    cached 5min — avoids unwinding 5.88M docs).
  - `GET /api/generated/{puzzles,stats}` + `POST .../approve|reject` (auth-gated via session).
- **Web** `pages/Admin.tsx` (`/v2/admin`, nav "Factory"): colourful stat cards + theme/rating bar
  charts + engine-generated review queue. `lib/api.ts` admin methods; route + nav added.

## Real data shown (honest)
total 5,882,680 · engineGenerated **0** (the engine pipeline hasn't persisted any; all puzzles are
the imported Lichess set) · engineGames 245 · pools 13443/590/4299 · users 4. Theme dist: Short
2015, Endgame 1980, Middlegame 1810, … Rating dist bucketed.

## Verified
tsc clean; vite build clean; published. NestJS rebuilt + `pm2 restart chessguru-v2-api`.
`/api/status/overview` + `/distribution` return real data; /v2/admin renders all charts. ✅

## Notes
- Heavy aggregations avoided: indexed `sourceGameId` count + `$sample` for distributions + caching,
  so the shared Mongo (also serving the old site) isn't strained.
- Old shell-exec extractor controls intentionally NOT replicated (security); the engine pipeline
  belongs on BullMQ in a later phase.

## v2 rebuild status
All major areas rebuilt: 6 player/tool pages, login/auth, NestJS API (cutover done, /v2 on /v2api),
admin dashboard. Remaining polish: BullMQ engine pipeline, richer pool/path selection port, then
final /v2 → / flip.
