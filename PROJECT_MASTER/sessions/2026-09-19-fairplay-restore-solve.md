# 2026-09-19 — Give back the rating a flagged solve was denied

## Why

The fair-play detector withholds the rating on a suspicious win: `ratingDiff = 0`,
no per-theme movement, no increment to the solve counter. The solve is recorded and
shown to the coach, but the points are gone.

Asked to check whether a coach could undo that, the answer was no. There were three
actions and none of them restored anything:

* **Clear** — restarts the window, lifts a hold, drops the student off the list. Never
  touches a rating.
* **Hold** — stops future gains.
* **Reset** — clamps per-theme ratings *down* to a target. Punitive.

So a false positive cost a student real rating permanently, and a coach who reviewed a
flagged solve and judged it genuine had no way to act on that judgement.

31 flagged and 46 held rounds exist in production right now, every one of them a win
with `rd: 0`.

## What changed

`fairplay/fairplay.service.ts` — new `restoreSolve(userId, academyId, by, puzzleId, note)`:

* Refuses anything that isn't a withheld win: no round, already restored, a miss, not
  flagged or held, or a round whose `rd` is already non-zero.
* **Same permission split as Clear** — a coach can restore a flagged solve; once the
  student's gains are on `hold`, only the owner can.
* Recomputes the delta with `updatePuzzleRating` against the student's **current**
  rating, not the one they held at the time. Deviation and volatility are not stored on
  a round, so the original update cannot be replayed exactly, and applying a delta
  derived from a stale rating to today's rating would be incoherent. The student gets
  what the puzzle is worth to them today — the same thing they'd get by solving it now.
* Per-theme tracks move too, mirroring the solve path exactly: same model, same ±300
  clamp against the new global.
* Fatigue is **not** reapplied — the 30-minute same-theme window can't be reconstructed
  after the fact. A flagged solve is a single fast win rather than a grind, so the gap
  is small and it errs toward the student, which is the right direction for a call the
  coach has decided went against them unfairly.
* Stamps `restoredAt`/`restoredBy`/`restoredNote` on the round (blocks a second credit)
  and writes a `fairplayEvents` row with `kind: "restore"`, `label: "honest"`, so the
  fitted model learns from it the way it learns from a Clear.

`fairplay/score.ts` — a restored round keeps `dub`/`dubr` as the record of why it was
caught but stops counting as a flag. Done inside `withRetroFlags` rather than at the
call sites, so the retro replay can't simply re-flag an old solve the coach cleared.

`glicko/glicko.ts` — `UNRATED_THEMES` moved here from `PuzzlesService.UNRATED`, which
both services now share. Importing the puzzles service into fairplay would have been a
cycle (puzzles already depends on fairplay).

`academy.service.ts` / `academy.controller.ts` — `POST /api/academy/suspicious-solves/
:id/restore/:pid`, rostered the same way as the other coach actions.

`web/.../AcademySuspiciousPanel.tsx` — the drawer had no per-solve list at all, only
charts. New **Withheld solves** section lists each win that earned nothing, with its
reason, and a Restore button per row. Restored rows show a badge instead.

## Verification

* API type-check clean. Web held at its pre-existing 91 errors, none in the touched files.
* Read-only dry run of the recompute over six real flagged rounds: +13 to +26 points,
  solve counter +1, puzzle and themes resolved on every one. Nothing written.
* Deployed with no class live. `/api/health` 200; the new route answers 403 unauthenticated
  (guard working). All four new UI strings present in the published bundle.

## Open

* Not yet exercised end-to-end by a coach against a real student — the dry run covered
  the arithmetic, not the click path.
* A restore moves the rating but does **not** recompute the student's fair-play score on
  the spot; that happens on the next scoring pass, which will then see one fewer flag.
