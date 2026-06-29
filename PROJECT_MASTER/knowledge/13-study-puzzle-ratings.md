# 13 — Study-puzzle ratings (rated endgame drills)

**Goal:** the Study drills (Queen/Rook/2-Rook/2-Bishop/B+N mates, Q/R vs Pawns) currently
generate a random position every time with NO rating and no win/draw label. Give each puzzle a
**rating** + a **win/draw verdict**, served at the player's level so a beginner never gets a GM puzzle.

## Decision (locked 2026-06-28)
Build a **database of pre-rated study puzzles fed by a background generator** (mirrors the existing
5.88M-puzzle factory) — NOT on-the-fly generation (can't show a rating up front / can't target a level cheaply).

### Per-puzzle pipeline
1. **Generate** a random legal position (port of `StudyTrainer.tsx` randomMate/randomVsKP).
2. **Verdict** via the **Lichess 7-piece tablebase API** (`tablebase.lichess.ovh`): exact
   `win/draw/loss` + `dtm` + the best-move list (solution). Covers every position (<=7 pieces). No local TB.
   Used in the BACKGROUND only, throttled + cached by FEN (each FEN fetched once ever), Stockfish-18 fallback.
3. **Seed rating** (tablebase distance != human difficulty, so dtm alone is NOT the rating):
   - curated **base per study type** (2-Rook ~600, Queen ~800, Rook ~1100, 2-Bishop ~1500, B+N ~2000)
   - small **dtm** nudge for within-type variation
   - **Maia + tablebase probe**: run maia-1100..1900; the **lowest band whose move still keeps the win**
     (checked against the TB move categories) = the human level that can solve it. Raises the seed when
     low bands throw the win; never lowers below the curated floor (maia's floor is 1100).
   - stored with **high RD** (uncertain) so Glicko moves it fast.
4. **Self-calibrate via Glicko** from real solves (same engine as the main pool) — the rating drifts to
   true human difficulty; new puzzles later seed from a type's empirical average.
5. **Serve by matchmaking**: puzzle rating ~ player's per-study skill rating (+/-150) -> level-appropriate.

### Storage — Mongo `chessguru.study_puzzles`
`{ type, fen, result, dtm, solution[], rating, rd, vol, nb, seedMethod, maiaBand, createdAt }`
indexes: `{type,rating}`, unique `{fen}`.

## Phases
- **P1 (now):** schema + generator (tablebase verdict + curated/dtm/maia seed) for the **mate drills**;
  populate Mongo; verify ratings/verdicts. Backend only — no UI deploy.
- **P2:** pawn drills with win/draw verdict + draw-aware scoring; API endpoint (serve by type+level) +
  Study UI showing rating + win/draw tag + per-study Glicko skill rating (reviewed deploy).
- **P3:** Glicko self-calibration loop + level-targeted serving polish.

Factory: `/home/ubuntu/chessguru/study-factory/generate.py` (reuses book-engine venv + lc0/maia).

## 2026-06-29 — P2 shipped (LIVE)
- Per-study **Glicko skill rating** in `userperfs.study.<type>` + `/api/study/me` + `/api/study/:id/complete`
  (updates user rating AND self-calibrates the puzzle; logged-in persists, guest one-off). Reuses glicko.ts.
- **StudyTrainer** serves puzzles at the player's level (matchmaking), reports win/fail on finish, shows
  the puzzle ★ rating + WIN/DRAW tag + your rating + last change. Ratings tempered (no flat-1950).
- Study list shows per-drill ★ rating. Verified live on harinitharanjith.com/study.
- Commits: 5047aad, 2c9557b, 9be70b6, b35fa77, 5e7eab9, d77722d, e6f9a58.
- REMAINING: pawn drills (Q/R vs Pawns) with draw-aware scoring (held draw = success); factory as a PM2
  service for continuous generation; harden guest self-calibration (anon solves can nudge puzzle ratings).

## 2026-06-29 — Pawn drills + draw-aware scoring (LIVE)
- Factory `--mode pawns`: K+Q / K+R vs K+pawns (1-4); keeps WIN and DRAW (cursed-win/blessed-loss =>
  practical draw), skips losses. Rook-vs-pawns yields more draws than queen (theory-correct).
- `/api/study/puzzle` takes a `pawns` filter; trainer serves by the selected pawn count.
- DRAW-AWARE scoring: holding a theoretical DRAW = success (Glicko win); drawing a WON position = fail;
  getting mated = fail. Verified live (stop-the-pawn / rook-stop-pawn). Commit 56a751d.
- Pawn-drill ratings are curated (piece+pawns+win/draw); Maia-playout refine deferred (ambiguous for draws).

## 2026-06-29 — Continuous generator service (LIVE, pm2 study-factory)
- study-factory/service.py + run-service.sh; pm2 name study-factory (bash interpreter, --max-memory-restart 250M, pm2 save).
- Fills each bucket to target (MATE_TARGET=60/type, PAWN_TARGET=25/(type,pawns)); tablebase-only, throttled, incremental upserts, resumable. Env-tunable (STUDY_* vars). Idles 300s when stocked.

## 2026-06-29 — Per-position Maia ratings + continuous re-seeder (LIVE, study-only)
Owner ask: each puzzle must have its OWN rating (Maia-engine seeded), not bucketed by pawn count /
type — a tricky 1-pawn can be harder than an easy 4-pawn. Scope: chessguru.study_puzzles ONLY (main
5.88M pool untouched).

- generate.py: `_achieves` (draw-aware playout: player=maia(band) vs Stockfish; WIN => success iff maia
  mates, DRAW => success iff the game reaches a draw without losing) + `pawn_maia_rating` (blends the
  type/pawn floor with the lowest human band that succeeds).
- **study-reseed.py** (pm2 `study-reseed`, bash wrapper, --max-memory-restart 700M, pm2 save): a continuous
  worker that upgrades any non-Maia-seeded study puzzle to seedMethod="maia-playout" — mates via the
  convert-the-mate playout, pawns via the draw-aware playout. Engines opened once (5 maia + SF), resumable,
  skips {maia-playout, curated+dtm+maia, maia-playout-failed}. Idles 300s then re-checks for new puzzles.
- reseed_pawns.py: the one-off pawn variant (superseded by the worker; kept for reference).

Result (re-seeded 265 -> 0 in ~28 min): ratings now SPREAD per position instead of uniform buckets.
  rook-stop-pawn 1-pawn 1190-1620 (was ~1336 flat); mates rook 986-1449, queen 911-1241, B+N 2050-2256.
CROSSOVER PROVEN: a 1-pawn rook WIN no band could convert = 1620 OUT-RATES a 4-pawn rook DRAW maia-1100
holds = 1392. Verified live on /study/rook-stop-pawn (New position now varies 1190/1230/1300/1336 + draws).

Two cooperating study services: `study-factory` (generate volume, tablebase-only, fast) + `study-reseed`
(per-position Maia seed). Glicko still individualises every rating further from real solves. Ratings are
served straight from the DB (no web deploy needed to take effect).
