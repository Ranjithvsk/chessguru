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

## Evening 2 — the six suggestions (owner: "add your suggestions also, as you planned")
1. **Time trouble** (`game-motifs.service.ts`): arena games carry `moveTimes`/`timeControl`; both clocks are replayed per ply. An event made under 10 s (or a <1.5 s move under 30 s) gets `timeTrouble:true`, `clockMs`, `thinkMs`, and a negative score is halved (min −1). Leaderboard shows ⏱ 7s on the moment.
2. **Rating-band norms**: `ratingBands()` (90 days, 200-pt bands, cached 10 min) → each row carries `rating`, `band`, `bandNorm {players, scorePerGame, foundRate, openingAccuracy}`; the UI prints "1400s avg 1.2/game · 61% found" under the score once a band has ≥3 players.
3. **Star for class**: `POST /api/game-motifs/star {gameId, ply, note?}` (coach/owner/admin) inserts a `classSnaps` row (`classId:"game-awards"`, `starred:true`, `studentId`, green best / red played arrows, auto note) and stamps `starredBy` on the event. ☆ button on every moment for coaches.
4. **Repertoire check**: `repertoireFor(uid)` = the student's `myRepertoire` lines + their coach's (`users.coachId`). During the opening plies the game is matched against the lines; first departure = `repertoireDeviation` event (−1, once) and `opening.repertoireLine/repertoirePlies/repertoireDeviation` on the summary.
5. **Coach digest**: `coach-starred-digest.service.ts` adds "🎯 Game awards this week" (score, ✅/❌, best and worst moment as board-editor links) for the coach's students, html + text. Never fails the digest.
6. **Classmates-only seek**: protocol `LobbySeek.academyOnly` (client `seek.d.academyOnly`), ws router passes it, lobby puts the seek in pool `tc|acad:<academyId>` (looked up from `users.academyId`), bot-player skips `|acad:` pools, Play.tsx "classmates only" checkbox (signed-in only) → `usePlay.seek(clock, rated, academyOnly)` → `live.ts`.
Deployed: API rebuilt + restarted; play-lobby / play-gateway / play-bot restarted (sources synced into the ubuntu clone by tee — lobby/ws/protocol/bot are NOT symlinked); web deployed.

## Clocks for Lichess / chess.com games (owner: "lichess games, we can request time right?")
- `games-fetch.service.ts`: Lichess import now asks `clocks=true` and stores `clock {initial, increment}` (ms) + `clocks[]` (remaining after each ply, ms); chess.com stores `clock` parsed from `time_control` ("600+5") and `clocks[]` parsed from the PGN's `{[%clk h:mm:ss.d]}` comments (`clocksFromPgn`, `parseTimeControl` exported). `my-games` Lichess import also asks `clocks=true` so uploaded PGNs carry `%clk`.
- Scorer: `GameToScore.clocksMs` (remaining-after-move series) — `clockAt()` derives the clock before the move from the same side's previous ply and think time = before + inc − after. Uploaded PGNs use `[TimeControl]` header + `%clk`.
- Backfill: 393/397 stored Lichess games got clocks via `POST /api/games/export/_ids?clocks=true` (4 are unclocked/correspondence). All `ext:`/`my:` gameMotifGames rows deleted so the worker re-scores them with time-trouble tagging.

## Common level + days filters (owner: "add level category for opening, games like in puzzle, also that days filter, else make those common for all")
- The page-level Period tabs (Today / 7 days / 1 month / 6 months / 1 year / Lifetime) and Level tabs (🐣 Rookie … 👑 Master, puzzle-rating 200-pt buckets) now drive all three boards. Opening and Game Awards sections take `period`/`bucket` props and show a "1 month · ⚡ Intermediate" pill instead of their own toggles.
- API: `GET /api/opening-trainer/academy-leaderboard?period=&bucket=` (window replaces the fixed 30 days; students filtered by puzzle Glicko, unrated = 1500 like the puzzle board; rows carry `rating`). `GET /api/game-motifs/leaderboard?period=&bucket=` accepts the same keys (`periodDays`, `inRatingBucket`, `puzzleRatings` exported from `opening-trainer.controller.ts`).
- Moment rows: the move text itself now opens the ChessGuru board editor; the external link reads "source: lichess ↗" so it is not mistaken for the position link.

## Student moments view reorganised (owner: "when opened a user, it looks clumsy")
`StudentMoments` in `Leaderboard.tsx`: summary strip (Score / Found / Missed / Games), "Best at" and "Missing" motif chips, opening accuracy + favourite, style; All / Found / Missed toggle; then one card per game (players · date · source · game total · "source ↗") with a table: Move (opens the ChessGuru board) · What · Result (best move on a miss) · Pts · Clock (⏱ on time trouble) · ♟ board / ☆ star.
