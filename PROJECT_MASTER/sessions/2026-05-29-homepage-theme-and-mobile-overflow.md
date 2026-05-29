# Session log: homepage theme picker + mobile overflow fixes

**Date:** 2026-05-29

## Changes made

### 1. Surfaced the puzzle-theme picker on the homepage (`public/index.html`)
The theme `<select>` existed but was buried in the nav bar (small, grey, unlabeled, and off-screen
behind the nav's horizontal scroll on mobile) — so it read as "no way to choose theme".
- Removed the `<select id="themeSelect">` from `<nav>`.
- Added a labeled **Theme** row (`.sc`) directly above the **Difficulty** row in the puzzle-controls
  panel. Kept `id="themeSelect"`, so the populate-from-`/api/themes` and `changeTheme()` logic was
  unchanged.

### 2. Fixed mobile horizontal overflow on home, blindfold, theme pages
Pages "slightly slid right" on phones. Cause: the board was forced to `width:100vw` (which includes
scrollbar width and ignores `main`'s 4px padding), so the board + coordinate labels spilled ~13px
past the viewport; overflow was only clipped on `body`, only at ≤600px.
- `public/index.html`, `public/blindfold.html`, `public/theme.html`:
  - `.cg-wrap/#board` board rule `width:100vw` → **`width:100%`** (fit the padded parent).
  - Added **`html,body{max-width:100%;overflow-x:hidden}`** globally (was only `body`).

## Verification (Playwright, real browser)
- Home: overflow 0 at 360 / 390 / 414 px (was +13px at 390).
- Blindfold: overflow 0 at 360 / 414 px.
- theme.html: overflow 0 at 360 / 414 px.
- `/api/health` → HTTP 200 throughout; all three pages serve 200.

## Backups (reversible, in `archive/public/`)
`index.html.bak-theme-20260529-123024`, `index.html.bak-overflow-20260529-123436`,
`blindfold.html.bak-overflow-20260529-123724`, `theme.html.bak-overflow-20260529-123724`.

## Notes / open
- The same picker isn't on other pages; not requested.
- Off-screen nav links remain inside the nav's own `overflow-x:auto` (clipped, harmless).
