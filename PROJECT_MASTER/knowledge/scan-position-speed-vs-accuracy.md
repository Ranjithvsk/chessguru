# Scan position: speed vs accuracy (2026-09-17)

Two attempts to speed up Tools → Scan position both cost accuracy. Both were reverted.
The harness built to catch the second one is now the gate for any future change.

## The gate

    /opt/chessguru-vision/accuracy_check.py          # 38 labelled boards, live :5100
    python accuracy_check.py 38 before.json
    ...make the change, restart chessguru-ultra-vision, warm it...
    python accuracy_check.py 38 after.json
    python accuracy_check.py --diff before.json after.json

Baseline on the current pipeline, saved as `accuracy-baseline-20260917.json`:

| | |
| --- | --- |
| square accuracy | **93.09%** |
| exact boards | 18/38 |
| pieces read as empty | 46 |
| empties read as piece | 47 |
| latency p50 / p90 | ~2.1s / ~2.6s |

Ship only if accuracy holds and p50 drops.

## What failed, and why

**1. Shrinking the upload (client, 1600px JPEG q85).** Reverted same day — the owner
reported every scan wrong, and one logged scan came back `conf 0.87, 8 pieces` of
garbage.

The reasoning error: *the extractor predicts at `imgsz=640`, so anything larger is
waste.* It is not. The extractor **detects** the board at 640 but **crops from the
full-resolution image**, and that crop is what the classifier reads. Pre-shrinking
permanently lowers the resolution of the pixels the pieces are recognised from.

Measured on labelled boards composited into a 3024x4032 frame (board ~45% of it):

| | square acc | payload |
| --- | --- | --- |
| full-res | 71.3% | 594 KB |
| 1600px + JPEG q85 | 67.4% | 97 KB |
| 2400px + JPEG q90 | 71.3% | 214 KB |
| full-res, JPEG q85 only | 67.8% | 430 KB |

Most of the loss was **JPEG q85, not the resize**. q90 at 2400px held the baseline on
3x less data — so there IS a safe version here, but it must be proven on real owner
photos, not composites.

**2. Dropping flip-TTA during the rotation search** (search cheap, TTA on the winner).
Caught by the harness before shipping:

    accuracy -1.60 points (93.09 -> 91.49), pieces lost 46 -> 65
    p50 -201ms, but p90 WORSE (2607 -> 3527ms)

Not worth it. The flip average is doing real work on low-contrast squares.

## What shipped

Removing the `await` on the `log-scan` archive upload in `runVision`
(`apps/web/src/pages/BoardEditor.tsx`). It used to block the scan from starting until
a full-size upload finished. Touches no pixels, so no accuracy risk.

## The real accuracy problem

Piece-vs-empty on low-contrast squares, measured through the live endpoint:

| piece | square | accuracy | read as empty |
| --- | --- | --- | --- |
| black | dark | 90.8% | 5 |
| black | light | 93.7% | 7 |
| **white** | **dark** | **75.7%** | **21** |
| white | light | 83.2% | 13 |

46 real pieces read as empty across 38 boards. This is what makes a piece "go missing"
from a scanned position (owner reported a7 and c7 — both dark squares).

`harvest_corrections.py` and `finetune_from_corrections.py` exist to fix exactly this,
but **no logged scan carried a correction** (`corrections: 0` on every row of
`visionScans`). The cause was a bug, not coach laziness -- see below.

## The correction loop was dead (fixed 2026-09-17)

The correction panel renders only when `visionSnapshot && lastScanIdRef.current` are
both set. **Both were set exclusively inside `runServerClassifyOnCanvas`** -- the
retired v2 path, which is itself only reachable from `runServerClassify`, which
returns early unless `visionSnapshot` is already set. Nothing ever set it, so:

- `runServerClassifyOnCanvas` was unreachable, and rollup stripped it from the bundle
- the live path (`runUltraScan`) set neither value
- the correction UI never rendered for anyone, and `scanId` never reached `/feedback`
- so every scan recorded `corrections: 0`, and the retraining scripts had no input

The fix rebuilds both from the `/classify` response inside `runUltraScan` -- it already
returns `boardPngBase64` (the warped board) and the per-square `squares` grid, so no
detector needs re-running.

**How this hid for so long:** editing `runServerClassifyOnCanvas` changes NOTHING in the
build output -- same chunk hash, byte for byte -- because dead code is tree-shaken. If a
source edit does not change the emitted chunk hash, the code you edited is not reachable.
That is a faster diagnosis than grepping the minified bundle for identifiers, which are
renamed; only string literals and object property names survive.

Verified end to end 2026-09-17 on a labelled board: scan returned
`2kr1bnr/pppq1ppp/2np4/3b4/2P3PN/1P3P1P/PB2P3/R2QKB1R` (exact match to ground truth),
the four correction buttons rendered, and "Position is correct" wrote
`accepted: true` + `finalFen` to `visionScans`.

## Where "instant" actually lives

