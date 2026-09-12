# 2026-09-12 — Academy "Game awards": motif leaderboard from real games

**Ask (owner):** a dashboard/leaderboard for games in the academy that awards students for finding
good moves — fork, pin, mate, every motif — with a negative score for the ones they missed; "even
games played in lichess or chess.com".

**What:** `apps/api/src/game-motifs/` (service + controller, registered in app.module.ts).
- Worker (every 90 s, one game per tick, Stockfish depth 12 via `my-games/stockfish.ts`) walks
  every finished game of an academy member from the last 45 days across three sources: arena
  `live_games` (players `u:<id>`), `myGames` (PGN imports, `ourColor`), `externalGames` (linked
  Lichess / Chess.com; the student's colour = their linked handle vs the PGN's White/Black).
- At each of the student's moves the engine's best line is tagged with `engine-battle/cook.js`
  (the puzzle motif tagger). Played the best move or within 30 cp → **found** (+points); played
  ≥ 150 cp worse while a tactic was on the board → **missed** (−half). Weights in `MOTIF_POINTS`
  (mates 6–8, deflection/attraction/sacrifice 4, fork/pin/skewer 3, hanging piece 2…). Shape tags
  (short/long/endgame…) never score.
- Collections: `gameMotifEvents` (one per scored moment: fen, best/played SAN, motifs, points,
  source, url, label) and `gameMotifGames` (scored-game ledger, idempotent re-runs).
- API: `GET /api/game-motifs/leaderboard?period=7d|30d|90d|all`, `GET /api/game-motifs/student/:id`,
  `POST /api/game-motifs/analyze/:gameKey` (coach/owner; key = `live:<id>` | `my:<id>` | `ext:<id>`).
- Web: `pages/AcademyGameAwards.tsx` at `/academy/game-awards`, Navbar → Academy → "🎯 Game awards".
  Rows expand into the student's moments with links (replay / Lichess / Chess.com / position).

**Verification:** API built (`nest build`), restarted, `/api/health` 200, leaderboard 401 without a
session. Worker picks games up on its own; first results appear within minutes.

**Open:** bot-player games are not in `live_games` (the bot log in `bot_games` has no moves); only
arena games persisted by the game-engine count. Human-vs-human games last week: none — every real
user played a named bot.

## Evening additions (same day)
- **Positional layer** `game-motifs/strategic.ts`: prophylaxis, good defence, attack build-up, knight
  outpost, weak-square occupation, pawn-weakness creation, space gain, good-for-bad exchange, king
  activity, passed pawn, rook on the 7th, zugzwang created, endgame technique. Board heuristics over
  chess.js decide the KIND of move; the engine decides it was right (best move, eval held). Prophylaxis /
  defence / zugzwang need null-move evals ("what if I passed") — run only for players rated ≥1400
  (live rating, else puzzle rating). Per-game character (aggressive / dynamic / positional) on the ledger.
- **Opening layer** `game-motifs/opening.ts`: masters book = `openingpositions` (`_id: masters|<epd>`,
  38 M positions) + `openingnames`. First 12 moves each: book or engine-ok → accuracy %; out of book
  and ≥80 cp worse → "wrong opening move" (−1); ≥250 cp → "fell into a trap" (−3); punishing the
  opponent's ≥250 cp opening blunder with the best move → "trap sprung" (+3). Per-student opening
  summary (accuracy, mistakes, traps, favourite opening) on the ledger and in the leaderboard.
- Leaderboard section gained 📖 Opening and Style columns; legend explains the three layers.
- Worker: 2 engines, movetime-capped search, 20 s ticks, per-position timeout, stuck-tick watchdog,
  hourly retry of failed games; candidate query scans wide THEN excludes scored games (the first cut
  starved itself).
- Bot player: Maia-1 weights had been deleted → every think timed out → random moves; restored the
  nine nets, added the weights guard + resign-after-two-failures, and the ±150 human-like band.
