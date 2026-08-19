# 2026-08-19 — Inline wiki-book panel in OpeningExplorer

## What
Every move played in the Opening Explorer (from ply 1 onward) now surfaces
the matching corpus opening's idea + Wikibooks excerpt inline in the right
rail — matches the lichess.org/analysis book-text behaviour the owner asked
for. Previously the explanation only appeared on the standalone
`/openings/:slug` detail page.

## Why
Owner ask (2026-08-19): "here after making 2 moves, the wiki books explains
every move in detail, need like this" and follow-up "not 2 moves, even if
one move is played, the reason for that move and idea all come in that wiki
book". Corpus already carries the data (`OpeningIdea.wikibookExcerpt`,
`OpeningIdea.long`, plans) — it just wasn't wired into the Explorer.

## Files
- `apps/web/src/lib/openings/index.ts` — added `findOpeningForLine(sans)`:
  scans `OPENINGS` for the longest-prefix `pgnStart` match against the played
  SAN sequence. Powers the panel's "which opening is this line under?"
  lookup on every move.
- `apps/web/src/components/OpeningIdeaPanel.tsx` (new) — reusable panel
  extracted from `OpeningDetail.tsx`. Renders ECO + name header, curated
  `idea.short` and `idea.long` when present (pillars), else
  `idea.wikibookExcerpt` with a "read on Wikibooks" link (generated tier).
  Plans in a 2-col grid. `compact` prop shrinks paddings/text for the
  Explorer aside; full for the dedicated detail page.
- `apps/web/src/components/OpeningExplorer.tsx` — imports
  `findOpeningForLine` + `OpeningIdeaPanel`, memoises
  `bookOpening = findOpeningForLine(fp.history)`, renders the compact panel
  in the right rail directly below the moves table (before `asideExtra`).

## Verification
- `pnpm --filter @chessguru/web exec vite build` clean (existing tsc noise
  in unrelated files remains — pre-existing, out of scope).
- Deployed via `scripts/deploy.sh`: `Published: /var/www/chessguru`.
- Manual: `/openings` → hub renders Explorer inline; playing `1.e4` shows
  the King's Pawn book text; drilling into `1.e4 c5 2.Nf3 d6 3.d4 cxd4
  4.Nxd4 Nf6 5.Nc3 a6` swaps to the Najdorf entry.

## Open items
- None on the panel itself. If the owner wants the panel on the LEFT under
  the board instead of in the right rail, it's a one-line reflow (move the
  `<OpeningIdeaPanel>` above the `</section>` close).
- Pre-existing tsc errors in `MoveTreeLine` + `StudyChapterEdit` still
  block `pnpm build` (`tsc -b && vite build`). Not related to this change.
  `vite build` alone works.
