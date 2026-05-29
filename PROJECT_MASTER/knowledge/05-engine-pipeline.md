# ChessGuru — Engine Pipeline (puzzle generation)

The self-feeding puzzle factory in `engine-battle/`. Three stages plus a maintainer:

```
engine_runner.js  ──plays──▶ enginegames   ──analyzes──▶  puzzle_extractor.js ──▶ puzzles
   (:3002 WS/REST)                              (Stockfish depth 50)   │
engine_updater.js ──maintains──▶ engines.json + binaries              └─ cook.js (theme tagging)
```

All components connect to `mongodb://localhost:27017/chessguru`. Engine binaries live in
**`/home/ubuntu/engines/`** (NOT on `$PATH`; `which stockfish` is empty — absolute paths only).

---

## engine_runner.js (PM2 `engine-runner`, port :3002)

Runs round-robin engine-vs-engine tournaments and serves a combined **HTTP + WebSocket** API.

- `loadEngines()` reads `engines.json`, resolves `binary` under `~/engines`, and **skips any engine
  whose binary file is missing** (`fs.existsSync`). ⚠️ It dedups by binary path, so the many
  Stockfish UCI_Elo/Skill entries (all `binary:"stockfish"`) collapse to **one** loaded engine —
  the multi-Elo ladder is largely unusable through this runner (see [10-known-issues](10-known-issues-and-risks.md)).
- `UCIEngine`: spawns the binary, speaks UCI; applies `Skill Level` / `UCI_LimitStrength`+`UCI_Elo`
  on start. **Maia `uciOptions` (WeightsFile) are never sent** → Maia non-functional here.
- `runGame`: starts from the **standard position** (no opening book used), up to 300 plies, real
  **clock/time-control search** (`go wtime btime winc binc`), chess.js validates moves
  (illegal/`(none)` ⇒ mover loses). Writes a full doc to `enginegames`
  (`tournamentId, white/blackName, result, moves[], pgn, termination, elos, startedAt/endedAt`).
- `tourney`: double round-robin, capped 16 engines, games run **sequentially**. Broadcasts a rich
  WS event stream (`tournament_start, round_start, game_start, move, clock, engine_info,
  game_end, standings_update, tournament_end`).
- HTTP (CORS `*`): `GET /health`, `/engines`, `/games` (latest 50), `/tournaments` (latest 20).
  WS: client sends `{type:'start_tournament', engineIds, thinkMs, maxGames}` / `{type:'stop'}`.
- nginx proxies `/ws-engine` and `/api/engine-runner` → `:3002` (consumed by `engine_battle.html`).

## engine_updater.js (PM2 `engine-updater`, intended cron `0 3 1 * *`)

Monthly maintainer. Creates `~/engines/{weights,…}`; downloads **Maia weights ELO 1100–1900** from
the CSSLab repo; for each engine tries a GitHub-release install (pinned `releaseTag` or latest).
⚠️ **No engine in `engines.json` has download-source fields**, so every engine returns
"no download source" → 0 updates (confirmed by `reports/update-2026-05.json`: 68 engines, all
skipped). `discoverNewEngines()` scrapes the EngineProgramming list and only *reports* candidates.
Bug: `saveRegistry()` writes `registry.meta.lastUpdated`, but `engines.json` has no `meta` object
→ would throw. Optional `GITHUB_TOKEN` env for rate limits.

## puzzle_extractor.js — the puzzle factory

A port of `lichess-puzzler/generator.py`. Hardcoded `SF_PATH = ~/engines/stockfish`.

**Analysis settings:** `SCAN_DEPTH=50`, `SCAN_TIME=30000ms`, `SCAN_NODES=25_000_000` (whichever
limit hits first), **MultiPV=3**, Hash 256–512, Threads 2.
**Thresholds:** `WIN_CHANCE_DELTA=0.3` (blunder swing), `MIN_WIN_CHANCE_GAIN=0.3`,
`UNIQUENESS_MARGIN=50cp` (best must beat 2nd by ≥50cp or ≥0.10 win-chance), puzzle length 1–10
moves. Win-chance = Lichess sigmoid `2/(1+e^(−0.00368208·cp)) − 1` (mate ⇒ ±1).

