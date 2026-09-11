# Scoresheet OCR — handwritten scoresheet photo → verified PGN

Status: PLAN (2026-09-11). Owner asked: "we had plan to read scoresheet right..? hand written … plan it out".
Builds on Dream OCR (`v2/vision-service/dream_ocr.py`, knowledge/20-dream-ocr.md), which already
turns noisy move tokens into a legality-proven game. Scoresheets are the *easier* case for that
pass: every game starts from the initial position, so `start_fen` is never in doubt.

## 1. What the user gets

- A **"Scan scoresheet"** button beside "Scan position" (coach board + student app).
- Photo(s) of a handwritten sheet in → PGN out, in under ~30 s.
- Every move carries a confidence; moves the beam could not prove unique are highlighted
  and the coach fixes them on a board that only offers legal moves. One tap saves the game
  to the student's record (and, later, feeds tournament results into the arbiter module).
- Every correction becomes a labelled training cell (reuse `export_training_pairs`), so the
  recogniser improves the way the diagram classifier already does nightly.

## 2. Open data that exists (verified 2026-09-11)

| Source | What | Size | Notes |
|---|---|---|---|
| **HCS — Handwritten Chess Scoresheet Dataset** (Eicher, Farmer, Li, Majid; ICDAR 2021 workshop) | Phone photos of real club scoresheets, cropped, perspective-corrected, headers removed, every move box labelled | 215 pages · 158 games · ~13.8k move-box images | Two mirrors: https://sites.google.com/view/chess-scoresheet-dataset and https://tc11.cvc.uab.es/datasets/HCS_1 . Their baseline: ~95 % move accuracy autonomous, ~99 % with human-in-the-loop. **US club sheet layout; check the licence terms before commercial use (TC-11 datasets are usually research-only).** |
| Paper: *Digitization of Handwritten Chess Scoresheets with a BiLSTM Network* (J. Imaging 2022) | Method + post-processing rules | — | https://www.mdpi.com/2313-433X/8/2/31 — their "chess-specific restrictions" are a weaker version of our legality beam. |
| Paper: *Understanding attention-based encoder-decoder networks: a case study with chess scoresheet recognition* (2024) | Attention OCR on HCS | — | https://arxiv.org/pdf/2406.06538 |
| **Reine Chess Scoresheet Scanner** (GitHub) | Grid split → per-cell CNN on EMNIST | code only | https://github.com/Messier-16/Reine-Chess-Scoresheet-Scanner — useful for the cell-segmentation idea, not the model. |
| IAM handwriting / EMNIST | General Latin handwriting | large | Only as pre-training; TrOCR-handwritten checkpoints already include it. |

What does **not** exist openly: Indian tournament sheets (AICF/FIDE 2-column, 60- or 80-move
layouts), children's handwriting, Tamil-region ink/paper. We must collect those ourselves — see §6.

## 3. Pipeline

```
photo ─► 1 rectify ─► 2 grid/cell split ─► 3 handwriting → top-k per cell ─► 4 legality beam ─► 5 PGN + flags
                                                                                     ▲
                                                             coach corrections ──────┘ (training pairs)
```

1. **Rectify** — reuse `service.py` `/warp-with-corners` (corner detect + perspective warp). Add deskew.
2. **Cell split** — printed grid lines via Hough/contours → move-number column + White/Black cells.
   Fallback for grid-less or faint sheets: row bands from ink projection. Output `cells[n][colour]`.
   Must be layout-agnostic (HCS single-column-pair vs Indian two-column-pair sheets).
