# Session 2026-05-31 — rating not changing on solve (navbar didn't refresh)

**Symptom:** rating doesn't change after solving a puzzle.

**Verified working (data path):** complete endpoint persists correctly — logged-in solve via
POST /api/puzzles/:id/complete returns ratingDiff and writes userperfs; a fresh /api/me/rating reflects
the new value (tested 1500 -> 1727 in-browser with a real session cookie). Server + persistence are fine.

**Cause (UI):** the navbar "Rating" comes from the `["me-rating"]` react-query, fetched once on load and
**never invalidated after a solve**, so it stayed frozen during a session. (The puzzle sidebar
`displayRating` does update via `submit()`, but the prominent navbar number didn't.)

**Fix:** `usePuzzleGame.submit()` now `qc.invalidateQueries({ queryKey: ["me-rating"] })` on a completed
attempt, so the navbar rating refreshes live. Built + redeployed via deploy.sh.

**Note:** rating only changes on the FIRST-attempt outcome (clean solve = gain, first wrong move = loss);
using a hint or erroring then solving awards nothing — by design (Lichess parity). Couldn't auto-drive a
board solve (chessground ignores synthetic pointer events), so the on-board solve->submit chain is
verified by source + the proven data path; owner to confirm a real solve while signed in (reload first
for the new bundle/SW).

**File:** `v2/apps/web/src/hooks/usePuzzleGame.ts`.
