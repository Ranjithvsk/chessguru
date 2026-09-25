# Plan: Academy online tournaments (Play → Tournaments, Swiss via JaVaFo)

**Status:** PROPOSED (2026-09-25, owner: "in play side panel, tournament option, inside academy — we also
have pairing engine javafo, let's plan first"). Nothing here is built yet.

## 1. Goal
A coach or academy owner creates a tournament for *their* academy; students join from the Play side
panel; every round is paired automatically (FIDE Dutch Swiss, JaVaFo); the games are played on the
existing online-play stack; results and standings update by themselves; the coach never types a result.

## 2. What already exists (reuse, don't rebuild)
| Piece | Where | Reused for |
|---|---|---|
| JaVaFo 2.2 + TRF16 encoder/decoder, `pairNextRound(TrfTournament)` | `apps/api/src/pairings/javafo.ts`, `trf16.ts` | pairing every round, byes/absences (TRF codes `-` `+` `H` `U`) |
| Arbiter tournaments, standings (Buchholz → SB → rating), publish, chess-results push, `results.chessguru.cc` | `apps/api/src/pairings/*`, `sm_tournaments`, `Arbiter.tsx`, `PublicResults.tsx` | data model + standings + export for free |
| Online play: lobby `pair()` → engine `setup` → `matched` to both players; game-engine grains, server clocks, `live_games` (`players u:<id>`, `result`, `speed`, `rated`, `finishedAt`); gateway WS; `lib/live.ts` / `usePlay` | `apps/lobby`, `apps/game-engine`, `apps/ws`, `apps/web/src/lib/live.ts` | playing the boards, clocks, results |
| Classmates-only seek pools per academy (owner 2026-09-12) | `apps/lobby/src/main.ts` | eligibility idea, same `users.academyId` check |
| Fair play events, web push, LiveClassBanner-style in-app banner | `fairplay/`, `push`, `LiveClassBanner.tsx` | anti-cheat flags, round-start alerts |
| Navbar "Play" group (Play, My games, Live broadcast) | `Navbar.tsx` ~line 89 | the new `🏆 Tournaments` entry |

## 3. Data
Reuse **`sm_tournaments`** (one doc per event) with new fields rather than a new collection — standings,
TRF16 and publishing then work unchanged:
- `mode: "online"`, `academyId`, `created_by`, `visibility: "academy" | "batch"`, `batchIds[]`
- `time_control: { initial, increment }` (ms), `rated: boolean` (ChessGuru rating), `num_rounds`
- `status: "draft" | "open" | "running" | "finished"`, `round_gap_sec`, `join_deadline_sec` (forfeit)
- `players[]` gains `user_id` (ChessGuru user), `joined_at`, `withdrawn`
- `rounds[].pairings[]` gains `game_id`, `state: "pending" | "playing" | "done" | "forfeit"`, `started_at`
- index `rounds.pairings.game_id` → tournament/round/board lookup on game-over

## 4. Server
New controller `apps/api/src/pairings/academy-tournaments.controller.ts` (same flat module, raw Mongo):
- coach/owner: `POST /api/tournaments` · `POST /:id/open` · `POST /:id/start` · `POST /:id/next-round` ·
  `POST /:id/force-result` · `POST /:id/finish` · `GET /:id/trf16` (existing)
- student: `POST /:id/join` / `leave` (eligibility = same academy, and batch if set; not withdrawn)
- everyone: `GET /api/tournaments?academy=…` (upcoming / running / finished), `GET /:id` (players, rounds,
  standings, *my board* + its game id)

**Round start.** `pairNextRound()` → for each board publish a new lobby command
`arranged { white:"u:…", black:"u:…", clock, rated, tag:{t, round, board} }`; the lobby reuses `pair()`
(engine `setup` + `matched` to both players' live gateway connections). A player who is not connected
gets a pending "your board is ready" (in-app banner + push); opening the tournament page runs
`join g`. Colours come from JaVaFo, not the coin flip.

**Results in.** Subscribe to the game-engine `game-over` stream (or poll `live_games.finishedAt` for
tagged ids): map `game_id → (t, round, board)`, write `1-0 / 0-1 / ½-½`; aborted-before-move → replay
once, then double forfeit. **No-show sweep:** a board with no first move by `join_deadline_sec` →
forfeit `+/-` (TRF), so the round always closes. Round closes when every board is done → next round
after `round_gap_sec` (or coach presses next). Byes come from JaVaFo (odd counts).

## 5. Client
- Navbar Play group: `🏆 Tournaments` → `/play/tournaments` (list for my academy) and
  `/play/tournaments/:id`: header (name, time control, round x/n, status, countdown), **Join / Leave**,
  players, current round pairings with **"Play your board"** (→ existing `/play/game/:id` screen),
  live standings (existing arbiter standings), coach bar (open, start, next round, force result, finish,
  TRF16, publish to results.chessguru.cc).
- `Play.tsx` side panel card: "🏆 Guna Rapid — round 2 starts in 03:12 · Go" when the signed-in
  student is in a running tournament (polls `/api/tournaments?mine=1` every 15 s, like live-now).
- Round-start alert: web push (existing subscription) + in-app banner like `LiveClassBanner`.
- Academy dashboard: "Tournaments" tile with the last event's top 3 (feeds the leaderboard awards later).

## 6. Rules to settle with the owner (answers change the build)
1. Swiss only, or also **Arena** (Lichess-style: play as many games as you can in 60 min)? Arena needs a
   different pairing loop (no JaVaFo) — recommend Swiss first, Arena as M4.
2. **Rated** by default (ChessGuru rating moves) or casual? Recommend coach's choice, default casual.
3. Who creates — coach *and* owner, or owner only? Recommend both, scoped to the creator's academy.
4. Cross-academy / open tournaments — later (needs entry control + fair-play review first).
5. Time controls offered: rapid 10+0 / 10+5 / 15+10, blitz 5+3 / 3+2 (bullet excluded — anti-cheat).
6. Forfeit window: 3 minutes to make a first move? Coach can change per event.

## 7. Milestones
- **M1 — engine (≈1 week):** data fields, controller, `arranged` lobby command, result ingestion, forfeit
  sweep, coach-driven rounds; e2e with `bot-player` accounts filling an academy tournament.
- **M2 — students (≈1 week):** Tournaments pages, Join/Play-your-board, side-panel card, banner + push,
  auto next round, standings live.
- **M3 — polish (≈3–4 days):** rated option + fair-play flags in standings, TRF16/publish, prizes and
  leaderboard awards, coach "force result / withdraw player", tenant branding on public results.
- **M4 (optional):** Arena mode; open (cross-academy) events.

## 8. Risks
- Two players of one board on flaky phones: the game-engine already survives node loss and the client
  resyncs (`resync g havePly`); the tournament layer only needs the forfeit sweep to never wait forever.
- JaVaFo runs as a Java process per pairing (~1 s for 100 players) — fine; cap rounds pairing to one at a time per tournament.
- Same-account double join (phone + laptop) — the gateway already keys by user; the tournament page must
  not open a second seat.
