# 2026-09-04 — Puzzle trainer: 26s next-puzzle load + same puzzle repeating

Owner reports, both for **harinitharanjith** (1359 rounds, rating 1261):

1. "the next puzzle is loading slow and late after solving one puzzle"
2. "AND SAME PUZZLE IS REPEATED FOR HARINITHA WHY..?"

Both turned out to be the **same root cause**: the precomputed `paths` pools held only
50 puzzle ids each, and an active student clears them.

## Diagnosis

`GET /api/puzzles/random` on the Nest API (:4000) measured **25–27s** for her, vs 11ms
for `gunachess` and 6ms for a guest.

*(Note: `server3.js` on :3000 also answers `/api/puzzles/random` and is fast. The web app
uses `VITE_API_BASE=/v2api` → Nest :4000. Timing :3000 is a red herring.)*

`$currentOp` caught the real query — an `aggregate` on `chessguru.puzzles`,
`IXSCAN {glicko.r:1}`, `$match {glicko.r:{$gte:1021,$lte:1335}, vote:{$gte:0.75},
plays:{$gte:100}, _id:{$nin:[…1348 ids]}}`, 26s running.

Chain of events:

- Her effective picker `target` is ~1178 → pool band `mix|*|1200` (covers 1100–1199).
- Every `paths` pool holds **exactly 50 ids** (4755 pools, built by `gen_paths3.js`
  with `TARGET=50`).
- She had played all 50 across `top`, `good` **and** `all` → fast path yielded nothing.
- So every request fell into the `$match` + `$sample` fallback, which samples a band
  containing **990,306** puzzles.
- The `$nin` dedup was **not** the cost: 24,069ms with it, 24,748ms without. `$sample`
  itself is the cost.

For the repeats: `playedIds` excludes solved puzzles forever but re-admits **failed**
ones after `REPEAT_FAILED_DAYS = 7`. She has **328 failures older than 7 days**, all
back in the draw. Since the 50-id pools contained almost nothing she hadn't already
attempted, "available" was *entirely* old failures. Measured before the fix: **10 of 10
consecutive draws were puzzles she had already attempted.**

Also confirmed she had cleared **all 15 pools** overlapping her flex window
(5 bands × 3 tiers), so no amount of neighbour-searching alone could find her a new puzzle.

## Fixes

### 1. Neighbour-band failover in the fast path — `puzzles.service.ts`

Previously the fast path looked up the ONE pool containing `target`. Now it fetches every
pool whose band overlaps the same `flex` window the fallback uses (clamped below by
`easyFloor` so it can't bleed into the 900-rated bucket), sorted nearest-band-first, and
walks them. The `{min:1,max:-1}` index on `paths` serves the overlap query.

### 2. Prefer never-seen puzzles over re-eligible failures — `puzzles.service.ts`

`playedIds` now returns `{ exclude, attempted }` instead of a bare array. The pool walk
runs **two passes**: never-attempted ids first, then (only if the window is picked clean)
puzzles failed >7 days ago. A long-ago failure is still deliberately back in the draw — it
just must not outrank a puzzle the student has never met.

`freshOnly` is the **outer** loop, above the quality-tier loop. First attempt nested it
inside the tier loop, which meant an exhausted `top` tier served a repeat before `good`/`all`
were ever checked for fresh puzzles. Pool documents are cached per tier so the reordering
doesn't double the `paths` reads.

### 3. `$sample` fallback → indexed random seek — `puzzles.service.ts`

Replaced `aggregate([{$match},{$sample:{size:1}}])` with a seek: pick a random rating
inside the band, then `find(...).sort({'glicko.r': ±1}).limit(20)` and take one at random.
Both directions are tried, so an empty result genuinely means "nothing matches" rather
than "seeded too high". Uses `{glicko.r:1}` for `mix` and `{themes:1,glicko.r:1}` for themed
queries. Benchmarked: **~6ms vs ~25,000ms**. Biases the draw toward rating-dense parts of
the band, which is imperceptible to a solver.

### 4. Pool size 50 → 1000 — `gen_paths3.js`

`TARGET=50, PER=6` → `TARGET=1000, PER=100`. ~20x headroom against the busiest account
(`srinithi_sn`, 2479 rounds). Rebuild is zero-downtime: the script builds `paths_new` and
atomically renames it over `paths` at the end, so the live collection serves throughout.

Important property of the generator: it samples with `find(...).limit(PER)` with **no sort
and no random skip**, so index order makes it deterministic — re-running it with the same
parameters regenerates the *identical* ids. Refreshing the pools does nothing for an
exhausted user; only changing `TARGET`/`PER` does.

## Verification

`tsc --noEmit` clean on `apps/api`. Measured against the live API on :4000, after the
pool swap:

| account | theme | avg latency | new (never seen) | distinct |
|---|---|---|---|---|
| harinitharanjith | mix | 81ms | 20/20 | 20/20 |
| harinitharanjith | fork | 79ms | 10/10 | 10/10 |
| harinitharanjith | mateIn2 | 94ms | 10/10 | 10/10 |
| harinitharanjith | zugzwang | 82ms | 10/10 | 10/10 |
| srinithi_sn (2479 rounds) | mix | 77ms | 10/10 | 10/10 |

Before: 26,000ms and 10/10 draws already-attempted.

### Testing gotcha — `userId` comes from the QUERY STRING, not the session

`puzzles.controller.ts:19` reads `@Query("userId")`. A curl with only a valid session
cookie is treated as a **guest**, so dedup is silently skipped and the results look like the
picker is serving repeats. This produced a false "still broken, 4/20 repeats" reading
mid-session — three of those four were `w:true` (solved), which the exclusion list can never
return, and that contradiction is what exposed the bad test. Always pass
`&userId=<id>` when reproducing picker behaviour by hand.

## Files

- `v2/apps/api/src/puzzles/puzzles.service.ts`
- `gen_paths3.js`

## Deploy

`apps/api` is built in the `/home/ubuntu/chessguru` clone (whose `src` is a symlink to
`/home/dreamworld/chessguru/v2/apps/api/src`), because pm2 runs
`/home/ubuntu/chessguru/v2/apps/api/dist/main.js` as user `ubuntu`:

```bash
cd /home/ubuntu/chessguru/v2/apps/api && sudo -u ubuntu npx nest build
sudo -u ubuntu pm2 restart chessguru-v2-api
```

Pool rebuild:

```bash
cd /home/dreamworld/chessguru && \
  NODE_PATH=/home/dreamworld/chessguru/v2/apps/api/node_modules \
  nohup node gen_paths3.js > /tmp/genpaths.log 2>&1 &
```

(`mongoose` is not installed at the repo root — hence `NODE_PATH`.)

## Open items

- **`vote` is stored on a 0–100 scale** (`vote: 95` on a sample doc), but the fallback's
  quality tiers test `vote: {$gte: 0.75}` and `{$gte: 0.5}`. On a 0–100 scale those pass
  essentially every puzzle, so the fallback's "top/good" tiers are effectively only
  `plays >= 100` / `plays >= 20`. `gen_paths3.js` uses the correct 70/40. Not changed here
  — fixing it would shift which puzzles get served and needs an owner decision.
- Pool exhaustion is raised ~20x, not removed. If a student ever clears a 1000-id pool the
  seek fallback now handles it in ~6ms instead of 25s, so the failure mode is graceful.
- No prefetch of the next puzzle on the client (`usePuzzleGame.ts`); latency is now low
  enough that it isn't needed.
</content>
</invoke>
