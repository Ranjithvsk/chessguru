# Session log: tablet layout — board fills square, controls below

**Date:** 2026-05-29 · file: `public/index.html`

## Request
On a 13" tablet, make the board cover the full square area and move the side elements (rating,
hint, theme, difficulty, move list) **below** the board instead of beside it.

## Fix
Added a tablet breakpoint `@media (min-width:701px) and (max-width:1024px)` that switches to a
single-column stacked layout (board → side → tools), with a height-aware board so it fills the
square in both orientations:
- `main` → `grid-template-areas:"board" "side" "tools"; grid-template-columns:1fr; padding:10px 16px 28px`
- `.pb` → `width:min(calc(100vw - 32px), calc(100vh - 110px)); max-width:900px; margin:0 auto`
  (portrait → width-limited big board; landscape → height-limited so it fits; centered)
- `.ps` / `.pt` → full width below, `max-width:700px; margin:0 auto`

Phones (≤700) keep their layout; desktops (>1024) keep the two-column big board from the prior
change.

## Verified (Playwright)
- Portrait 1024×1366: board **900px** centered (62px gutters), controls stacked below, overflowX 0.
- Landscape 1024×768: board **658px** (height-bound), bottom 722<768, overflowX 0.

## Backup
`archive/public/index.html.bak-tabletstack-20260529-132701`.

## Note
Applied to `index.html`. `theme.html`/`blindfold.html` not changed.
