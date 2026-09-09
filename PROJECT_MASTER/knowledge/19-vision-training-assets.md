# 19 — Vision training assets: what we have, and what it can train

_Audited 2026-09-09. Counts verified directly on the machines._

## The piles

| Store | Where | Count | Ground truth | Can train |
|---|---|---|---|---|
| `E:\ChessDiagramsExtracted` | Vinayaka | **405,170** PNG, 2,887 books, 56 GB | none | extractor (via compositing) |
| `E:\chess-diagrams` | Vinayaka | 21,570 PNG, 504 books, 3.4 GB | none | extractor (via compositing) |
| `E:\chess-books` | Vinayaka | 1,325 PDFs | n/a | source for extraction |
| `E:\web-photos-labeled` | Vinayaka | 222 img + 222 labels | board polygon | extractor |
| `visionRefs` | Mongo, France | 128 crops | none/weak | — |
| `visionCornerLabels` | Mongo, France | 6 | corner quads | extractor (gold, tiny) |

## The trap that cost us a month

**Both trainers hardcoded the SMALL pile.** `progressive_train.py` and `classifier_train.py`
both point at `E:\chess-diagrams` (21,570 / 504 books). The bulk pipeline had meanwhile produced
`E:\ChessDiagramsExtracted` — 19× the images, 5.7× the books — and **nothing read it**. Roughly
twelve days of rclone and 56 GB of disk produced zero training value.

Worse, the old pile is *exhausted by design*: the extractor skips any book it has already
processed, so the flat pile stops growing, and `progressive_train.py` gates on "+500 new
diagrams". It logged `skip: only +183 new (need +500)` on every cycle indefinitely.

**Book count is the metric that matters**, not image count — each book is a different piece
font, and font diversity is what generalises. Always sample *across* books rather than
exhausting a few.

## Bare pixels are not a dataset

All 405k and all 21.5k diagrams are **unlabelled**. Extension histogram over a full recursive
walk of the old pile: exactly `{'.png': 21570}`. No `.txt`, no `.json`, no FEN in any filename.

They are still valuable, because of one trick: **compositing invents the label.**
`gen_realboard_composites.py` pastes a real diagram into a synthetic photo scene, so it knows
exactly where the board is and writes the YOLO polygon for free. Real piece art × synthetic
scene diversity × camera realism, with perfect crop labels.

That works for the **extractor**. It does **not** produce piece labels, so it cannot train the
**classifier**. `classifier_train.py` fills that gap by letting the current classifier label its
own crops (keep if conf ≥ 0.85 and 3 of 4 rotations agree) — self-training, which can sharpen a
good model but cannot teach it anything it does not already believe, and will entrench
systematic errors. There is no independent piece ground truth anywhere in this project.

**The one legitimate path to piece labels:** label the EASY domain and train on the HARD one.
The classifier is ~99% on clean PDF-cropped diagrams, so pseudo-label those, filter by chess
legality (both kings, ≤8 pawns, no pawns on rank 1/8), then train on deliberately degraded
photo versions of the same images. This is the opposite of what the retired progressive loop
did — it labelled hard 3D web photos where the model was weak, and kept 0 of 476 on 1615
consecutive cycles.

## Generator facts worth knowing

`gen_realboard_composites.py` (France, synced to Vinayaka as `C:\gen_realboard_composites.py`):

- Board scale is sampled in **two regimes**: 45% at 0.18–0.40 of frame (diagram on a page) and
  55% at 0.45–0.80 (framed close-up). The old single 0.5–0.75 range is why full-page scans
  failed — see `knowledge/18`.
- Draws **coordinate labels** hugging the board, on the page but never in the mask, so the model
  learns coordinates are not board.
- Emits an **orientation sidecar** (`orient/*.txt`): `white_bottom|flipped` plus whether
  coordinates were drawn. Flipping rotates the board *pixels* and reverses *both* axes together;
  reversing only the ranks makes the labels contradict the position.
- `--recursive` + `--max-per-book N` sample across the nested per-book pile.
- `--shard i --shards n` for parallelism; it is single-threaded and Vinayaka has 32 cores.

## Ground truth we should be capturing and are not

Every time a coach drags the corner handles we get pixel-perfect ground truth for the exact
failure we care about. That is the highest-quality data available to us and there are **6** rows
of it. The nightly job that consumes them was dead for a month (see `sessions/2026-09-09`).
