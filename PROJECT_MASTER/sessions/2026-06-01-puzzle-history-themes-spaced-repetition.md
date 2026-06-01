# 2026-06-01 — Puzzle history, report page, themes, spaced repetition

Session covering puzzle-trainer correctness + features on the live v2 site.

## Fixes
- **Solves never submitted (stale closure).** `Board.tsx` creates chessground once, so
  `movable.events.after` captured the first-render `onMove` (puzzle still `undefined` →
  `submit()` bailed on `if(!puzzle)`). Move detection worked (refs) which masked it →
  rating never moved for wins OR losses. Fixed by routing onMove/onPremove/onSelect through
  refs kept current each render.
- **Solve identity from session.** `/api/puzzles/:id/complete` now derives userId from
  `req.session.userId` (not the request body) — robust to a stale cached `/auth/me`, and
  closes a spoof hole. Rounds now also store `rd` (rating Δ), `r` (rating after), `pr`
  (puzzle rating), `th` (themes), `k` (mode).
- **Wrong move now reverts on the board** (was left in place because `setFen` got the same
  string → no re-render; re-assert lastMove ref to force a re-sync).
- **Rating pools were floor-biased** (`gen_paths2` took the lowest-rated 50/band → everyone
  saw the band floor, e.g. always 1000). New `gen_paths3.js` samples ~6 puzzles at 10 rating
  sub-points/band (cheap indexed queries, builds into `paths_new` then atomic-swaps).
- UI: board = white light / blue dark squares; no legal-move dots; "Next" button beside the
  heading shown only after solving.

## Features
- **Puzzle report / history page** (`/history`): summary (attempted/solved/win-rate/rating),
  recent puzzles grouped by **date → theme**, each a **mini board image** (viewOnly
  chessground) with a **green outline = solved / red = missed**; lazy-mounted (IntersectionObserver)
  + cache-busted fetch. Endpoint `GET /api/me/history` (session-scoped).
- **+7 Lichess themes** (data already tagged): master, masterVsMaster, killBoxMate,
  vukovicMate, pillsburysMate, morphysMate, swallowstailMate. Added to `THEMES` + `gen_paths3`;
  pools rebuilt 4299 → 4740.
- **Spaced repetition (history-driven dedup):** SOLVED puzzles are never repeated for a user;
  FAILED puzzles return after **REPEAT_FAILED_DAYS = 7** (was 14, lowered 2026-06-01). Exhausted
  pools skip to the fresh `$sample` fallback instead of repeating. Cap: most-recent 5000 attempts.

## Verified
- Rating engine is **Lichess-exact Glicko-2** (SCALE 173.7178, vol-convergence loop, tau 0.75).
  harinitharanjith: 65 solves today, 1002→1421, per-puzzle Δ chains correctly. Fast rise was a
  legit correction from an under-calibrated 1002 (earlier save bug), now settled ~1420.
- Spaced repetition: 15 draws as harinitharanjith → 0 of her 52 solved puzzles returned.
