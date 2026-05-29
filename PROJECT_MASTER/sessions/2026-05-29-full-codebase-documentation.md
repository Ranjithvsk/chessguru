# Session log: Full codebase read & documentation

**Date:** 2026-05-29

## What was done
A complete, code-accurate read of the entire ChessGuru codebase (~30 source files + vendored libs)
and a full rewrite/expansion of the `PROJECT_MASTER/` docs hub. Read with `sudo` as the files are
owned by the `ubuntu` user. No source code was modified.

## Docs produced/updated
- `knowledge/00-architecture-overview.md` — 1-page system map + the core flows
- `knowledge/04-backend-deep-dive.md` — server3 boot, routes.js selection algorithm, glicko2 math,
  schemas, auth
- `knowledge/05-engine-pipeline.md` — engine_runner/updater, the Stockfish extractor algorithm,
  cook.js themes, engines.json + on-disk binaries
- `knowledge/06-frontend.md` — every page (gameplay + admin/tools) and its client flow
- `knowledge/07-pools-and-maintenance-scripts.md` — the pools concept + every one-off script
- `knowledge/08-api-reference.md` — complete endpoint reference (incl. :3002 runner)
- `knowledge/09-links-libraries-resources.md` — URLs, libs, external services, upstream Lichess ports
- `knowledge/10-known-issues-and-risks.md` — consolidated bug/security register
- `decisions/ADR-0007-precomputed-pools.md`
- rewrote `database/schema.md` (pools + the puzzle field-vocabulary divergence)
- rebuilt `INDEX.md`

## Headline findings (full list in 10-known-issues)
- 🔴 A **committed live Lichess API token** in `book_game_runner.js` — should be revoked/rotated.
- 🔴 **Unauthenticated** extractor-control endpoints that **run shell commands** and **delete
  puzzles**; admin pages served without auth.
- 🔴 Stored **XSS** on the admin dashboards; hardcoded session secret; wide-open CORS + no CSRF.
- 🟠 Extractor silently drops `source`/`status` (no real review gate) and has a likely FEN/solution
  alignment bug — generated puzzles should be spot-checked.
- 🟠 Engine runner dedupe collapses the Stockfish Elo ladders; Maia is non-functional (no `lc0`).
- 🟡 `cook.clearance` is a stub that tags ~every puzzle; several mate-pattern detectors are
  presence-only.

## Method
Five parallel reader agents (backend, engine pipeline, gameplay frontend, admin frontend,
scripts/ops), each doing a full code read and returning line-referenced notes; synthesized here.

## Verified
App health unaffected throughout: `localhost:3000/api/health` → 200, PM2 `chessguru` still online.
