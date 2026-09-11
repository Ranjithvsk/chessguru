# 2026-09-11 — My Studies gets the Dream Meet board, and chapter topic tags

## What / why

Owner asked for "an exact 1:1 copy of the Dream Meet chess board, with notation
board, except video/audio class" inside **My Studies**, to save puzzles,
positions, openings and games. Then, separately: **topic tags on chapters, with
multiple tags per chapter and grouping**.

Note the naming trap: the nav group is labelled **Notebook** and *contains*
"📓 My Studies" (`/studies`). The separate `/notebook` route is the read-only
inbox for coach-broadcast position packs. The target here was `/studies`.

## The key insight — 1:1 by construction, not by copying

`SharedClassBoard` looked class-coupled but has exactly **one seam**: every user
intent leaves through `ws.send(JSON.stringify(frame))` and every state change
arrives through `ws.onmessage`. The authoritative move tree lives server-side in
`apps/api/src/class/class-ws.ts`.

So instead of forking the board (1,895 lines) plus the notation panel (560), the
board now accepts a **loopback socket** that answers locally:

* `apps/web/src/lib/localClassRoom.ts` — the class-ws room reducer ported
  faithfully (nodesAt / pathMoves / fenAtPath / recomputeFromTree /
  extendMainlineOnce / shapesAtCursor / setShapesAtCursor / syncShapesToPosition,
  plus every board-state frame), behind a WebSocket-shaped object.
* `SharedClassBoard` gained `local` / `localInitial` / `onLocalChange`. The live
  class path is untouched apart from *which socket it builds*.
* `ClassNotationPanel` moved out of `ClassV2.tsx` into its own component **byte
  for byte** and is imported back, so the live class renders the identical thing.

**Keep the reducer in step with `class-ws.ts`.** If the server's tree semantics
change, change `localClassRoom.ts` too.

Class-only frames (hello/attendance, roles, pointer, challenge) are accepted and
ignored — a local room has one occupant and they are always the coach, so every
coach-gated control is live.

## Storage bridge

`apps/web/src/lib/studyTree.ts` converts between the flat stored move list
(`{id, parentId, ply, san, uci, fenAfter, nag:NUMBER, shapes, isRevisePoint,
isMainLine}`) and the board's nested tree (`{move:{from,to,promotion}, nag:GLYPH,
comment, shapes, children}`). Lossless both ways — all 14 glyphs map onto
standard PGN NAG codes, and node ids + the ⭐ flag ride along as passthrough
fields so a save never renumbers a chapter or strands the revision queue.

## Two silent data-loss bugs this surfaced (both fixed)

1. `validateMoves` accepted `nag` only in **1–6**, silently dropping the eight
   evaluation glyphs the notation panel can set (`=`, `∞`, `+=`, `=+`, `±`, `∓`,
   `+-`, `-+`). Now 1–19.
2. The brush allow-list was `green|red|blue|yellow` while the board has had
   **five** brushes — a **purple arrow saved as GREEN**. Now accepted.

Also: a chapter had nowhere to store arrows drawn at the **starting** position →
added `startShapes`.

## The ⭐ revise flag

Dream Meet has no equivalent, and the old editor did. Replacing the editor
without it would have quietly stopped `/revise` receiving new content, so it was
added as a local board op (`study:revise`) rather than dropped — deliberately not
a `load-tree`, which clears root arrows.

## Tags

Up to 12 free-form labels per chapter, trimmed and de-duplicated
case-insensitively but stored with the typed casing. `GET /api/studies/tags`
returns every tag with a count — **declared before `@Get(":sid")`** or "tags"
parses as a study id. The chapter list groups by topic; a chapter with several
tags appears under each, keeping its original number.

## Verification

* 25 headless reducer assertions — branching at a rewound cursor, no duplicate
  child on replay, promote/make-mainline, glyph+comment, arrows restored per
  position, lossless round trip, ids stable across a second save.
* Browser run of the **built bundle** (served locally with a stubbed API):
  notation with glyphs/comments/indented variation, board seek from notation,
  autosave payload carrying every field, tag grouping and the suggestion picker.
* Typecheck held at the repo's pre-existing 91-error baseline throughout.

## Open items

* The old editor stays routed at `/studies/:sid/edit/:cid/classic` as a
  one-release escape hatch. Remove it once the new board has had real use.
* No in-context "save to My Studies" button on the **Puzzles** or **Play /
  My Games** pages — a position can still only get there by hand. `/openings`
  already has one. This is the remaining half of "to save puzzles, position,
  openings, game play".
* `npm run build` in `apps/web` fails on the 91 pre-existing type errors;
  `scripts/deploy.sh` bypasses it with a direct `vite build`. Pre-existing.
