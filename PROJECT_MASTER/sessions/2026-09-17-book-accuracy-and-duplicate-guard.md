# 2026-09-17 (later) — book scan accuracy, duplicate guard, nav

## The Mammoth book read everything one file to the left

`minConf` mean **0.069**, 294/294 diagrams flagged, against 0.989 / 1% for Dvoretsky.
The FENs were nonsense (`1QQpp3/3qq1b1` — doubled queens and bishops).

**Cause.** That book prints the a–h / 1–8 coordinates INSIDE the board frame, so the
detector's box includes the label strip and the 8x8 split lands between squares.
`_refine_crop_to_checker` exists precisely to cut those margins — but the book path
calls `classify_image(crop, warped=crop)`, and passing `warped` tells /classify to
trust the crop and skip its own extractor, **which also skips the refinement**. The
interactive scanner runs it; the book ingest never did. Books without inner labels
were unaffected, which is why only this one looked broken.

    truth     r1bq1rk1/p4ppp/2p2b2/3pp3/4P3/2B5/PPP1QPPP/RN3RK1
    before    rbqqRrk1/p4ppp/1pp1Pb2/3pp3/3PP3/BB6/PPPPQPPP/NN…   minConf 0.043
    after     r1bq1rk1/p4ppp/2p2b2/3pp3/4P3/1B6/PPP1QPPP/RN3RK…   minConf 0.999

Fixed in `service._classify`, guarded as the interactive path guards it (keep the
refinement only when it does not shrink the board away AND scores better).

`rescan_book.py` re-classifies an already-ingested book in place — minutes instead of
a ~30-minute re-ingest, and it NEVER regresses a diagram (keeps the stored reading
when a re-run is less confident).

    Mammoth          0.069 -> 0.998   flagged 294/294 -> 0/294
    Positional Play  0.862 -> 0.929   flagged 132/877 -> 87/877

## Duplicate students, caught at the keyboard

`quickAddStudent` already refuses a near-duplicate server-side. Added the other half:
the Add Student form queries `students-lite` and shows matching students AS THE COACH
TYPES ("harith" surfaces `Haritha R / harithar`), with the reason spelled out — adding
again creates a second login that is left off the batches the first one is on.

Matching is normalised both ways, so "Haritha" finds "Haritha R" and vice versa.

## Nav

Books removed from the sidebar entirely — the `/books` entry under Notebook and the
`/book` entry under Learn. `/books` now hangs off the Notebook page's own column.
Routes are untouched, so existing links still work. NOTE: `/book` (puzzles from book
games) is now reachable only from a link inside OppositionTrainer — orphaned in the
nav, deliberately, but worth knowing.

## "Unhandled rejection: [object Event]"

Three reports on `/class-v2/*` from mobile. The reason was an `Event`, which has no
`.message` and no `.stack`, so the reporter logged `String(r)` — literally
`[object Event]` — and every such failure looked identical and was unactionable.

Not new: 8 occurrences since 07 Sep, ALL on class pages, and not crashes. Most likely
media (a class page wires media/socket error events into rejects, and these devices
show "No camera or microphone found").

`report-error.ts` now describes an Event reason: type, target tag, `src`, `readyState`,
media error code. The next occurrence will say what actually failed.

## Open

- `ragul` / `ragul-2` still unmerged (both have real activity).
- Rename endpoint still has **no UI button** — the dropdown tells a coach to rename
  but they cannot do it from the screen.
- Four dormant duplicate pairs never logged into: `dhritibhattacharya-2`,
  `lakshmikkanth`/`-2`, `balajis`/`-2`.