**Algorithm** (`extractPuzzlesFromGame`): only decisive games (`result ∈ {1-0,0-1}`,
`puzzleExtracted≠true`); convert SAN→UCI; walk the game ply-by-ply re-analyzing with Stockfish; a
**blunder** is `prevWC − (−currentWC) ≥ WIN_CHANCE_DELTA` with `currentWC ≥ MIN_WIN_CHANCE_GAIN`;
the position becomes a candidate, solution = best PV. `validateCandidate` enforces uniqueness,
replays the PV with chess.js (**but does NOT re-analyze the opponent's replies** — a deliberate
perf trade-off, so solutions aren't proven forced), tags themes via `cook()`, adds a goal tag
(mate / crushing ≥0.6 / advantage ≥0.3 / equality), estimates a rating (base 1200, adjusted by
motif & length, clamped 600–2800), and writes to `puzzles`
(`_id='cg_'+base36+rand`, `fen, initialPly, solution, themes, rating, pov, sourceGameId,
scoreBefore/After, verified:true`).

⚠️ **Two correctness issues** (detail in [10-known-issues](10-known-issues-and-risks.md)):
1. The `puzzleSchema` lacks `source`/`status`, so the `source:'generated'`/`status:'pending'` the
   code sets are **silently dropped** by Mongoose → the review/approval gate fields never persist,
   and `verified` is always `true`.
2. `fen`/`solution` alignment looks off: `fen=prevFen` (pre-blunder) but `solution[0]` is the
   blunder move prepended to a PV computed *after* the blunder — the FEN, blunder move, and PV may
   not line up. Worth verifying before trusting generated puzzles.
3. The persistent `Stockfish` class actually **spawns a fresh process per position** (start/sync/
   quit are vestigial) → runtime is process-spawn-bound.

Run detached: `nohup node engine-battle/puzzle_extractor.js >> /tmp/puzzler.log 2>&1 &`
(the `/api/status/extractor/start` endpoint does exactly this).

## cook.js — theme tagger (port of lichess-puzzler `cook.py`)

`cook(fen, uciMoves, pov) → string[]`. Builds chess.js snapshots after each half-move and applies
heuristics. Can assign (≈70 themes): mate lengths (`mate`, `mateIn1..5`), mate patterns
(`smotheredMate, backRankMate, arabianMate, anastasiaMate, hookMate, bodenMate, doubleBishopMate,
dovetailMate, operaMate, morphysMate, epauletteMate, cornerMate, vukovicMate, killBoxMate`),
motifs (`fork, pin, skewer, discoveredAttack, doubleCheck, sacrifice, quietMove, deflection,
attraction, interference, intermezzo, xRayAttack, zugzwang, clearance, trappedPiece, hangingPiece,
exposedKing, capturingDefender, advancedPawn, attackingF2F7, enPassant, castling, promotion,
underPromotion, kingsideAttack, queensideAttack, defensiveMove, discoveredCheck, collinearMove`),
length (`oneMove, short, long, veryLong`), phase/endgame (`opening, middlegame, endgame,
pawnEndgame, rookEndgame, bishopEndgame, knightEndgame, queenEndgame, queenRookEndgame`).

⚠️ **Tagging quality is uneven** (see [10-known-issues](10-known-issues-and-risks.md)):
`clearance` is a **stub that returns `true`** (tags ~every puzzle); `zugzwang` ≈ "≤3 legal moves";
most mate-pattern detectors check only piece *presence*, not geometry (`doubleBishopMate`===
`bodenMate`, `morphysMate`===`operaMate`, `killBoxMate`===`cornerMate`); `deflection` over-tags.
Exports `materialDiff`, `winChances`, `buildLine`. Dead: `getMove()`, `squaresAttackedBy()`.

## engines.json — registry

`version 3.0`, `engines[]` (68 entries): full-strength UCI engines (Stockfish 18/16, viridithas,
renegade, carp, stormphrax, berserk, sirius, …), a Stockfish **UCI_Elo ladder** (sf_3190…sf_1320),
a Stockfish **Skill-Level ladder** (sf_skill20…0), and 9 **Maia** nets (`binary:"lc0"`).

**On-disk reality** (`~/engines/`): present — stockfish (113 MB), stockfish16, viridithas,
renegade, carp, stormphrax, berserk, sirius, nalwald, clover, blackcore, frozenight, wahoo,
willow, avalanche, weiss, seer, midnight, igel. **Missing** (silently skipped by the runner):
clarity, altair, rice, ethereal, smallbrain, rofchade, drofa, princhess, winter, marvin,
peacekeeper, leorik, pedantic, and **`lc0`** (so all Maia engines are non-functional). `laser` is a
424-byte stub. Maia weights 1100–1700 present.

The board editor's `/api/engine/analyze` endpoint (see [06-frontend](06-frontend.md)) spawns
`~/engines/stockfish` server-side for on-demand analysis.
