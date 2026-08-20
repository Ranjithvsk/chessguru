---
date: 2026-08-20
topic: Openings hub — move list to right rail + Lichess-style right-click menu
---

# What

Owner asks (2026-08-20):
1. "In learn openings, moves are showed in bottom, need that in right before opening explorer."
2. "https://lichess.org/analysis/pgn/d4#2, right-click on a move shows options; on a sub-variation move it shows additional options like promote variation, make main line. Need these features."

# Changes

## 1. Moved the Moves tree from the left column into the right rail

`v2/apps/web/src/components/OpeningExplorer.tsx`

- The clickable PGN tree used to sit inside `<section>` under the board.
- Now it's the first block in `<aside>`, ABOVE the Opening explorer masters table.
- The `asideExtra` slot (Find-opening + My Repertoire) still appears after
  the Opening explorer as before.

## 2. Right-click context menu on any move

`v2/apps/web/src/hooks/useFreePlay.ts`

Added three tree-mutating operations and exposed them from the hook:
- `promoteVariation(p)` — swaps the child at `p[last]` with its left sibling
  at the parent (one step toward mainline for that branch point). No-op if
  `p[last] === 0`.
- `makeMainLine(p)` — for every ancestor along `p` where the index > 0,
  swaps that child into position 0; also rebuilds cursor to walk the
  now-mainlined path. Fully mainlines the branch.
- `deleteFrom(p)` — splices out the node at `p` and its subtree; cursor
  jumps to the parent and the board replays that position.

`v2/apps/web/src/components/OpeningExplorer.tsx`

- New `moveMenu` state: `{ path, x, y } | null`. Set by right-click on a
  move button (`onContextMenu` handler, `e.preventDefault()` blocks the
  browser menu). Closes on outside `mousedown`, `Escape`, or scroll.
- Menu items:
  - **Promote variation** — visible only when any `path` index > 0.
  - **Make main line** — visible only when any `path` index > 0.
  - **Delete from here** — always shown.
  - **Copy PGN to here** — always shown. Uses `sansAtPath()` to walk the
    tree along the path and `formatPgn()` to prefix with move numbers.
- The menu is a fixed-position `<div>` clamped to the viewport.

`MoveTreeLine` gained an `onContext` prop and passes it recursively into
nested variation blocks so right-click works at any depth.

# Verification

Playwright on `https://harinitharanjith.com/openings`:

1. Cleared persisted freeplay, clicked `e4` in the explorer → mainline
   `1. e4`. Rewound to root (Home key). Clicked `d4` → variation `1. d4`
   at path `[1]`.
2. Right-clicked `d4`: menu opened with all 4 items — Promote variation,
   Make main line, Delete from here, Copy PGN to here.
3. Clicked "Make main line" → tree flipped: mainline became `1. d4`,
   variation became `1. e4`. Cursor stayed on `d4`. Menu closed.
4. Right-clicked the new mainline `d4`: menu opened with only 2 items —
   Delete from here, Copy PGN to here. Promote/Make main line correctly
   hidden because path index is now `[0]`.

Verified via the DOM (aside → first div → button structure + `[role=menu]`
inspection). No console errors during any of these steps.

# Deploy

- `bash v2/scripts/deploy.sh` (two builds — first for move-list-in-rail,
  second for the context menu after adding the mutators + UI).
- SW cache version bumped by the deploy script per usual.

# Open items

- None. Possible follow-ups if owner wants to match Lichess even closer:
  * Add "Copy FEN of position" to the menu.
  * Add "Cut variation" / "Paste variation" if we ever want cross-line
    surgery.
