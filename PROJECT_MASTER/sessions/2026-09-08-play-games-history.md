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

## Also this session

**Starting rating deviation 350 (was 500).** `packages/glicko` `DEFAULT_DEVIATION`; play-engine
restarted 07:1x IST. First-game loss to an established 1187: −393 instead of −599; first win +69
instead of +104. Cluster test 28/28 (winner 1662 / loser 1338 on the first rated game). Puzzle
ratings keep their own copy (`apps/api/src/glicko`, d=500) — untouched.

**Students change their own password.** `POST /auth/change-password` (session; current +
new, new ≥ 6, accounts that only ever used the email code may set one without a current) +
`/settings/password` page (strength meter, repeat check, show toggle, success card). Reached
from the 🔑 beside the username in the header and a "🔑 Change password" row in the drawer
footer — the hamburger's Puzzles group was the wrong home for it (owner: "profile menu where?").
Tenant login (`TenantLogin.tsx`, NOT `Login.tsx` — the main-domain page) now says "Forgot your
password? Ask your coach — they can set a new one from the Students page", which is the existing
`POST /api/academy/students/:id/set-password` flow. Verified on gunachess.com with a throwaway
student through the real login form: wrong current → "Current password is wrong."; correct →
changed; old password refused, new one signs in; drawer link present on a phone width.

## Challenge answers no longer auto-reveal on the coach's screen (owner ask, 2026-09-08)

The coach's screen is shared with the class, so the answers panel popping open the moment a
challenge ended handed the solution to everyone still thinking.
- **Server** (`class-ws.ts`): on a student's FIRST answer (move or snapshot) the coach gets
  `challenge_answered { userId, displayName, answered, total }` — name and count, never moves.
- **Coach UI**: stacked bottom-left notices ("✅ Harinitharanjith answered (1/1)", "🧠 Challenge
  over — N answered. Open 📋 Answers when students can't see your screen."). `ChallengeAnswersPanel`
  never opens by itself any more; inside it every Moves cell reads "✓ answered · ••••••" and the
  ✓/✗ mark buttons are disabled until the coach presses **👁 Reveal moves** (amber bar explains
  why); **🙈 Hide moves** puts it back. Reveal state resets per challenge.
- Verified live with a coach + a student in a throwaway room: student dragged e2–e4 → coach notice
  and "1/1 answered" chip, no moves anywhere on the coach's screen; end → "Challenge over" notice,
  no dialog opened; open panel → hidden cell + disabled marks; Reveal → "1.e4" + marks enabled.

**Student side checked (owner: "in student screen also hide other students answers").** Already
the case — no change needed. Proof with a coach + two throwaway students in one challenge (stu1
played e4, stu2 played d4 e5): during and after the challenge neither student's page contained
the other's name or moves; `challenge_end` to students carries no answers; `GET /api/me/challenges`
returned only `myMovesSan` + `totalAnswers` (keys: classId, positionFen, startFen, prompt,
startedAt, endedAt, myMovesSan, myFinalFen, myTimeMs, correct, totalAnswers) with no other
student's name or moves anywhere in the JSON. Throwaway users and room data removed.

## Master Games section served 600-rated puzzles to 2000+ players (owner: "for some high rated player above 2000, puzzles 1300, 1100 suggested?"; akshay complained too)

**Finding.** Not the normal trainer — since the 24 Aug floor fix it never serves below
`rating − 250` and returns 404 when a theme has nothing at that level (probe as mageswaran
3013 / smotheredMate: 404). The leak was the **Master Games section** (`section=masters`):
mageswaran's 555 smothered-mate requests in the log were all `section=masters`, and the
picker's masters branch, once a theme's difficulty band was empty, fell back to *any* puzzle
with no rating constraint. Its premise ("every puzzle's rating = the loser's Elo, uniformly
hard") only holds for our own broadcast GM blunders — of which there are **0** in the DB. The
section is really the 830k Lichess `themes:"master"` puzzles, which carry ordinary ratings (a
one-move smothered mate from a GM game is rated 650). Live probe before the fix: 644, 666, 1346
for a 3013 player. Since 24 Aug: 949 solves by players ≥1800 were ≥250 below their rating, 14
users, mageswaran 609 of them, akshayprathab ~100 (attackingF2F7, skewer, smotheredMate,
backRankMate, mateIn1 — his 51 masters requests). Blindfold's low numbers are its own separate
rating and are fine.

**Fix** (`puzzles.service.ts`, API restarted 08:5x IST): the masters branch now serves the
Lichess master-game set in the same window as normal play (`target ± flex`, then ±400, then
replays), every step wrapped in `withFloor`, a themed request uses `themes: {$all: ["master",
theme]}` (the theme key used to overwrite the "master" constraint), and an exhausted theme
returns "no puzzle" instead of anything below the floor. The broadcast (`source`, unindexed)
queries only run when a specific player is requested — scanning for them was the 5–6 s latency.
Probes after: akshay 2122 → 1946/2075 mix, 2145 attackingF2F7, 1880 smotheredMate; mageswaran
3013 → 3109 mix, 404 smotheredMate; kashika → 1607; deepakcharanv hardest → 2554; all master
puzzles, 36–153 ms.
**Web:** the trainer used to sit on "Loading…" with an empty board when the picker answered 404.
`usePuzzleGame` now exposes `noPuzzle`; `Puzzles.tsx` overlays "No more <theme> puzzles at your
level — you are rated ≈N; everything near that you have solved, and puzzles far below your level
are never served" with **Mix all themes** / **Try again** (or **Normal trainer** in the Master
Games section). Verified as mageswaran on gunachess.com: overlay on Smothered Mate, Mix → a
2800-rated puzzle loads.
