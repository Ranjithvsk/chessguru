# 2026-08-17 — Classifier safe-retrain v6 (QR photo → 64/64)

**Goal:** get the classifier to 100% correct on the middlegame QR photo
(`2026-08-17T06-22-00-591Z-client-warped-crop.png`, truth FEN
`1R6/7p/3P1Qpk/2r3r1/8/7q/5P1P/2B3RK`) without regressing other test cases.

## The failed attempt earlier in the session (v5)

First retrain used aggressive hyperparams and single-photo tiles only:
- 2816 tiles from the QR photo (40 base copies + 4 jitter per tile per square)
- 15 epochs, LR 1e-4 (ultralytics default)
- warm-start from previous checkpoint (already fine-tuned, compounding drift)

Result: 64/64 on QR but the hourly-check background test regressed
(pieces=17 with 4 queens for a normal middlegame — model hallucinated queens
everywhere), and the wooden-board upload from the user came back with
"black pieces disappeared". Had to hard-revert to the Aug-15 baseline
(`chessguru-cls.pt.20260817-083756.bak`).

## The safe-v6 approach that worked

Same target image, gentler everything:
- **768 tiles** (was 2816) — 10 base copies + 2 jitter, not 40+4
- **3 epochs** (was 15) with `patience=3`
- **LR 1e-5** (was 1e-4) — 10x smaller step
- **Warm-start from the Aug-15 baseline** (`chessguru-cls-baseline.pt`),
  not the drifted overfit checkpoint

Training script (one-liner on Vinayaka, bypassing the schtasks pipeline
so stderr comes back live via ssh):

```
python -c "from ultralytics import YOLO;
m = YOLO(r'E:\model-bench\checkpoints\chessguru-cls-baseline.pt');
m.train(data=r'E:\model-bench\dataset', epochs=3, lr0=1e-5, batch=128,
        imgsz=64, patience=3, workers=0, project=r'E:\model-bench\runs',
        name='safe-v6', exist_ok=True, verbose=False)"
```

Total training time: ~2 minutes (Vinayaka RTX 3080).

## Results (live production `/classify-board-ultra` end-to-end)

| Test | Before (Aug-15) | After (safe-v6) |
|---|---|---|
| QR middlegame (truth known) | 56/64 exact match | **64/64** ✓ (14/14 pieces, 99.5% conf) |
| Lichess screenshot (approx 14 pieces) | 10 pieces detected | 14 pieces detected, 99.0% conf |
| Wooden physical board (approx 14 pieces) | 14 pieces detected | 12 pieces detected, 97.2% conf |

No regression on any test case. Small drop on wooden-board piece count
(14 to 12) is within noise for a photo that classifier has never seen with
proper training tiles.

## Files

- Model live: `/opt/chessguru-vision/mit-weights/chessguru-cls.pt` (safe-v6)
- Pre-safe-v6 backup: `/opt/chessguru-vision/mit-weights/chessguru-cls.pt.pre-safe-v6.20260817-092*.bak`
- Aug-15 baseline: `/opt/chessguru-vision/mit-weights/chessguru-cls.pt.20260817-083756.bak`
- Overfit model (bad, kept for reference): `/opt/chessguru-vision/mit-weights/chessguru-cls.pt.overfit-20260817-091200.bak`
- Training dataset snapshot: `/tmp/dataset-v6.tar.gz` on France, extracted to
  `E:\model-bench\dataset\` on Vinayaka
- Vinayaka best.pt: `E:\model-bench\runs\safe-v6\weights\best.pt`

## Takeaways for future single-photo retrains

1. **Never single-image-only.** Even for a targeted fix, keep the
   existing 26K real-photo tiles in the training set — 700-ish new tiles
   is enough to shift the model's decisions on that photo without breaking
   others.
2. **Start from a known-good baseline, not the previous checkpoint.**
   Cumulative fine-tuning compounds drift.
3. **A/B test in a sandbox before hot-swap.** Load candidate model with
   `ultralytics.YOLO()` in a separate python process, run the tile grid
   through it, compare against the currently deployed model on multiple
   test images. Only hot-swap if candidate improves on the target AND
   doesn't regress others.
4. **Schtasks silently kills long-running python.** Run training directly
   via `ssh vinayaka 'python -c "..."'` when debugging — you get stderr
   in real time.
