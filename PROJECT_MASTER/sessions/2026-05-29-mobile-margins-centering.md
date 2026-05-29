# Session log: mobile margins / board centering

**Date:** 2026-05-29 (follow-up to the overflow fix)

## Problem
After the overflow fix, on mobile the board was full-bleed while the text panel was inset, so the
left/right margins looked uneven, and the board's right-edge rank coordinates were clipped (right
parts not visible) because `overflow-x:hidden` hid the few px that still overflowed.

## Fix (uniform ~16px gutter, board centered, coords fit)
- `public/index.html` (≤700): `.pb` `width:calc(100vw - 8px)` → `width:calc(100vw - 32px);max-width:560px;margin:0 auto` — board now centered at the same 16px gutter as the `.ps` panel content; coordinates fit.
- `public/theme.html` (≤700): `main` padding `6px 6px 24px` → `8px 16px 24px`; `.pb` `overflow:hidden;width:calc(100vw - 12px)` → `overflow:visible;width:100%` (panel `.ps` already 0 h-padding → aligns at the 16px gutter).
- `public/blindfold.html` (≤780): `#boardWrap`/`#rightCol` `min(98vw,480px)` → `min(calc(100vw - 32px),480px)` — accounts for `#main`'s 16px padding so they fit and center.

## Verified (Playwright @ 390px)
- index: board + panel both 16→374, nothing past viewport.
- theme: board + panel both 16→374, maxRight 0.
- blindfold: board + rightCol both 16→374 (only chessground's bottom file-letter overlay reaches
  398 — cosmetic, clipped).

## Backups (archive/public/)
`theme.html.bak-align-…`, `blindfold.html.bak-align-…` (index covered by prior bak files).

## Open / minor
- Blindfold's chessground `COORDS.files` overlay sits ~8px wide of the board (board-render quirk).