3. **Recognise** — each cell → `[(text, conf)]`, several candidates, not one.
   - Phase A (no training): **Qwen3-VL-4B on Vinayaka** (already installed for Dream OCR, fits the
     10 GB 3080), prompted with a strip of 10 cells at a time ("read each handwritten chess move,
     one per line"). CPU fallback: `microsoft/trocr-base-handwritten` per cell.
   - Phase B: fine-tune **TrOCR-small-handwritten** on HCS cells + our harvested cells, export ONNX,
     serve on France CPU (small model, ~50 ms/cell). Same France→Vinayaka→France loop as the
     nightly diagram retrain (`scripts/chess-vision-retrain.sh`).
4. **Legality beam** — feed candidates into `apply_chess_constraints` / `read_page` with
   `start_fen = startpos`. Extend `_ranked_candidates` with a **handwriting confusion table**
   (1/l/I/7, 0/O/o/Q/D, 5/S, 2/Z, 4/A/9, 6/b/G, 8/B, x/×/:, +/t/7, castling O-O/0-0/00,
   =Q/Q, result tokens 1-0 ½-½ 0-1, blank/crossed cells → "unknown"). Rule: a move OCR can't
   read is still constrained to the legal set; if exactly one legal move fits the ink shape
   class it is marked *inferred*, never *verified*.
   Bonus trick unique to tournaments: **both players' sheets** record the same game — read
   both, intersect candidates, and most ambiguities vanish.
5. **Output** — PGN + per-move `{san, conf, verified|inferred|unknown}` + cell crops for the
   correction UI. Store raw crops with the game so corrections can be harvested.

## 4. Metrics (copy HCS so numbers are comparable)

- **MRA** — move recognition accuracy, per move, autonomous (no human).
- **Game-clean rate** — % of sheets with zero human corrections needed.
- **Corrections per sheet** — what the coach actually feels.

Targets: Phase A ≥ 90 % MRA raw on Indian sheets, ≥ 97 % after beam; Phase B ≥ 95 % / ≥ 99 %.
HCS adults' handwriting will score higher than our kids'; report both.

## 5. Milestones

| # | Work | Est. | Done when |
|---|---|---|---|
| M0 | Download HCS; build `eval_scoresheet.py` (mirrors `eval_dream_ocr.py`); run Qwen3-VL-4B + beam on HCS labelled cells | 1 day | MRA number on HCS, raw and post-beam |
| M1 | Rectify + cell split for HCS **and** 5 Indian sheets; end-to-end CLI `photo → PGN` | 2–3 days | 5/5 Indian sheets split correctly; PGN produced |
| M2 | `POST /api/vision/scoresheet` (Nest → vision service :5100, same rate-limit zone) + web "Scan scoresheet" page with correction board; coach/owner roles only | 2 days | Coach at Guna scans a real sheet and saves the game |
| M3 | Fine-tune TrOCR on HCS + harvested cells on Vinayaka; ONNX to France; add to nightly retrain | 3–4 days | Phase B targets met; CPU path no longer needs Vinayaka |
| M4 | Student game history + arbiter result import + both-sheets cross-check | 2 days | Tournament round results entered by photo |

## 6. Data we must collect ourselves

- Ask Guna Chess Academy and Shri Guru for **50 photographed sheets with known PGNs** (their
  tournament games are often already on chess-results, which gives free ground truth).
- Consent + anonymise like HCS: crop player names/headers, keep only the move grid.
- Capture protocol: phone, natural light, whole sheet in frame, no flash — matches real use.
- Store under `vision-service/data/scoresheets/<academy>/<sheet>.jpg` + `.pgn`; never in Mongo.

## 7. Risks, stated

- **Kids' handwriting** is far worse than HCS; expect Phase A on real academy sheets to land
  well under the HCS number. The beam is what rescues it — measure both.
- **Layout variety** — Indian sheets differ from HCS; cell split must be measured on our sheets first.
- **Illegal moves actually played / mis-recorded** happen in kids' games. The beam must be
  allowed to say "unknown" and continue from the coach's fix, not force a legal reading.
- **Vinayaka** is the owner's PC — it sleeps, it is busy at 22:00 UTC with the nightly retrain,
  and the VLM must be pinned to the card (20-dream-ocr.md). Phase B removes this dependency.
- **HCS licence** — research dataset; do not ship a model trained on it into a paid product
  without checking the terms. Our own harvested cells are the long-term training set anyway.

## 8. Reuse map

`service.py:/warp-with-corners` (rectify) · `dream_ocr.apply_chess_constraints` (beam) ·
`dream_ocr.export_training_pairs` (harvest) · `scripts/chess-vision-retrain.sh` (nightly loop) ·
`BoardEditor.tsx` accept/feedback endpoints (correction UI pattern) · `chess_logic.py` (legality).

## 9. M0 findings so far (2026-09-11)

- HCS layout: `data/<game>_<page>.png` full sheets, `extracted move boxes/<game>_<page>_<move>_<colour>.png`
  cells (~960×174 px, 25,320 cells incl. blanks, 14,872 labelled). **Pages 0 and 1 of a game are the
  two players' copies of the same game**, not a continuation — the free cross-check in §3 step 4 is
  real and the dataset already contains it. Test labels (`testing_tags.txt`) omit the page because they
  apply to both copies.
- **Only 10 of 206 sheets replay as legal chess from move 1.** The labels transcribe what the hand
  wrote, and players write wrong moves (sheet 001 has "23.Bd7" where the position needs another
  square; 002 has "N4"). Median sheet goes illegal within the first 10–20 % of its moves. So:
  - MRA is measured against *what was written*, not against a legal game.
  - The beam must **not** repair a confident, clearly-written illegal move into a different legal
    one — that would be inventing a game. It should mark it *unknown/illegal*, keep the ink reading,
    and re-anchor the position from the coach's fix (or from the opponent's sheet).
  - `eval_scoresheet.py` therefore reports an **over-correction** count (raw right → beam wrong)
    alongside MRA and false-confidence, and a fully-legal-sheet subset for the clean-chess number.
- Vinayaka already has the venv (`E:\ocr-gpu`, torch 2.14 cu126, transformers 5.17) and
  Qwen3-VL-4B cached; the reader is `hcs_qwen_read.py` (10 cells stacked per strip, resumable,
  runs detached, logs to `E:\scoresheets\read.log`). Sample = 40 sheets (all 10 legal + 30 random).
