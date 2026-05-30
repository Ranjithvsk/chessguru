# Session 2026-05-30 — board: white light squares + dark dark squares

**What:** Owner wanted higher contrast — light squares white, dark squares darker. Overrode the
chessground "brown" theme on the live v2 React app.

**How:** chessground.brown.css sets `cg-board` light = `background-color:#f0d9b5` + dark = a 20%-black
SVG overlay. Added an override in `apps/web/src/index.css` (after the chessground imports):
```
.cg-board-wrap cg-board {
  background-color: #ffffff !important;   /* light squares */
  background-image: repeating-conic-gradient(#454545 0deg 90deg, #ffffff 90deg 180deg) !important; /* dark */
  background-size: 25% 25% !important;
}
```
A 25% conic tile = a 2x2 checker → 8x8 board; bg-color shows the white squares, the dark quadrants paint
the dark squares. Move-dest/last-move/check overlays (on `square` elements) are unaffected.

**Verified (live, screenshot):** light = white, dark = #454545, parity correct (a1 dark / a8 light),
pieces still legible (cburnett outlines). Rebuilt + redeployed via `deploy.sh`.

**Note:** static build — `deploy.sh` re-publishes to /var/www/chessguru (+ /v2). #454545 is a neutral
dark; bump to taste (or a dark green) if more piece contrast wanted.

**File:** `v2/apps/web/src/index.css`.
