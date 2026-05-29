# Session log: enlarge puzzle board on tablet/desktop

**Date:** 2026-05-29 · file: `public/index.html`

## Problem
On a 13.3" tablet the board looked small: it was capped at `clamp(...,660px)` and the layout was
capped at `max-width:1100px`, so the board sat ~660px with large side margins.

## Fix (base / non-mobile CSS)
- `.pb` width: `clamp(280px,55vw,660px)` → `min(62vw, calc(100vh - 96px), 880px)` — the board now
  scales with the viewport, is bounded by height (so it never overflows vertically), and caps at
  880px on large screens.
- `main` `max-width:1100px` → `1300px` — uses more of wide screens (less wasted margin).

Mobile (≤700px) is unaffected — it keeps its own `.pb`/`main` overrides from the earlier
centering fix.

## Verified (Playwright @ 1366×768)
- Board 660 → **672px**, fills to bottom 742 (within 768). On 1280×800 ≈ 704px; scales to 880 cap.
- Layout margins 133px → 33px (main 1300 wide). No horizontal overflow. ~30px vertical scroll
  (move-list row) — acceptable.

## Backup
`archive/public/index.html.bak-boardsize-20260529-132111`.

## Note
Applied to the main puzzle page (`index.html`). `theme.html`/`blindfold.html` can get the same
treatment if wanted.
