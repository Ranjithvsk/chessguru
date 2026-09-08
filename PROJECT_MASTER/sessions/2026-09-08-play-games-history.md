# 2026-09-08 — Play: "My games" history + replay viewer; Play menu cleaned up

Owner: *"need history of played games and its status like puzzle history — think and plan deeply,
build with modern, colourful, interactive UI"*, *"for replay viewer use board and notation panel
features from Dream Meet"*, and *"[the Play menu's Live class entry] — no need, just remove that"*.

## What landed

**API** `apps/api/src/live-games/` (`/api/live-games`, session-only, 401 for guests):
- `GET /api/live-games?speed&outcome&rated&offset&limit` — the caller's finished games from
  `live_games` (aborted games are never archived), newest first, each viewed from THEIR side:
  `outcome` win/loss/draw, `reasonText` ("Opponent resigned", "You ran out of time", "You left
  the game"…), `myColor`, opponent name (users.username, bots' ids as-is — same namespace by
  design), `ratingBefore/After/Diff`, `opponentRating`, plies, duration.
- `GET /api/live-games/stats` — totals, win rate, current/longest win streak, time at the board,
  colour split, best rated win, last-10 form, per-speed W/L/D + current rating from `live_perfs`
  with `provisional` = Glicko deviation > 110 (shown as "723?").
- `GET /api/live-games/:id` — owner-only (404 otherwise) replay payload: SAN per ply, FEN per
  ply, check flags, both clocks after every ply (initial − think time + increment from the
  engine's `moveTimes`), and a PGN with headers.

**Web**
- `/play/history` (`PlayHistory.tsx`): gradient hero with win-ring (SVG, animated arcs), W/L/D
  tiles, form dots, four per-speed rating chips with sparklines (also act as speed filters);
  stat tiles (streak, time played, colour split, best win); filter pills (speed / result /
  rated); games grouped by day as cards with outcome colour bar, gradient avatar, badge,
  reason, speed·tc·rated, moves·duration·time-ago, rating delta pill, "Replay ▶"; empty and
  signed-out states; "Show more" paging.
- `/play/games/:id` (`PlayGameReplay.tsx`): the class-room look — same `Board`, player bars
  with per-ply clocks, the class footer's `← n / N →` pill plus ⏮ ⏭, play/pause with 0.5×–4×,
  flip; keyboard ← → Home End space f; result card with rating before → after; the notation
  panel as a reusable `MoveTable` (class-room styling: number gutter, two columns, brand pill
  on the active ply, click to jump, thinking-time bars under moves); thinking-time averages;
  Copy PGN, Analyse this position (board editor), Play again.
- Play page: "📜 My games" strip (form dots + per-speed rating, refreshed after each game) and a
  "▶ Replay" button next to Rematch when a game ends; signed-out strip nudges to sign in.
- Navbar Play group: "Live class" removed (it pointed at the retired `/class` route, which
  bounced to the dashboard); Play's blurb updated; "📜 My games" added.

## Verified on production (Playwright, signed in as the owner's student account)

| check | result |
|---|---|
| history page | 2 cards (LOSS · You resigned · −178; LOSS · You left the game · −599), ring 0%, rapid chip "723?", form L L |
| Wins filter | 0 cards + "Nothing matches these filters" |
| replay | opens at 38/38, ← → 37/38, Home → start, space → autoplay reaches 2/38, click move 10 → 10/38, 28 pieces on board |
| Play page | strip "📜 My games L L 🐇 723? 2 games →"; "Live class" absent from the menu |
| API | guest → 401; someone else's game → 404 |

## Worth knowing

- The owner's student account went 1500 → 901 → 723 in two rated rapid games. Glicko-2 starts
  every player at deviation 500, so the first results swing by hundreds of points; the "?"
  provisional marker is the honest signal until the deviation settles. If that feels too harsh
  for beginners, the knob is `DEFAULT_DEVIATION` in `packages/glicko` (Lichess uses 350) — not
  changed here.
- Leaving a rated game counts as a loss ("You left the game" = the opponent claimed after the
  grace period). That is the abandonment rule from 2026-09-07 doing its job.