The box is CPU-only, 8 cores. Per scan: one YOLO extractor pass at 640, then up to 4
rotations x 128 tile inferences (64 tiles x flip). Measured classifier cost 697ms;
batching all rotations into one call saves only ~10% (it is compute-bound, not
call-bound). Sub-second needs a GPU or a quantised ONNX/OpenVINO export, not
pipeline tweaks.

## Landmine

`/opt/chessguru-vision` is **not under version control** — trained weights, service.py
and this harness all live there untracked. Backups from this session:
`service.py.bak-20260917-precap`, `service.py.bak-20260917-pretta`.


## What the errors actually are (2026-09-17)

Across 38 labelled boards, 168 wrong squares:

| error | count | share |
| --- | --- | --- |
| ghost (empty read as a piece) | 47 | 28.0% |
| piece read as empty | 46 | 27.4% |
| **wrong COLOUR, right type** | **31** | **18.5%** |
| wrong type, right colour | 29 | 17.3% |
| wrong both | 15 | 8.9% |

Colour flips split dark 18 / light 13.

The colour bucket is what a **shadow** produces: a white piece in shadow is read as
black, shape correct, side wrong. Owner reported b2/b4/c3 on a shadowed board, and two
scans of the same position minutes apart show it directly:

    02:38  8/pp4pp/4k3/3rPp2/1Pr4P/2b1KPP1/1P6/4R3   b4=P b2=P
    04:13  8/pp4pp/4k3/3rPp2/1pr4P/2b1KPP1/1p6/4R3   b4=p b2=p

## Second correction-loop bug: colour corrections were dropped

`applyEditor` CASE 1 compared **type only**:

    const coachType = cell88.type.toUpperCase();
    if (coachType === visionType) continue;    // colour ignored!

and `visionSnapshot.types` stored only the uppercased type, discarding the scanned
colour. So a white-pawn-read-as-black correction produced `"P" === "P"` and was skipped
in silence -- the single largest confusable-error class was the one class that could
never be recorded. Fixed by carrying `colors` on the snapshot and comparing both.

Verified live: flipping a2 from white to black produced "Shared 1 correction", a
`visionRefs` row (`piece=P color=b setName=coach-correction`) carrying the `scanId`, and
`corrections: 1` on the scan. The deliberately-false test row was then deleted
(`visionRefs` back to 140, 0 coach-correction rows).


## Why a "?" scored 0.97 — it didn't (2026-09-17)

The owner asked the right question: how does a glyph that looks like no piece come
back confident? It does not. The 0.97 on a book diagram is `avgConfidence`, the MEAN
over all 64 squares. Per square, on page 19's three "x" key-square marks:

    c6 -> f @ 0.531    d6 -> f @ 0.768    e6 -> q @ 0.368
    real pieces        d7 -> k @ 0.988    d4 -> P @ 0.991    a1 (empty) -> f @ 0.971
    board AVERAGE 0.952   board MINIMUM 0.368   squares below 0.70: 2 of 64

62 easy squares drown two bad ones. The model's doubt was measured and then thrown
away: the LIVE scanner keeps per-square confidence (yellow rings, `lowConfSquares`,
`minConf`), while `book_ingest` stored only the mean.

This also explains the note in BookReader that the old amber flag "caught 0 of 6 wrong
diagrams" — it was reading `modelConf`, the average. A mean cannot point at an outlier.

**Two distinct causes, do not conflate them:**

1. *Structural.* A 13-class softmax has no "not a piece" output; probabilities are
   forced to sum to 1, so a novel glyph MUST land on one of the twelve pieces or
   empty. Fixing this needs a 14th class and a retrain, and only helps for glyphs.
2. *The actual defect.* The uncertainty was discarded at ingest. Keeping it defends
   against ANYTHING out-of-distribution — arrows, circles, printed numbers, pen marks
   — without anyone having to anticipate the glyph. This is the general fix.

### Shipped

- `book_ingest._conf_detail()` stores `minConf` and `squaresBelow` (count under 0.70)
  per diagram. Free — the numbers are already in the classify response.
- `backfill_conf.py` adds both to already-ingested books: ~90s for 400 pages against
  28 minutes for a re-ingest. Backs up to `diagrams.json.bak-before-conf`. **Run it
  as `ubuntu`** — the store is ubuntu-owned.
- BookReader's amber ring now keys off `squaresBelow`/`minConf` instead of the
  average, and the tooltip reports the worst square as a fact, not a verdict.

### Coverage, honestly

Flagged at the 0.70 bar: Dvoretsky 72/683 (10.5%), Pandolfini 38/87 (43.7%),
testbook1 41/69 (59.4%). Book quality varies enormously, so one global threshold is a
compromise; a per-book relative rank would be better if the noise becomes a problem.

It catches page 29's two wrong diagrams (worst squares 0.634 and 0.270) but NOT page
19 (worst 0.757 in grey). Note the asymmetry: read in COLOUR those marks scored 0.531
/ 0.368, read in GREY the whole board's worst is 0.757. The greyfix that repaired blue
boards also made the model more confident on markers. Worth remembering before
treating grey as strictly better.
