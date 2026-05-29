# 2026-05-29 — v2 Lichess-exact feedback UI (test harness)

## What
Built the Lichess-exact puzzle **feedback block** as a reusable React component plus an isolated
test harness, per the pending plan `plans/feedback-ui-lichess-exact.md` and ADR-0005 (test-page
workflow). Nothing is wired into the live gameplay pages yet — this lands the sandbox only.

## Why
The current per-page feedback (inline markup in `Puzzles.tsx`, duplicated in Theme/Blindfold) is a
plain title/sub line. The plan calls for a faithful port of `lila` `ui/puzzle/src/view/feedback.ts`:
the `.puzzle__feedback` block with the king `.no-square`, "Your turn / Find the best move for X",
hint + view-solution buttons, and a win/complete state with the rating delta. Building it once as a
shared component removes the three-way duplication when it is later merged.

## Files
- `v2/apps/web/src/components/PuzzleFeedback.tsx` (new) — the component. Props are driven entirely by
  the existing `usePuzzleGame` hook's `FB` union (`wait|good|bad|solved`) → state classes
  `play|good|fail|win`. Shows the cburnett king SVG for the side to move, hint button `active` vs
  `button-empty`, and a `complete` win state with rating + delta. `solutionLabel` prop lets Blindfold
  say "Reveal" instead of "View the solution".
- `v2/apps/web/src/pages/FeedbackUITest.tsx` (new) — renders all 7 states (play white/black, hint
  used, good, fail, win clean +rating, win-with-help −rating) with mock data. Route only, not linked
  from the navbar.
- `v2/apps/web/src/main.tsx` — added route `test/feedback-ui` → `FeedbackUITestPage`.
- `v2/apps/web/src/index.css` — added the `.cg-piece.king.{white,black}` standalone SVG sprites and
  the full `.puzzle__feedback` CSS (state border colours map to the existing brand/accent/rose
  palette).

## Verification
- `pnpm --filter @chessguru/web run typecheck` → clean (exit 0). Component types line up 1:1 with the
  `FB` union exported by `usePuzzleGame`.
- Visual review pending at `/test/feedback-ui` once deployed.

## Open items / next (gated)
- **Merge into production is gated on owner review (ADR-0005).** After `/test/feedback-ui` is
  confirmed visually, replace the inline feedback markup in `Puzzles.tsx`, `Theme.tsx` and
  `Blindfold.tsx` with `<PuzzleFeedback .../>`. The hook already exposes every needed value
  (`fb`, `turnColor`/`orientation` for pov, `hinted`, `solved`, `displayRating`, `ratingDiff`,
  `showHint`, `viewSolution`, `next`, `isFetching`).
- Decide the pov source per page: Puzzles/Theme = `orientation`; Blindfold = same, with
  `solutionLabel="Reveal"`.
