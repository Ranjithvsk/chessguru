# 2026-09-09 (evening) — board scan made usable, then made safe

Follows on from `2026-09-09-scan-position-off-the-api-thread.md` the same day.
Thirteen commits. Owner drove it by scanning real book pages and reporting what
he saw, which found more in three hours than reading the code did all afternoon.

## The one lesson worth keeping

**Every explanation I reasoned to was wrong; every one I measured was right.**

- "Load failed" on a phone — I theorised about tab memory and Cloudflare. It was
  `413 client intended to send too large body` sitting in plain text in
  `/var/log/nginx/error.log`. `gunachess.com.conf` had no `client_max_body_size`,
  so it inherited nginx's 1 MB default and **no coach on a custom domain had
  ever been able to scan a photo**. chessguru.cc carried 10M all along, which is
  why it worked there and never here.
- White screen on one domain only — I ruled out Cloudflare, caches, chunk
  pruning, device memory, all correctly, and all irrelevant. Adding one error
  handler to the boot panel named it in a single screenshot:
  `Error: Invalid FEN: missing black king`.

When a user says something is broken, read the server's own logs first.

## The white screen (worst bug of the day)

`useFreePlay` seeded chess.js from localStorage with an **unguarded**
`new Chess(persisted.startFen)`. chess.js throws on an unplayable FEN, and a
scan legitimately produces positions with no black king — the editor places
them on purpose so the coach only fixes the wrong squares. Once persisted, every
later visit threw during first render, React unmounted, and **that origin was
white forever**. Reloading re-read the value; hard-refreshing does not clear
localStorage. Per-origin, which is exactly why one domain died and the identical
build worked on another.

A bad scan could permanently brick the site, for one user, silently.

Guarded now via `safeChess()`, and `loadPersisted` drops+rewrites an unloadable
value. Hard reset also clears localStorage/sessionStorage/IndexedDB — it
previously could not fix what was actually stuck.

## What shipped

**Multi-board picker.** The extractor is instance segmentation and already
found every diagram on a page — 6/6 at 0.93-0.95 — and we discarded five of
them. `/classify` now returns `candidates` and the editor shows thumbnails.
Needed no API change: the NestJS proxy spreads the Python response verbatim, so
only the :5100 service restarted.

**Angle correction.** Candidates were cropped from axis-aligned BOXES. On a
photo taken at an angle that keeps the skew and drags in page, so the 8x8 split
reads every square from the wrong place. Now the mask outline is reduced to four
corners (Douglas-Peucker, falling back to min-area rotated rect) and perspective
warped. On the worst photo of the day: box crops 0 legal of 5, mask warps 3.

**Chess-logic repair** (`chess_logic.py`). Corrects rather than warns, using the
64x13 probability matrix. The rule that matters is **colour balance**: if both
sides' counts of a piece type still sum to the starting total (4 rooks, 4
knights, 4 bishops, 2 queens) but the split is wrong, nothing was promoted — a
colour was misread. Fixed a white rook on d1 read as black at 0.954, which a
promotion-budget rule cannot catch because promotions were affordable on paper.
Must build on the EXISTING validation, not the raw argmax: starting from argmax
silently discarded the pawns-off-back-rank pass.

**Tier-3 extractor fallback.** `cv.extract_board` returns one board or nothing;
on a hard page it returned nothing and the coach got 422 with no way forward
while the same weights found six boards directly.

**Payload.** A 12-board response was 10.8 MB of full-res PNG, and tapping a
board re-uploaded the whole page (6.4 MB). Now JPEG at 640px and crop-only:
about 0.75 MB and 0.29 MB. The candidate cap was 8, which is why a 12-diagram
page showed only 8.

**Security.** The scan API took no auth and had no rate limit — an anonymous
POST reached the classifier. Weights were never exposed (outside web root,
service on 127.0.0.1, no inference library in the bundle) but enough
call/answer pairs distil a copy of the extractor without them. All 8 POST
routes now require a session; nginx limits 30/min per client. The key is
**not** `$binary_remote_addr` — chessguru.cc is behind Cloudflare, so that
would throttle every visitor as one bucket; a map prefers `CF-Connecting-IP`.

**Correction capture, finally wired.** It only ever fired from Edit position ->
Apply. The natural fix is to drag a piece and copy the FEN, which recorded
nothing: **140 corrections, none since 11 August**, while the classifier stayed
wrong on exactly the squares people fixed by hand daily. Copy FEN is now the
confirmation signal. Because students scan too, `approved` is gated on
`modelConf < 0.9` — overturning a confident read is held for review, since a
slip and a real catch look identical there. `gen-train-data.py` already reads
`{approved:true, rawCropPng:{$exists:true}}`, so the loop closed with no extra
work.

## Warning-threshold tuning (and where to stop)

Rings fire below 0.7 for a piece, 0.35 for an empty square. The empty bar moved
twice on real scans; the piece bar was left alone deliberately, because pooled
evidence shows real errors and correct pieces INTERLEAVED in 0.549-0.659:

    0.70 -> catches 6 of 7 known errors, 2 false rings
    0.55 -> catches 1 of 7,               0 false rings

No threshold separates them, so two false rings is the right price. The seventh
error (a knight read as a bishop at 0.926) is uncatchable by confidence and is
what the piece-count and colour-balance rules exist for.

## Open

- Extractor retrain running on 40,234 composites; **validate before installing**
  (`validate_extractor.py` runs both models over the same suite and prints a
  verdict). Current weights back up automatically.
- `classifier_train.py` still hardcodes the 21,570-image pile while 405,170 sit
  unread. The classifier is the weak part now.
- Orientation from coordinates: the generator emits ground truth, nothing reads
  it yet. `BoardEditor` still ships a manual "Rotate 180°" button.
- ChessVision oracle: still only missing `CHESSVISION_API_KEY`.
- TKT-166 / 200 / 201 all still OPEN and need replies.
- ⚠ `/etc/nginx/sites-enabled/chessguru-results.bak-ws-1788799489` is a backup
  in an INCLUDED directory. Harmless today; I hit the same trap myself.
