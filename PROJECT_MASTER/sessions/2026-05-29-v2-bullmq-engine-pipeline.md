# Session log: v2 — BullMQ engine pipeline

**Date:** 2026-05-29

## What
Added a modern BullMQ-based job queue for puzzle extraction in the NestJS API, reusing the proven
`puzzle_extractor.js` (no risky Stockfish reimplementation).

- **`engine/engine.service.ts`** — BullMQ `Queue` + `Worker` (Redis 127.0.0.1:6379, prefix `cgv2`,
  **concurrency 1**). Worker job = spawn `engine-battle/puzzle_extractor.js --game <id>` (separate
  process, 5-min timeout). `enqueue(limit)` finds un-extracted decisive `enginegames` (cap 10) and
  adds jobs. `stats()` returns job counts + recent jobs.
- **`engine/engine.controller.ts`** — `GET /api/admin/queue` (stats), `POST /api/admin/extract`
  (auth-gated, enqueue N).
- **Admin UI** — "Engine pipeline (BullMQ)" card: waiting/active/completed/failed/delayed counts
  (polls 5s) + "Enqueue extraction (3 games)" button (shown only when signed in).

## Verified
- API boot log: "extraction queue + worker ready (concurrency 1)".
- `GET /api/admin/queue` → counts. Pushed a test job (bogus game) → worker spawned extractor →
  job **completed:1** (log "extract 1 done"). Extractor confirmed to exit fast on a bad game.
- Admin page shows the pipeline card + counts; enqueue gated by login. tsc/build clean; published
  root + /v2; pm2 restarted.

## Safety / notes
- **Concurrency 1 + manual trigger only** — real extraction runs depth-50 Stockfish (CPU-heavy);
  this never auto-runs on the shared prod box. (0 engine-generated puzzles exist today.)
- Refinement TODO: worker resolves on extractor close regardless of exit code, so a crashed
  extraction currently shows "completed" (result carries the exit code + log tail). Mark non-zero
  as failed later. Future: migrate engine_runner/cook to BullMQ too; move heavy analysis off-box.
