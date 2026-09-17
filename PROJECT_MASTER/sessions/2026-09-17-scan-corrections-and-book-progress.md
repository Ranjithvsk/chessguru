# 2026-09-17 — Scan corrections, book confidence, reader progress

Three things, all starting from "why is the scan wrong" and ending somewhere else.

## 1. The scan correction loop was dead

The correction panel renders only when `visionSnapshot && lastScanIdRef.current` are
both set, and **both were set exclusively inside `runServerClassifyOnCanvas`** — the
retired v2 path, unreachable because it requires `visionSnapshot` to already be set.
Nothing set it. Rollup stripped the function as dead code, the live `runUltraScan` set
neither value, the panel never rendered for anyone, and every scan logged
`corrections: 0`. `finetune_from_corrections.py` had no input, which is why the
classifier never improved on the squares it keeps missing.

Then a second bug behind it: `applyEditor` compared piece TYPE only, and the snapshot
stored only the uppercased type. A white piece corrected to black gave `"P" === "P"`
and was skipped — so the **largest** confusable-error class (18.5% of wrong squares,
"shadowed white read as black") was the one class that could never be recorded.

Both fixed in `BoardEditor.tsx`. Verified live: flipping a2 white→black produced
"Shared 1 correction", a `visionRefs` row (`piece=P color=b`, carrying the scanId), and
`corrections: 1`. The deliberately-false test row was deleted afterwards.

**Diagnostic worth keeping:** if a source edit does not change the emitted chunk hash,
the code you edited is not reachable. Faster than grepping minified output, where
identifiers are renamed and only string literals survive.

## 2. Book diagrams: keep the doubt, not the average

Owner asked how a "?" glyph scores 0.97. It does not — that is `avgConfidence`, the
mean over 64 squares. Page 19's three "x" key-square marks scored 0.531 / 0.768 /
0.368 individually; the board averaged 0.952. The live scanner keeps per-square
confidence; `book_ingest` stored only the mean, discarding the signal.

This also explains BookReader's own note that the old amber flag "caught 0 of 6 wrong
diagrams" — it read `modelConf`, the average. A mean cannot point at an outlier.

Shipped: `book_ingest._conf_detail()` stores `minConf` + `squaresBelow`;
`backfill_conf.py` adds them to already-ingested books (~90s vs a 28-min re-ingest,
**run as ubuntu**); BookReader's amber ring keys off the worst square.

See `knowledge/scan-position-speed-vs-accuracy.md` for the numbers, the coverage
limits, and the two speed changes that this session's harness REJECTED.

## 3. Books reopen where you left off

`useState(0)` and no persistence: every open started at page 1. And `page` only moved
when you clicked a diagram or a contents entry, so scrolling would not have counted
even with a save.

- `GET /api/user-books/:id` returns `lastPage`; `POST :id/progress` saves it.
- Stored at `STORE/_progress/<user>.json` — OUTSIDE the book dirs, because a book dir
  is the book and is shared by everyone who can open it, while "which page was I on"
  belongs to one person. Also works for remote books, which have no local dir, and
  survives a re-ingest rewriting the book.
- An IntersectionObserver tracks the page actually on screen, so plain scrolling counts.
- Restore is instant, not smooth: a smooth scroll across 300 pages is a long animation
  and the observer would record every page it flies past.

Verified: save 137 → reopen 137; save 9999 → clamped to 399; `"abc"` → 400; another
user gets 404. In the browser as gunachess: scrolled (not clicked) to page 73,
reloaded, came back at page 73.

## Files

- `v2/apps/web/src/pages/BoardEditor.tsx` — correction loop, colour capture, non-blocking archive upload
- `v2/apps/web/src/pages/BookReader.tsx` — resume, scroll tracking, worst-square flag
- `v2/apps/api/src/user-books/user-books.controller.ts` — `lastPage` + `POST :id/progress`
- Untracked, on the vision box: `book_ingest.py`, `accuracy_check.py`, `backfill_conf.py`

## Open

- **`/opt/chessguru-vision` is not under version control** — weights, service.py, and
  this session's harness and backfill all live there untracked.
- A 14th "marker" class + retrain is the only thing that fixes "?" and "x" at source;
  per-square confidence is the general defence until then.
- Page 29's two diagrams are still wrong on disk (the "?" marks read as a rook and
  pawns); they are now flagged amber but not corrected.
