# Session 2026-05-30 — v2 API puzzle selection: 4–6s → ~20ms (use pools)

**Symptom:** first puzzle slow, "next not loading", theme-change slow — even from the box.

**Root cause:** the v2 NestJS API (`apps/api/src/puzzles/puzzles.service.ts`) `random()` ran
`$match + $sample` over the 5.88M-doc `puzzles` collection on every request → **4–6s** (themed ~0.8s).
The v1 app avoids this with precomputed **pools** (`paths` collection) but the v2 API never ported them
(the ADR-0007 anti-pattern). The deployed React site calls the v2 API (`/v2api` → :4000), so every
puzzle fetch ate the scan.

**Fix:** `random()` now uses the `paths` pools first — key `theme|tier|RRRR`, find the band path
(`min ≤ key ≤ max`, `_id` prefix-guarded), pick a (dedup-filtered) id from `path.ids`, fetch by indexed
`_id`. Falls back to the old `$match+$sample` only for piece-count filters / exotic themes / missing pools.
Rebuilt (`nest build`) + `pm2 restart chessguru-v2-api`.

**Verified:** `:4000` and public `/v2api/api/puzzles/random` → **15–80ms** (was 4–6s), varied ids,
mix/fork/endgame/pin all fast.

**Follow-ups:** (1) browser repeated "New puzzle" returned the SAME id — likely HTTP caching of the
GET random URL; add a cache-bust param or `Cache-Control: no-store` on the endpoint. (2) client prefetch
to make next instant. (3) Cloudflare proxy for first-load network latency (owner).

**File:** `v2/apps/api/src/puzzles/puzzles.service.ts`. Pools are `pathsStale` (>24h) but functional.
