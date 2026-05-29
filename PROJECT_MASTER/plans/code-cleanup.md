# Plan: Code / folder cleanup

## Done (2026-05-29) — docs + safe archive
- Created this `PROJECT_MASTER/` docs hub (knowledge / decisions / plans / database / research /
  sessions), modelled on the Dream World Plants pattern.
- Moved **dead backup files** into `archive/` at the repo root (reversible — nothing deleted).
  None are referenced by live code (`server3.js`, `routes.js`, `auth.js`, `engine-battle/*`):
  - `server3.js.bak.1777534836`
  - `gen_bf_pools_v2.js.bak.1777556716`, `gen_bf_pools_v2.js.bak.1777557026`
  - `engine-battle/engines.json.bak`, `engine-battle/puzzle_extractor.js.bak`
  - `public/index.html.bak2`, `public/opening.html.bak`,
    `public/theme.html.bak.1777541546`, `public/theme.html.bak.1777551958`
- Already gone before this pass (the old master listed them as "to delete"): `server.js`,
  `server2.js`, `lichess_db_puzzle.csv`.

## Not touched (left in place on purpose)
- **All live code:** `server3.js`, `routes.js`, `auth.js`, `models.js`, `glicko2.js`,
  `models/Puzzle.js`, `migration/fix_fen.js`, `scripts/update_status.sh`, `engine-battle/*`,
  live `public/*` pages.
- **One-off maintenance scripts** in the root (`build_pools.js`, `build_pools2.js`,
  `build_pools_fast.js`, `build_engine_pools.js`, `build_theme_pools.js`, `gen_bf_pools.js`,
  `gen_bf_pools_v2.js`, `gen_paths2.js`, `gen_piece_pools.js`, `dbcheck.js`, `diag2.js`,
  `diag_wc.js`, `engine_analyze.js`, `game_gen.js`, `book_game_runner.js`, `test_extractor.js`,
  `test_logic.js`, `test_pool.js`, `theme_check.js`, `write_editor.py`). They are not imported by
  the server, but may still be run by hand — left visible rather than hidden.
- Gitignored stray files `public/exit.txt`, `public/result.txt` (tiny, already ignored).

## Suggested follow-ups (need explicit OK — not done)
1. Move the one-off scripts into a `tools/` (or `scripts/oneoff/`) folder and update any docs.
2. Drop the duplicate-cased empty `piecepools` Mongo collection (keep `piecePools`).
3. Create `public/test/` to actually enable the test-page workflow (ADR-0005).
4. Set a real `SESSION_SECRET` in `.env`.
5. Commit the repo state (it's a live git repo; commit early per the lessons table).
