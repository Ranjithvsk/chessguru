# ADR-0003: Glicko-2 rating is a Lichess-exact port

**Status:** Accepted · **Date:** 2026-04-25 (documented 2026-05-29)

## Context
Ratings were initially hardcoded to 1500 on every page load — not persisted, not per-user. The
project wanted Lichess-identical rating behaviour.

## Decision
`glicko2.js` is a direct port from `lichess-org/lila` (read via the GitHub API). Constants are
frozen to match Lichess:

```
DEFAULT_RATING=1500  DEFAULT_DEVIATION=500  DEFAULT_VOLATILITY=0.09
TAU=0.75  RATING_PERIODS_PER_DAY=0.21436  SCALE=173.7178
MAX_DEVIATION=500  MIN_DEVIATION=45  MAX_RATING_DELTA=700  RATING_FLOOR=400
```

Per-user ratings live in `userperfs.puzzle.gl` ({r, d, v}); blindfold has its own perf
(`userperfs.blindfold`, default rating 800). Ratings update on every
`POST /api/puzzles/:id/complete`. Guests use a default 1500/500/0.09 perf and do not persist.

## Consequences
- Do not tune these constants — they are intentionally Lichess-identical.
- Verified live: WIN vs a 2200 puzzle ≈ +36; LOSS vs an 800 puzzle ≈ −36; RD converges to a ~83
  floor after ~50 rapid plays.
- Rating flow: page load → `GET /api/me/rating` seeds the client → solve → `POST …/complete`
  runs `updatePuzzleRating()` and saves back to `userperfs`.
