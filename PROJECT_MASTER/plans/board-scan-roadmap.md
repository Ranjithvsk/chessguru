# Plan — board scan, ordered by leverage

_Written 2026-09-09 from measurements in `knowledge/18` and `knowledge/19`. Order matters:
each item below was ranked by evidence, not by how interesting it is to build._

## Done 2026-09-09

- **Scan moved off the API thread.** Both callers of the in-process DINOv2 route now use the
  out-of-process Ultra service. ~31s → ~3s, and a scan can no longer starve live classes.
- **Multi-board picker.** `/classify` returns `candidates[]` when a page holds several boards;
  the editor shows thumbnails and the coach taps the one they meant. Needed no API change — the
  NestJS proxy spreads the Python response verbatim, so only the :5100 service restarted.
- **Missing-king warning** instead of silently loading a wrong board.
- **Corner-adjuster guidance**: handles go inside the a-h / 1-8 labels.
- **Generator**: two-regime board scale, coordinate labels, orientation sidecar, book-recursive
  sampling, sharding.
- **All three retrain pipelines repaired** (see `sessions/2026-09-09-...`).

## Also done, later on 2026-09-09 (evening)

Multi-board picker; mask-based angle correction; chess-logic repair
(`chess_logic.py`, colour-balance rule); tier-3 extractor fallback; payload cut
14x; session required + nginx rate limit on all scan routes; correction capture
wired to Copy FEN with confidence-gated approval. Plus the day's worst bug: a
saved king-less FEN permanently white-screened an origin. See
`sessions/2026-09-09-scan-made-usable-and-safe.md`.

## Next, in order

### 1. Retrain the extractor on the corrected composites
Running as of 2026-09-09. ~36k composites sampled across 2,875 books, both scale regimes,
coordinates drawn. Fine-tunes from current best, adds to the existing 8,953-image set, exports
ONNX and **does not install** — validate against the current model on held-out data AND on the
TKT-166 photo before swapping. Expected to fix full-page and coordinate-adjacent scans.

### 2. Read orientation instead of guessing it
`service.py` already has `_detect_orientation_from_labels`, and the rotation is otherwise picked
by scoring all 4 rotations on classifier confidence — which is why `BoardEditor` still ships a
manual "Rotate 180°" button. The generator now emits orientation ground truth, so this can be
learned rather than heuristic. Verify the existing OCR path first; it may only need widening.

### 3. Point the trainers at the big pile
`progressive_train.py` and `classifier_train.py` still hardcode `E:\chess-diagrams`
(21,570 / 504 books) while `E:\ChessDiagramsExtracted` holds 405,170 across 2,887 books. Also
remove the "+500 new diagrams" gate, which can never be satisfied by an exhausted pile.

### 4. Classifier labels via easy-domain pseudo-labelling
Label clean PDF-cropped diagrams (where the model is ~99%), filter by chess legality, train on
degraded photo versions. See `knowledge/19` for why this differs from the self-labelling loop
that failed.

### 5. ChessVision as oracle — BLOCKED on an API key
Route, service method and controller all exist (`classify-board-chessvision`).
`CHESSVISION_API_KEY` is set nowhere, so it throws immediately. Per
`reference_chessvision_dev_api`: use as fallback when confidence is low or the position is
illegal, show both answers, let the coach pick. Their pick is legitimate training data.
**Never bulk-label through it** — ToS risk.

## Explicitly not doing

- **Another geometric auto-crop heuristic.** Three have failed on halftone book print
  (`knowledge/18`). The fix is data.
- **Gating anything on `warpQuality.parity`.** Measured non-discriminative.
- **Reviving the progressive loop.** Retired 2026-09-09: it could not progress, and it ran a
  blanket `taskkill /IM python.exe` on Vinayaka every cycle.
