# ChessGuru — Pools & Maintenance Scripts

## The "pools" concept (read first)

Serving `/api/puzzles/random` by running `$match`/`$sample` against the **5.88M-doc `puzzles`**
collection on every request would be slow. So candidate puzzle-ID lists are **pre-computed offline**
and stored as small docs (`{_id:"<key>", ids:[...], count, gen}`). Five pool collections, each a
different slicing axis:

| Collection | Key | Axis | Built by | Live count |
|---|---|---|---|---|
| `paths` | `theme\|tier\|RRRR` (range `min`/`max`) | theme × vote-tier × rating band | `gen_paths2.js` | 4,299 |
| `piecePools` | `theme\|maxPc` | theme × piece-count band | `gen_piece_pools.js` / `build_pools*.js` | 590 |
| `bfPools` | `theme\|ratingBand\|pc` | theme × rating × piece-count (blindfold) | `gen_bf_pools_v2.js` | 13,443 |
| `themePools` | theme (+`__all__`) | engine-generated puzzles only | `build_theme_pools.js` | 3 |
| `enginePools` | theme (+`__all__`) | engine-generated puzzles only | `build_engine_pools.js` | 3 |

`routes.js` consumes these in `getPz`/`sel`/`_sCreate`: `paths` for tiered selection (top→good→all),
`bfPools`/`piecePools` for O(1) piece-count-filtered lookups. `mix` = "no theme filter". The same
~68-entry `THEMES` list is copy-pasted across scripts.

> `themePools` and `enginePools` are duplicate concepts; the app standardizes on **`enginePools`**
> (that's what `test_extractor.js`'s `rebuildThemePools()` actually writes — a naming leftover).
> `themePools` / `build_theme_pools.js` is the likely orphan.

---

## Maintenance scripts (all in repo root unless noted)

None are imported by the server — one-off migration/maintenance helpers ([ADR](../decisions/)).

**Pool builders**
- `gen_piece_pools.js` — canonical `piecePools` builder (`$sample` 200/combo); **destructive**
  (`deleteMany({})` first).
- `build_pools.js` / `build_pools2.js` / `build_pools_fast.js` — three **resumable** iterations of
  the same `piecePools` builder. `_fast` uses a biased contiguous `skip+limit` sampler. Superseded
  by `gen_piece_pools.js`.
- `gen_bf_pools.js` → **superseded by** `gen_bf_pools_v2.js` (v2: rating bands 400→2900, MIN_COUNT=1,
  crash-resume).
- `build_theme_pools.js` (→`themePools`) and `build_engine_pools.js` (→`enginePools`) — identical
  logic, different target collection.
- `gen_paths2.js` — builds `paths` (Lichess path model); **destructive** (drops `paths` first),
  vote-tiered, chunks of 50 IDs/path, `{min,max}` index.

**Game generation (feed the extractor)**
- `game_gen.js` — self-play: two Stockfish at mismatched Elos, 20 hardcoded openings → `enginegames`
  (`tournamentId:'mismatch-book'`).
- `book_game_runner.js` — walks the Lichess Masters book for varied openings, plays Elo-mismatch
  games, broadcasts live over `ws://localhost:3002` → `enginegames`. ⚠️ **Contains a committed live
  Lichess API token** (`TOKEN='lip_…'`) — rotate & move to env (see [10-known-issues](10-known-issues-and-risks.md)).

**Diagnostics (read-only)**
- `diag_wc.js` / `test_logic.js` — best puzzle-sparsity report (per theme/rating/pc band, with
  nearest-populated-band hints).
- `diag2.js` / `theme_check.js` — duplicate count grids.
- `dbcheck.js` — a few hardcoded selectivity counts.
- `engine_analyze.js` — replays one `enginegames` game through Stockfish and prints win-chance
  deltas (sanity-checks the extractor's 0.3 threshold).
- `test_pool.js` — smoke-tests `piecePools` integrity.

**Actually-mutating "tests"**
- `test_extractor.js` — despite the name, a **functional lighter extractor** (depth 12/3s/1M nodes):
  reads `enginegames`, writes new `puzzles`, sets `puzzleExtracted:true`, rebuilds `enginePools`.

**Migration**
- `migration/fix_fen.js` — **one-time** (idempotent via a `migrated` flag): rewrites old puzzles so
  `fen` is post-first-move and `line` is the remaining moves. Raw `mongodb` driver, `bulkWrite` 1000.

**Dead**
- `write_editor.py` — unfinished 5-line stub; safe to delete.

---

## Ops

### scripts/update_status.sh (cron, every 10 min)
Runs `mongosh` `estimatedDocumentCount()` on puzzles/bfPools/piecePools/enginegames/users + a
`pm2 jlist`→python parse of the `chessguru` process status, and overwrites `~/chessguru/LIVE_STATUS.md`
with the `## Live Stats` block. Timestamps are **UTC** (the box runs UTC). The crontab entry lives in
the `ubuntu` user's crontab (not version-controlled).

### reports/update-2026-05.json
Output of the `engine-updater` for May 2026: 68 engines, **0 updated / all skipped** (no download
sources), thinnest Elo band 600–1100, plus a scraped `newEngineCandidates` list (with some garbage
Elos, e.g. `Oxidation` at 8191).

---

## Cleanup candidates (need explicit OK — tracked in [plans/code-cleanup](../plans/code-cleanup.md))
- Collapse the 3 `build_pools*` variants into `gen_piece_pools.js`; drop `gen_bf_pools.js`.
- Pick one of `themePools`/`enginePools` (keep `enginePools`); drop the duplicate `piecepools`
  (lowercase, empty) Mongo collection.
- Delete `write_editor.py`; dedup `diag2.js`/`theme_check.js` and `test_logic.js`/`diag_wc.js`.
- These are the one-off scripts intentionally left in the root for now (not archived).
