---
date: 2026-09-02
topic: annotation toolbar — Phase 4 (text-label) + Phase 5 (pins overlay)
---

# What
Continued the on-board annotation module opened Phase 1 (owner ask 2026-09-02
"arrow and click to highlight square, and show a patterns other features").

- **Phase 4** — Text-label tool (🅐). Coach picks a PGN glyph preset
  (`!`, `?`, `!!`, `??`, `!?`, `?!`, `⊕`, `⊖`) or types a custom label,
  then clicks squares to drop it. Uses chessground's native `label`
  shape support; broadcasts over class-ws via the existing annot frame
  (server relays raw shape objects, no server change needed). Last-picked
  label persists in `localStorage:cg_annot_textlabel`.
- **Phase 5** — Pins overlay (📌). Auto-highlights every absolute pin on
  the board (both sides) — yellow ring on pinned piece + red arrow from
  pinner. Ray-cast from each king in 8 directions using chess.js's
  `board.get(sq)`. Local-only like Phase 2's attack overlay.

Phase 3 was folded into Phase 2 (shape broadcast was already transparent
via the WS relay — no separate code needed, hence the phase-number gap).

# Why
Owner's Phase 1 brief specifically included "show a patterns other
features". Phase 2 gave one pattern (attack overlay). Phase 5's pins are
the second-most-teachable pattern for an academy — a coach can now say
"look, black's knight is stuck" without drawing anything.

# Files
- `apps/web/src/components/AnnotationToolbar.tsx` — `TEXT_PRESETS`, `computePinShapes`, `pinsMode` state, toolbar buttons.
- `apps/web/src/components/OpeningExplorer.tsx` — wire `textLabel` + `pinsMode` props; overlay pins into shape array.
- `apps/web/src/components/SharedClassBoard.tsx` — same wiring for Dream Meet class board.

# Commits
- `aa02754 feat(annotation): Phase 4 — text-label tool (PGN glyphs)`
- `c9c9186 feat(annotation): Phase 5 — 📌 pins overlay`
- `51f8da0 fix(annotation): Phase 5 — wire pins overlay into Dream Meet SharedClassBoard` — c9c9186 lost the SCB hunk during a mid-flight rebase (parallel commit shifted HEAD while splitting a dirty tree).

# Verification
- `npx tsc --noEmit` — 0 new errors in the three files (pre-existing errors unchanged).
- `bash scripts/deploy.sh` — vite build clean in 23s; sw.js stamped `cg-20260902062259`; rsync'd to `/var/www/chessguru/`. Users see Phase 4 + 5 on next refresh.

# Open items
- **Phase 6+ candidates**: fork-detector overlay (🍴), hanging-piece overlay, discovered-attack potential. Cross-tool still renders as a red circle (Phase 2 commit noted "proper ✕ SVG overlay is a Phase 2 polish" — never done).
- Consumer-side callers of `AnnotShape` still pass through `as any` casts to Board.tsx — worth tightening once Board's own shape prop type is widened.
- Not visually tested in production yet (owner should confirm 📌 renders pins correctly on Dream Meet + /openings).
