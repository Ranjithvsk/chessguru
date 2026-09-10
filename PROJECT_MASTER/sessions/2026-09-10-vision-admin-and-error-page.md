# 2026-09-10 — /admin/errors triage, three fixes, and a Vision engines admin module

## What
1. **/admin/errors looked alarming; 79% of it was slow-request logs.** 868 rows/week: 689 "slow" (>5 s), 114 server, 63 client.
2. **Slow endpoint** `POST /api/parent-reports/mistakes-self` (320 rows): puzzle lookup used
   `$or: [{puzzleId:{$in}}, {_id:{$in}}]`; no puzzle has `puzzleId`, so the planner did a COLLSCAN of
   6,058,405 docs per call (10.3 s). Now `_id` only → 33 docs, 2 ms. Same fix at the academy-mistakes site.
3. **BigInt crash in class-v2** (8 rows, 3 users in one live class): the class board editor stamped the
   inherited castling field ("KQkq") onto any drawn position. King on h1 + "K" right ⇒ chess.js emits a
   phantom castling move off-board ⇒ `_hash ^= undefined`. Reproduced (39 vs 38 moves). Added
   `castlingFor()`/`normalizeCastling()` in `SharedClassBoard.tsx`; builder derives rights, `applyFen` normalises.
4. **Book-host errors** (105 rows) = one 9-minute window 15:32–15:41 UTC; host answers in 0.6 s now. Root
   cause is the Vinayaka tunnel far end (laptop sleep). Recorder now coalesces repeats of a signature within
   10 min into one row with `n`; admin aggregates sum `n`.
5. Reporter drops chess.js "Invalid FEN" on `/board-editor` and `/class-v2` (user mid-edit, not a fault).
6. tsc strict: fixed AchievementsGallery (type now carries `kind`/`n`) and HomeworkPendingBanner (index guard).
   **`tsc -b` is still red on 89 errors across 18 files** — deploys run vite only. Separate decision.
7. **New: Vision engines admin module** (`/admin/vision`, `GET /api/admin/vision/{status,review}`,
   `POST .../review/:id/{approve,reject}`). Shows service health, model weights + mtimes, scans/day (from
   `/var/lib/chessguru/vision-log`), corrections/day (`visionRefs`), corner labels, nightly retrain history
   (parsed from `~/logs/chess-vision-retrain.log`), approved samples by class, and a **review queue** of
   corrections the model was ≥90% confident about (stored `approved:false` by `recordCorrection`, never trained
   on until a human approves). Approving is the mechanism that moves accuracy.

## Why (the 95% → 100% question)
- Nightly retrain runs, but `visionRefs` had no new training sample from 11 Aug until the 9 Sep capture fix; val_acc flat 98.03–98.26%.
- "95%" was two test diagrams on 11 Aug; there is no production accuracy metric. The module's scans-vs-corrections is the first one.
- Confident-wrong corrections are the highest-value samples and were invisible. The queue makes them reviewable.

## Files
- `v2/apps/api/src/parent-reports/parent-reports.service.ts`, `errors/error-alerts.service.ts`, `errors/errors.controller.ts`
- `v2/apps/api/src/vision/vision-admin.controller.ts` (new), `app.module.ts`
- `v2/apps/web/src/components/SharedClassBoard.tsx`, `lib/report-error.ts`, `components/AchievementsGallery.tsx`, `components/HomeworkPendingBanner.tsx`
- `v2/apps/web/src/pages/AdminVision.tsx` (new), `AppRest.tsx`, `components/Navbar.tsx`

## Verification
- explain(): puzzles lookup 6,058,405→33 docs examined, 10,337→2 ms.
- chess.js 1.4.0 node harness: class position 39→38 moves; 6 castling cases pass.
- API + web typecheck clean on touched files; deployed (web via scripts/deploy.sh; API `pnpm build` + pm2 restart as ubuntu).

## Open
- 89 remaining `tsc -b` errors (Navbar, OpeningExplorer, AcademyPublic, CoachEdit, …).
- Retrain log has no dates; module dates runs from model mtimes. Consider `date` prefix in `chess-vision-retrain.sh`.
- Vinayaka sleep keeps taking the book host offline; nothing in code fixes that.

## Addendum (same day)
- Every classified board now writes a `visionScans` record (id, fen, avg/min conf, weak squares, warnings); corrections carry `scanId`, so scans split into "accepted as read" vs "edited". `GET /api/admin/vision/analytics` + an Analytics section on /admin/vision: positions scanned (7d/30d/all), correct %, squares corrected, square accuracy, confidence, books from the book host (187 books, 43,549 pages, 67,847 diagrams), reader fixes on locally served books, confusion list. History before 2026-09-10 is labelled as pre-instrumentation.

## Addendum 2 (same day) — the seven suggestions, built
1. `POST /api/vision/scan/:id/accept` + "✓ Position is correct" button in BoardEditor (weak-square count recorded).
2. Confirm label names the uncertain-square count; rings already mark them.
3. `visionSettings.autoApproveBelow` (default 0.9) read by recordCorrection (60 s cache); admin GET/POST settings + human approval stats on the page.
4. `/opt/chessguru-vision/benchmark.py` scores the live service on `visionBenchmark` (seeded: 10 reader-verified pandolfini diagrams) → `visionBenchmarkRuns`; hooked into chess-vision-retrain.sh after the model install; trend on the page.
5. Per-book accuracy table from `/var/lib/chessguru/user-books/*/diagrams.json`.
6. Retrain runs now dated on the page (log already had "retrain started <iso>").
7. `VisionStallService`: daily check (no approved correction in 7 d, or served ONNX unchanged) → email ERROR_ALERT_TO, max one per 3 days.
