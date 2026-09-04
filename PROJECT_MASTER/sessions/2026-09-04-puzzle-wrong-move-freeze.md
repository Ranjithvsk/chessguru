# 2026-09-04 — Puzzle trainer: board freezes after a wrong move + double rating deduction

Owner report (Harinitha Ranjitha, playing the puzzle trainer):
1. "when the wrong move is played, the website is stucked — the user can't play any other move"
2. "if the wrong move is played second time, points are reduced 2 times for same puzzle"

The two are the same incident: (1) freezes the board, the student reloads to escape it,
and the reload re-arms the client-side guard that was supposed to prevent (2).

## Root causes

**1. Frozen board — `apps/web/src/hooks/usePuzzleGame.ts`**

Chessground clears `movable.dests` and flips `turnColor` internally on every accepted
user move (`baseUserMove`). It must be re-pushed by us afterwards.

On a wrong move we roll the position back to the *same* FEN, so:
- `setFen(sameString)` → React bails, `fen` state unchanged;
- `dests` was `useMemo(..., [fen])` → identical Map identity handed to `<Board>`;
- Board's "sync everything but the fen" effect (deps include `dests`) never fired;
- chessground kept `dests === undefined` → **no piece could even be selected**.

Latent since the 2026-09-03 split of Board's single sync effect into two. The old single
effect re-fired on the fresh `lastMove` array and incidentally re-pushed `dests` too.

Fix: feed the existing `force()` re-render counter (`syncTick`) into the `dests` memo deps,
so a rollback produces a fresh Map identity and the Board sync effect re-arms chessground.

**2. Double deduction — `apps/api/src/puzzles/puzzles.service.ts`**

`complete()` had no "already attempted" guard: every call moved the Glicko rating. The
client guards with `failed.current`, but that is per-mount — a reload (which the freeze
forced) resumes the same puzzle from localStorage with the flag reset, so the second miss
was charged again for the same puzzle.

Fix: SAFEGUARD 5 — a repeat attempt at a puzzle the user already has a `rounds` row for is
UNRATED (`ratingDiff = 0`, no `userperfs` write, no `nb` bump). Matches Lichess (only the
first attempt counts). The round row and homework auto-credit still run. The picker already
excludes played ids, so this only triggers on review / daily / reload paths.

**3. Drive-by:** `retry()` called `setElapsedMs(0)`, which is not defined anywhere —
`tsc` flagged it (`TS2304`) and it threw a ReferenceError at runtime. Line removed.
(`tsc -b` isn't gating deploys: the web tree has ~100 pre-existing type errors.)

## Files
- `v2/apps/web/src/hooks/usePuzzleGame.ts`
- `v2/apps/api/src/puzzles/puzzles.service.ts`

## Verification
Reproduced and re-tested on live chessguru.cc as a guest (puzzle `#08IFn`, Qg2#):
- BEFORE: wrong move → clicking any piece produced no `square.selected`; chessground state
  showed `movable.dests === undefined`. Board completely dead.
- AFTER: wrong move → `movable.dests` repopulated (`b7: a8 c8 c6 d5 e4 f3 g2 h1`),
  `turnColor: black`. Played wrong → wrong again → correct `g4g2` → "Solved! / Well played".
- API: `tsc --noEmit` clean; `chessguru-v2-api` restarted, `/api/puzzles/random` 200.

## Open items
- SAFEGUARD 5 verified by code + typecheck only; not exercised against a signed-in account.
  Worth a spot-check on a real student the next time a puzzle is missed twice.
- Board's two sync effects still can't restore the position when a puzzle has no `lastMove`
  (`setLastMove` would no-op, so effect 1 never fires). Not reachable today — every served
  puzzle carries a `lastMove` — but it is the same class of bug.
