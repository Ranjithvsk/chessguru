---
date: 2026-08-20
topic: Openings hub — Lichess-style notation table + 3-column layout (Find left of board)
---

# What

Owner asks (2026-08-20, follow-ups to same session):
1. "Also make notation bar for moves like Lichess style — white left, black right."
2. "Move 'find the opening' left to the board, and board size should remain same."

# Changes

## 1. Two-column mainline notation table (`MainMoveTable`)

`v2/apps/web/src/components/OpeningExplorer.tsx`

- New `MainMoveTable` component walks the mainline once and lays it out as
  `grid-cols-[2rem_1fr_1fr]` rows: `[moveNo | white | black]`.
- Variations spawning from a mainline node still render as indented blocks
  UNDER the row that spawned them (via the existing `MoveTreeLine`
  inline flow). Nested sub-variations keep the inline treatment so they
  read like Lichess's PGN prose.
- Right-click context menu still works on every cell (button-per-move).

The caller now uses `MainMoveTable` for `fp.tree[0]` and keeps `MoveTreeLine`
for root-sibling variations.

## 2. Three-column layout (Find | Board+Moves | Explorer)

`v2/apps/web/src/components/OpeningExplorer.tsx`
- New optional prop `preBoardExtra?: React.ReactNode` renders into a new
  left aside. Grid switches to `lg:grid-cols-[240px_minmax(0,1fr)_400px]`
  when the prop is provided; otherwise the classic two-col layout stays.

`v2/apps/web/src/pages/OpeningsHub.tsx`
- The `NameFinder` card is passed as `preBoardExtra` (left of board).
- `MyRepertoirePanel` stays in `asideExtra` (right rail, below Explorer).
- The `<section>` wrapping `OpeningExplorer` breaks out of the app-wide
  `max-w-6xl` shell on `lg+` via `lg:mx-[calc(50%-50vw)] lg:w-screen lg:px-4`.
  Without this, adding a 240px left column pushed the middle column to
  ~432px and shrunk the board from 552 → 432. With the escape-hatch, the
  section spans the viewport and the middle column stays wide enough
  that the board's own CSS cap (`min(100%, calc(100dvh - 10.5rem))`
  = 552px on 720dvh) still governs the size.

# Verification

Playwright on prod at 1280×720:

- Board measured **552×552** (identical to pre-change).
- Grid class: `grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)_400px]`.
- Left aside `🗂️ Find an opening` at x=16, width 240.
- Right aside `Opening explorer` at x=864, width 400.
- Played 1.e4 e5 2.Nf3 Nc6 3.Bb5. Moves box rendered:
  - Row 1: `1.` · `e4` · `e5`
  - Row 2: `2.` · `Nf3` · `Nc6`
  - Row 3: `3.` · `Bb5` · (empty)
- Rewound to root, clicked `d4` in the Explorer → root-sibling variation
  block rendered below the mainline table with the cursor highlight on
  `d4`. Screenshot saved to `.playwright-mcp/`.
- Right-click menu still works from prior session's implementation
  (Promote / Make main line only on variation cells; Delete / Copy PGN
  always).

# Deploys

- `bash v2/scripts/deploy.sh` twice — once for the table, once for the
  layout adjustment.

# Open items

- On smaller viewports (< lg), the layout collapses to a single stacked
  column: Find → Board → Moves+Explorer → Repertoire. Acceptable — no
  regression from before.
- If the app-wide shell is ever bumped to `max-w-7xl`, the escape-hatch
  on OpeningsHub can be removed (the extra width would satisfy the
  board-size constraint natively).
