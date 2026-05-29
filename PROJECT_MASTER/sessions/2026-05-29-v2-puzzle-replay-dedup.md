# Session log: v2 — puzzle replay dedup (richer selection port)

**Date:** 2026-05-29

## Why
The v2 NestJS selector ported the old app's quality tiers but **dropped replay dedup**:
`PuzzlesService.random()` never received a `userId`, so a logged-in user could be served puzzles
they had already attempted. The old Express app excluded these via the `rounds`/`Round` collection
(keys `userId:puzzleId`). This was the "richer pool/path selection port" called out as remaining
polish in `plans/rewrite-stack-decision.md`.

## What
- **`apps/api/src/puzzles/puzzles.service.ts`**
  - New `playedIds(userId)` — range scan on the indexed `rounds._id` over `[userId:, userId;)`
    (`;` sorts immediately after `:`), most-recent-first, capped at `MAX_PLAYED = 5000`. Returns the
    puzzleId tails.
  - `random()` gains an optional `userId`. When present, builds `dedupQ = { _id: { $nin: played } }`
    and applies it to every quality tier **and** the wide fallback. Added a **final no-dedup
    fallback** so a user who has exhausted the in-band pool still gets a puzzle (replay over nothing).
  - Refactored the repeated `aggregate([$match,$sample])` into a local `sample()` helper.
- **`apps/api/src/puzzles/puzzles.controller.ts`** — `GET /api/puzzles/random` accepts `userId`.
- **`apps/web/src/lib/api.ts`** — `RandomPuzzleOpts.userId`; sent as a query param when set.
- **`apps/web/src/hooks/usePuzzleGame.ts`** — passes `userId` to `randomPuzzle` and adds it to the
  TanStack query key (so switching account/guest refetches).

## Verified
- `pnpm typecheck` + `nest build` clean; pm2 `chessguru-v2-api` restarted; `/api/health` ok.
- **Dedup:** `ranjith_vsk` has 118 rounds. 25 sequential `random?userId=ranjith_vsk` calls →
  `already-played-returned=0` (cross-checked each id against `rounds`).
- **Guest:** `random` with no `userId` still returns a puzzle (no dedup, no error).
- Web rebuilt + published to `/var/www/chessguru` (root) and `/var/www/chessguru-v2` (/v2).
- Live: `https://harinitharanjith.com/` 200; `/v2api/api/puzzles/random?userId=…` 200; health ok.

## Notes / follow-ups
- `userId` is taken from the client (query param) — consistent with the existing `complete()` which
  trusts `body.userId`. Spoofing only changes *which* exclusion set is applied (harmless). A later
  hardening pass should derive it from `req.session` for both endpoints.
- The old in-memory 200-id `PuzzleSession` pre-sample was **not** ported; `$sample` + `$nin` is
  sufficient at current scale (max ~118 rounds/user). Revisit if per-user round counts grow large
  (relates to known-issue #23 — `$where` dedup on the old app was the thing being replaced).
