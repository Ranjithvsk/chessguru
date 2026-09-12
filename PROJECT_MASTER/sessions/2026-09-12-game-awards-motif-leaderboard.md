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
