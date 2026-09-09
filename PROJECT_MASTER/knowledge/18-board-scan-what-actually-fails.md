# 18 — Board scan: what actually fails, and what does not

_Measured 2026-09-09 while working TKT-166. Every number here came from running the live
pipeline on real images, not from reading code. Re-measure before trusting any of it._

## The one-line version

**The classifier is not the problem. Framing is.** Whether a scan succeeds is decided almost
entirely by how much of the image the board occupies and whether anything competes with it.

## The evidence

| Input | Board fills | Result |
|---|---|---|
| ChessGuru app screenshot (phone) | ~90% of frame | correct, first try, no adjustment |
| Diagram cropped tight from a PDF | 100% | 17 of 17 pages legal, conf 0.92–1.00 |
| One diagram cropped from a book page | ~45% | **64/64 correct, conf 0.991** |
| Full book PDF page, rendered at 150 dpi | ~28% | **0 of 12 pages correct** |
| Photo of a book page, coords in crop | ~30% | garbage FEN at 99.4% claimed conf |

The third and fourth rows are the same page. Same model, same pixels, cropped differently.
That is the whole finding.

## Three distinct failure modes, often confused

1. **Coordinate labels inside the crop.** The a-h / 1-8 strips sit a few pixels from the board.
   Include them and the 8×8 split lands up to half a square off, so every piece straddles two
   tiles and reads as a *confident* `empty`. TKT-166's photo: 8 phantom pieces at 0.34–0.68 and
   every real piece missed. Trim only the strips → 63/64 at 0.990.
2. **Board too small in frame.** The extractor was trained on composites where the board filled
   0.5–0.75 of the image. A real book page puts it at ~0.25–0.35. It had never seen the case.
3. **Several boards on one page.** The pipeline collapsed all detections to one crop, usually
   spanning two diagrams, and returned nonsense at high confidence.

## What is genuinely strong

- **Piece recognition on print.** 17 book diagrams from Aagaard's *Attacking Manual*: every one
  legal with both kings, 0.92–1.00. The single observed error across the day was a black king
  read as a pawn on grainy halftone.
- **Multi-board detection.** The extractor is instance segmentation and already finds every
  diagram on a page — 6 of 6 at 0.93–0.95 on a six-diagram puzzle page, each classifying to a
  legal position at 0.99–1.00. That capability existed and was being discarded.

## Guards that do and do not work

- `warpQuality.quality == "bad"` fires on most bad crops, but **let 3 of 12 bad pages through**
  as `ok` with score 0.70. Not sufficient alone.
- **`warpQuality.parity` is NOT a usable discriminator.** Measured across real logged crops: a
  verified 64/64 scan scored **0.641** while the broken TKT-166 crop scored **0.719**. Do not
  gate on it. This was tried and rejected.
- **Missing king is a reliable signal.** Every legal position has both kings and every printed
  diagram shows them. All observed bad reads had 0, 1, 2, 3, 4, 5 or 9 kings.

## Auto-crop refinement: three approaches that failed

Do not spend another day here without reading this first.

1. `_refine_crop_to_checker` (FFT, in `service.py`) — a no-op that over-crops hard photos.
2. Gradient-projection autocorrelation — locked onto the halftone hatching inside dark squares,
   returned a square pitch of 32px where the truth was ~59px, and made parity *worse*
   (0.719 → 0.500, i.e. pure chance).
3. Brute-force 4-D inset sweep — correct in principle, 14k candidate scorings, did not finish
   in two minutes.

Photographed halftone book print defeats geometric methods. The durable fix is training data
(see `plans/`), not another heuristic.

## Rules of thumb

- Judge a scan failure by **framing first**, model second.
- A confident FEN is not a correct FEN. Check king counts before believing anything.
- Before retraining, crop the input tighter by hand and re-run. If that fixes it, the classifier
  was never at fault.
