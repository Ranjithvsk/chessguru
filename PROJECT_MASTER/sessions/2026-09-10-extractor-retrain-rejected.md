# 2026-09-10 — The retrained extractor was rejected, and that is the system working

## Verdict

**NOT INSTALLED.** Live weights restored and checksum-verified; service healthy.

| Metric | Current live | New candidate |
|---|---|---|
| Book pages with a reachable position | 10 / 12 | 10 / 12 |
| Exact FEN hits | 3 / 4 | 3 / 4 |
| Candidates on the six-diagram page | 6 | 6 |
| Screenshot correct | yes | yes |

Identical on every headline metric, and **worse on one page**: page 28 dropped
from 8 reachable positions to 4.

## What it cost

- 40,234 coordinate-aware, two-regime composites generated
- ~6 hours of training, 30 epochs, fine-tuned from the live weights
- Final synthetic scores: **mask mAP50-95 0.954, box 0.992**

## The lesson, which is the point of writing this down

That 0.954 is on a validation split where roughly 90% of the images are the same
synthetic composites the model trained on. It is the model marking its own
homework. It did not transfer to real book pages **at all**.

Had the detector metric been the gate, we would have shipped a regression on the
strength of a 99% number.

The two faults this retrain targeted are real and still unfixed:
  * boards filling ~a quarter of a dense page (the page-scale regime)
  * coordinate strips shifting the 8x8 split half a square

The composites clearly taught the model something about them; it just did not
change what a coach receives. Next attempt should change the DATA's realism, not
the epoch count — and should be judged only end-to-end.

## Also found

- Training ran with `workers=0`, so image decoding was single-threaded and the
  GPU was starved: 12 min/epoch for 37,709 images at 384px on an RTX 3080.
  Ultralytics does auto-select `cuda:0` there, so the card WAS used — an earlier
  reading of 0% utilisation was a Windows session-isolation artefact, not proof
  of CPU training. Next run: `workers=8`.
- The ONNX export never happened on the night. The monitoring wrapper's
  `timeout 14400` killed the ssh, and the script's next `print()` hit a dead pipe
  and took the process down before it exported. Training itself was unaffected
  and completed all 30 epochs. Exported separately afterwards.

## Files

- `scratchpad/validate_extractor.py` — the head-to-head; swaps weights, restores in `finally`
- New weights kept at `E:\extractor-runs\coords-20260909\weights\best.pt` on Vinayaka
