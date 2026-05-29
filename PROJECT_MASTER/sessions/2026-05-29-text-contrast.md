# Session log: text contrast fix (grey-on-black readability)

**Date:** 2026-05-29

## Problem
Lots of text was hard to read — light grey on the near-black background. Root cause: the grey ramp
variables `--g1:#888` and `--g2:#555` drove body/secondary/muted text. On the `#0f0f0f` background,
`#555` muted text was only ~2.6:1 contrast (fails WCAG AA), and `#888` body text ~5:1 (borderline).

## Change
Raised the grey ramp in `public/index.html`, `public/theme.html`, `public/blindfold.html`:
- `--g1: #888 → #b0b0b0`
- `--g2: #555 → #8c8c8c`

Variable-only change, so it lifts all body/muted text at once without touching layout, borders
(`--b4`/`--bdr`), or accent colors.

## Verification (Playwright, computed contrast vs the #0f0f0f bg)
- Muted labels (`.sc span`): 2.6:1 → **5.7:1** ✓ (passes AA)
- Body / values (`#pRating`, selects, `--cf`): ~5:1 → **8.84:1** ✓
- Headings (white): 19:1 (unchanged)
- Screenshot confirmed legibility; `/api/health` → 200.

## Backups (reversible, archive/public/)
`index.html.bak-contrast-20260529-124431`, `theme.html.bak-contrast-20260529-124431`,
`blindfold.html.bak-contrast-20260529-124431`.

## Open
- Other pages (admin dashboards, opening, board editor) still use their own greys; bump later if
  flagged.
