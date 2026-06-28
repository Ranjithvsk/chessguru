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
