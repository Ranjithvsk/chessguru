# Book ingest: how diagrams get lost or misread

Everything here was found the hard way on 2026-09-17, on three books uploaded by
gunachess. Read this before touching `vision-service/book_ingest.py` or
`service._classify`.

## The measurement that exposes all of it

`diagrams.json` stores `conf` = **avgConfidence**, a mean over all 64 squares. A mean
cannot point at an outlier: a board with 62 easy empty squares and one square read at
0.27 still averages 0.96. Every failure below looked healthy by `conf`.

Per-diagram `minConf` and `squaresBelow` (count under 0.70) are now stored at ingest
(`book_ingest._conf_detail`) and are the numbers to trust.

    book                minConf mean   flagged
    Dvoretsky              0.989          1%     <- healthy
    Positional Play        0.929         10%
    Mammoth (before)       0.069        100%     <- broken, but conf said 0.933

Tools:
- `vision-service/accuracy_check.py` — accuracy + latency against 38 labelled boards.
  Run BEFORE and AFTER any change to the classifier or the pipeline.
- `vision-service/backfill_conf.py` — adds minConf/squaresBelow to already-ingested
  books (~90s for 400 pages). **Run as `ubuntu`** — the store is ubuntu-owned.
- `vision-service/rescan_book.py` — re-reads an already-ingested book in place
  (minutes, not ~30). Never regresses: keeps the stored reading when a re-run is less
  confident.

## Pitfall 1 — the detector's thumbnail is NOT the board

`_detect_all_boards()` returns BOTH a `box` and a pre-made 512x512 `boardPngBase64`.
The thumbnail is clipped on some books — a whole file sliced through the middle. The
ingest used the thumbnail.

    same two boards, Mammoth page 45:
      thumbnail   legal=False   minConf 0.013 / 0.002
      page + box  legal=True    minConf 0.999 / 0.999

**Always crop from the page using `box`**; fall back to the thumbnail only if the box
is missing.

The same mistake had a second form, one line above the crop: the loop opened with

    for box, cb in page_boards:
        if not cb:              # <- demands the THUMBNAIL
            continue

so a board the detector had located but returned without a thumbnail was dropped before
the box was ever looked at — invisibly, exactly like the clipped-thumbnail case. It was
firing on zero boards in all three books when found (2026-09-17), which is precisely why
it survived: a latent loss of this kind shows up as nothing at all. The guard now accepts
a board with EITHER source, and the thumbnail fallback logs when it has neither.

Verified by re-running the ingest with `boardPngBase64` forced to `None` on every
detection: 5 boards over 3 pages, box-only reads identical to box+thumbnail and identical
to the shipped book.

The general rule: **the box is the primary source, the thumbnail is the fallback.** Any
code that tests `cb` before `box` has the precedence backwards.

## Pitfall 2 — an illegal FEN DELETES the diagram, silently

    fen = (r or {}).get("fen", "")
    if not _legal(fen):
        continue          # diagram discarded, no trace

So any upstream misread does not produce a wrong diagram — it produces NO diagram, and
the reader shows a page with nothing to click. This is why Mammoth had **44% of pages
with zero diagrams** while the detector had found every board at 0.94+. Detection
being fine tells you nothing; check what survives `_legal`.

## Pitfall 3 — passing `warped` skips the margin trim

`classify_image(crop, warped=crop)` tells `/classify` to trust the crop and skip its
own extractor — **which also skips `_refine_crop_to_checker`**, the pass that strips
a-h / 1-8 label strips. Books that print coordinates INSIDE the board frame then get
an 8x8 split landing between squares and every piece shifts a file.

    truth     r1bq1rk1/p4ppp/2p2b2/3pp3/4P3/2B5/PPP1QPPP/RN3RK1
    before    rbqqRrk1/p4ppp/1pp1Pb2/3pp3/3PP3/BB6/PPPPQPPP/NN…
    after     r1bq1rk1/p4ppp/2p2b2/3pp3/4P3/1B6/PPP1QPPP/RN3RK…

`service._classify` now refines book crops, guarded exactly as the interactive path
guards it (keep only if it does not shrink the board away AND scores better).
**The refinement TRIMS margin — it cannot give back board that was cropped away**, so
it is not a fix for Pitfall 1. Forcing it on a clipped crop made things worse
(minConf 0.000); the guard correctly rejects it.

## Pitfall 6 — a stored book is NOT just ingest output, so re-ingest usually loses

Measured 2026-09-17 by re-reading every book into a temp id and comparing before
swapping. **Not one re-read beat the stored copy:**

    book                        stored                 fresh re-ingest        verdict
    mammoth                     294 dia / 0.069 mean   444 / 0.998            SWAPPED (the box-crop fix)
    grandmaster-preparation     877 / 0.929 / 87 low   879 / 0.927 / 89 low   kept old
    endgame-manual-dvoretsky    697 / 0.989 /  7 low   696 / 0.989 /  6 low   kept old
    pandolfini-deep-blue         87 / 0.723 / 38 low   103 / 0.592 / 63 low   kept old

Because `diagrams.json` accumulates: the original ingest, then `rescan_book.py`
(never regresses), `backfill_conf.py`, `corrections.jsonl` and `proven-labels`. A
fresh ingest starts from zero and cannot reproduce any of that. **Re-ingest only
when there is a specific, measured defect in the READ ITSELF** — Mammoth's clipped
thumbnails were exactly that, and nothing else was.

Always re-ingest into a TEMP book id and swap only on a strict improvement in all
three of count, mean `minConf`, and low-confidence count. Overwriting in place
would have destroyed four books' worth of accumulated corrections today.

## Pitfall 7 — do not rebuild a missing book.pdf from the rendered pages

`pandolfini-deep-blue` has no `book.pdf` (86 page JPEGs survive). Rebuilding one
with Pillow and re-ingesting looks reasonable and is a trap: ingest re-renders the
PDF at 150 dpi, so already-lossy JPEGs take a SECOND lossy pass.

    re-rendered vs the stored page images: PSNR 35.2 dB  (pages 10/30/50)

That degradation alone explains its 0.723 -> 0.592. The rebuilt PDF was deleted so
a later run cannot silently pick it up and "confirm" the bad numbers. To re-read a
book whose PDF is gone, read the stored `pages/*.jpg` directly.

## Pitfall 4 — rescan vs re-ingest

- `rescan_book.py` re-reads diagrams ALREADY in `diagrams.json`. Use it when boards
  were found but misread (Pitfall 3).
- A full **re-ingest** is the only way to recover diagrams that were never recorded
  (Pitfall 2). ~28 min for 400 pages. Back up `diagrams.json` first.

## Pitfall 5 — the repo and the box drift

`/opt/chessguru-vision` is NOT a git checkout; `v2/vision-service/` in the repo is a
mirror kept by hand. On 2026-09-17 the repo was 44 lines behind on `service.py` and 39
on `book_ingest.py`, with two scripts existing only on the box. **After editing on the
box, copy the files back into `v2/vision-service/` and commit.**

## Reading the reader

A diagram the model was unsure about shows an amber ring, and the tooltip reports the
worst square. That flag reads `squaresBelow`/`minConf`; it used to read `modelConf`
(the average) and a note in BookReader records that it "caught 0 of 6 wrong diagrams"
— which is what a mean does.
