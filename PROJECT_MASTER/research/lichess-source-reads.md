# Research: Lichess (`lila`) source reads

ChessGuru deliberately mirrors Lichess behaviour. These notes record which `lichess-org/lila`
sources were read (via the GitHub contents API) and what was ported from each.

## Rating
- Glicko-2 implementation and constants → `glicko2.js` (see ADR-0003). Constants copied verbatim
  (TAU=0.75, SCALE=173.7178, RATING_FLOOR=400, MAX_DEVIATION=500, MIN_DEVIATION=45, etc.).

## Puzzle selection
- `PuzzleSession.scala` + `PuzzlePathApi.nextFor` → the in-memory `_sessions` model in `routes.js`
  (pre-sampled puzzle IDs per rating band, flush on drift/theme change, quality-tier fallback).

## Puzzle feedback UI (read from `ui/puzzle/src/view/`)
- `feedback.ts` — exact "Your turn" + hint/solution structure (see plans/feedback-ui-lichess-exact.md)
- `main.ts` — puzzle control layout
- `side.ts` — userBox structure

## Data model
- The `users` / `userperfs` document shapes in `models.js` mirror Lichess's perf structure (one
  perf per game type, Glicko sub-doc `{r,d,v}`).

## Source
Read via: `https://api.github.com/repos/lichess-org/lila/contents/<path>`
