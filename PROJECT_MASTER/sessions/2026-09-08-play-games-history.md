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

## Assisted solving: mageswaran reset, detector rewritten, coach panel (owner: "do all three, reset him to 1700")

**Evidence (30 days):** 1314 → 3043 in 19 days; on 2500–2800 puzzles 91% wins at a 9.8 s median
(deepakcharanv 67% / 26 s, akshayprathab 63% / 32 s, the coach gunachess 32% / 46 s); eight
fastest 2600+ wins in 2.6–3.8 s with 1.2–1.3 s between every move; slower and less accurate on
1800–2200 (21 s, 84%) than on 2500–2800 — backwards for a human. Zero dubious flags because the
old rule only fired on a puzzle 300+ above the player, which a climbing rating never is.

**Reset:** `userperfs.mageswaran.puzzle.gl` 3013/d109 → 1700/d200, all 57 per-theme ratings
clamped to 1700 (d≥200), `ratingAdjustments` audit row, `users.puzzleRatingResetAt`.

**Detector** (`glicko.ts assessSuspicion`, used in `complete()`): flags `fast_above_level`
(300+ above, <4 s), `fast_hard` (2400+ puzzle <4 s at any rating), `metronome` (2200+, <8 s,
every move gap 0.7–1.7 s), `streak` (2400+ <6 s while 4 of the last 10 hard wins were <6 s).
A flagged win is recorded with `dub:true, dubr:[…]` but moves NO rating (global or per-theme)
and logs `[dubiousSolve]`. Proof with a throwaway 1600 student: 2.5 s win on a 2550 →
`dubious:true`, rating 1600 unchanged, three reasons; a 45 s win → +15.

**Panel** (`GET /api/academy/suspicious-solves?days=`, coach = own roster, owner = academy):
per student flagged count + reasons, 2400+ win% / median / sub-5 s count, three fastest hard wins
(link to review, per-move times on hover), climb, last reset. Score = flags×3 + fast hard wins×2
(+3 for a ≥500 climb only alongside speed signals, +2 for ≥85% on 10+ hard puzzles only if the
median is <15 s); listed at score ≥4 — a climb from a provisional start alone lists nobody.
`AcademySuspiciousPanel` on `/academy/performance` (with empty state) and compact on `/academy`
(hidden when clean). Owner-only **Reset rating…** → `POST /api/academy/students/:id/reset-puzzle-rating
{rating, reason}` (same clamp + audit as the manual reset). Verified as gunachess: 5 rows
(mageswaran 99, deepakcharanv 17, haritha 10, sabarivasan 8, test 5), reset endpoint 1615 → 1200
with audit, students get 403. Throwaway removed.

---

## Fair Play Trainer — Phase 1 BUILT & LIVE (2026-09-08, evening)

Owner decisions fixed before the build: **students are never told**, **reset stays owner-only**, **Review starts at 60**. Design: `plans/puzzle-anti-cheat.md`.

### What shipped
- **Trust score** `apps/api/src/fairplay/score.ts` — pure `scoreStudent(rounds, crowdMedian)` over the window (last 30 d or since the last reset). Components: flags 8 per flagged solve *beyond the first* (cap 40) · fastHard 2 per 2400+ win under 5 s (cap 30) · accuracy 15 (win% 200+ above ≥ win% at level, n ≥ 10 each, or 85%+ on 10+ hard) · crowd 15/8 (typical win < 25% / < 40% of the crowd's time, n ≥ 10) · climb 10 (≥ 500 with 3+ flags or fastHard ≥ 15). Bands clear < 25 / watch 25–59 / review ≥ 60. Solves before the detector went live get the same detector replayed over their stored timings (`withRetroFlags`) so the score means one thing across the boundary.
- **Drills don't count.** One-move puzzles never flag (a 1050 kid solving 1500 mate-in-1s in 3 s is pattern recognition). Mate-theme drills (`mateIn2`, `smotheredMate`, … — the solver was told the pattern) tighten the 4 s limits to 2 s, need three metronome gaps, no streak; they are excluded from the speed/accuracy components. `isDrill/isMateTheme/isOneMove` in `glicko.ts`. Metronome now needs **two** gaps (a single quick forced reply is human).
- **New live flags** in `assessSuspicion`: `crowd_fast` (1800+ puzzle won in < 15% of the crowd median, median ≥ 8 s) and `focus_loss` (tab/window hidden ≥ 3 s after load, first move ≤ 2 s after returning; client telemetry `focus{hiddenMs,hiddenCount,firstMoveAfterReturnMs}` from `usePuzzleGame.ts`, stored on the round as `fx`).
- **FairplayService** (`@Global` module, one instance shared by PuzzlesService + AcademyService): nightly 21:00 UTC — rebuild crowd baselines (`puzzleSolveStats` per puzzle n ≥ 3, `crowdBands` per 100 pts, `$median`) → score every academy student → `fairplay` doc per student → on entering Review: `hold:true`, `fairplayEvents{kind:review}`, **email to the academy owner** once. Leave-one-out band medians per student (a heavy solver was a big share of "the crowd" on hard puzzles). Monday 02:00 UTC digest per academy owner (entered Review / on hold / Watch / resets this week), silent when there is nothing to say. Jobs guarded by `fairplayJobs`.
- **Hold**: `complete()` checks `isHeld(userId)` (60 s cache) — a held win records normally, `ratingDiff 0`, no perf/theme update, round `held:true`, nothing in the response. A hold persists until `resetPuzzleRating` (owner) calls `clearAfterReset` — score decay never lifts it; a held student stays listed even if Clear.
- **Panel** (`AcademySuspiciousPanel.tsx`): band pill + score bar per row (days toggle gone — the window is fixed), **Details drawer** per student: score breakdown with the evidence behind each component, speed-vs-difficulty scatter (log seconds; flagged red ring, held amber ring, 5 s floor), rhythm strip of the fastest 2400+ wins (per-move gaps), sessions timeline. Endpoints: `GET /api/academy/suspicious-solves` (roster scored on demand), `GET /api/academy/suspicious-solves/:id` (drawer), reset unchanged.
- Scripts: `apps/api/scripts/fairplay-backtest.ts <users…>` (day-by-day replay), `fairplay-nightly.ts` (run the nightly by hand; `DIGEST=dry` renders the digest without sending).

### Backtest (acceptance)
| student | score today | first Watch | first Review | note |
|---|---|---|---|---|
| mageswaran | 100 | 28 Aug | **28 Aug** (day 1 of the assisted phase — 19–24 Aug was honest: 16–32 s medians, 72–83%) | flags 40 · fastHard 30 · accuracy 15 · crowd 8 · climb 10 |
| deepakcharanv | 2 | never | never | a 4–7 Sep burst of quick 2400+ wins was a mateIn2 drill → discounted |
| akshayprathab / gunachess / ashwanth / haritha | 0 / 0 / 0 / 2 | never | never | ashwanth + haritha were false positives before the drill rule (mate-in-1 / mate-in-2 drills) |

Before the drill rule the live Phase 0 detector would also have zeroed honest gains on mate-in-1 drills — no live solve had been flagged yet today, so no harm done.

### Verified live (throwaway student in Guna Chess, forged sessions, all deleted after)
hold → win gives `ratingDiff 0`, round `held:true`, rating unchanged · owner list keeps a hold · owner reset → hold lifts, window restarts, next win +137 · five `focus_loss` solves → each `ratingDiff 0`, `dubr:["focus_loss"]`, `fx` stored → student listed on **Watch 32** · `crowd_fast` fires at 1.5 s on a 2000 puzzle (band median 16.1 s) · a coach outside the roster gets "not in your roster" · owner UI on chessguru.cc: panel row + drawer render (screenshots in scratchpad) · seed nightly scored 98 students: 0 Review, 0 Watch · digest dry run renders correctly. Nothing was emailed to the owner (no Review transitions).

### Open
- Crowd baseline is thin (4 heavy solvers on 2400+): the crowd component reaches 8 for the real case, never 15. It will firm up as more academies solve.
- `focus_loss` is only sent when the tab/window actually left — a second device or a phone beside the screen is invisible to it (by design; see plan Phase 2).
- Owner email for Review goes to the academy owner's `users.email`; academies whose owner has no email get the event only (panel + digest skip).

---

## Fair Play Trainer — Phase 2 BUILT & LIVE (2026-09-08, night)

Scope from the plan: coach actions, two more signals, proctored exams/homework. The plan's **"Message the student"** action was dropped — it contradicts the owner's "students are never told".

### Decisions (Clear / Hold), audited as labelled examples
- `POST /api/academy/suspicious-solves/:id/clear {note}` — coach or owner. Restarts the window (`fairplay.clearedAt`), drops the student off the list, stores `decision{kind,by,note,at}`; **a coach's Clear on a held student is refused** ("only the owner can clear or reset a hold"). `fairplayEvents{kind:"clear", label:"honest", score, components}`.
- `POST …/hold {note}` — coach or owner: `hold:true` (rated gains stop, silently) until the owner resets or clears. `fairplayEvents{kind:"hold", label:"assisted", …}`. Reset now records the reason as a decision too (`label:"assisted"`).
- Panel: **Clear…** / **Hold…** on every row and in the drawer (note prompt → confirm); the last decision shows as a chip on the row when the student is listed again; a **Recent decisions** strip (last 12 for the roster: cleared / held / reset / entered review, by whom, note, score at the time). Phase 3 trains on these labels.

### Two new signals (`ScoreExtras` in `score.ts`, loaded in `FairplayService.extrasFor`)
- **Theme spread** — per-theme puzzle ratings with 20+ solves: 8+ themes and player 2000+, sd < 40 → +10, < 60 → +5. Honest students measured at sd 92–121 (deepak 121 over 23 themes, akshay 109/31, haritha 92/8, ashwanth 116/13); gunachess 61 over 7 themes (below the 8-theme minimum anyway).
- **Play cross-check** — best `live_perfs` speed with 10+ rated games (`_id` is `u:<userId>`): puzzle rating 800+ above → +10, 600+ → +5. Almost nobody has 10 rated games yet; it will matter as Play grows.
- Both show in the drawer's breakdown. Replay unchanged: mageswaran 100 / everyone else Clear; reseed of 98 real students: nobody moved.
- Rejected: theme *win-rate* flatness — calibrated on 8 students, honest solvers around 50% are as "flat" (sd 8) as the assisted one (sd 6); ceiling effect.

### Proctored exams (`exams.proctored`, default **on** for new exams; toggle on Create and Edit)
- Student: a gate card before the attempt ("opens in full screen… leaving is recorded") — the Start click is the user gesture full screen needs. During the attempt every tab/window/full-screen change is recorded: per position (`answers[].focus{hiddenMs,hiddenCount,fsExits}`, sent with the answer) and for the attempt (`attempt.proctor{hiddenMs,hiddenCount,fsExits,fsSupported,fsUsed,events[≤200]}`, sent with finish). Leaving full screen shows an amber "Return to full screen" bar. Devices without the full-screen API (iOS) still record focus.
- Coach results table: **Proctor** column — `🛡 clean`, `left 2× · 14 s · fs exit 1×` (amber; rose from 3 leaves or 30 s), `no data` (older attempts), `not proctored`; tooltip has the detail. Older attempts are untouched.
- Homework: the trainer already records focus per solve (Phase 1). Now a solve that credits homework is stamped `rounds.hw:[homeworkIds]` (from `autoCreditHomework`), and the coach's homework list carries `proctor{solves,focusLoss,hiddenMs,flagged}` → chip on the dashboard's Recent homework card ("🛡 1/2 lost focus", "focus kept"). No full screen for homework — it is solved in the general trainer.

### Verified live (throwaway student + coach in Guna Chess, forged sessions; all deleted after)
Five focus-loss solves → Watch 32 · coach Hold with note → `hold`, event `hold/assisted/32`, win while held gives 0 · coach Clear on held → refused · owner Clear → hold off, `clearedAt`, off the list, both decisions in *recent*, next win +26 · five more flagged solves → re-listed with "cleared by gunachess" on the row · coach Clear (not held) → ok · coach outside the roster → refused · exam: answer with focus + finish with proctor stored and returned to the owner (`hiddenCount 1, 6 s, fs exit 1`, 4 events, per-answer focus) · homework: two fork solves stamped `hw:[id]`, coach list `proctor{solves:2, focusLoss:1, hiddenMs:5000}` · browser as student: gate → Start engaged real full screen (`document.fullscreenElement` set) → badge → simulated blur/focus → answers → finish → results; as owner: results table "left 1× · 2 s" (browser attempt) and "left 1× · 6 s · fs exit 1×" (API attempt); panel row with Clear/Hold/Reset, decision chip, recent strip, drawer with Theme spread + Play cross-check lines.

### Open
- Coach Clear lifts nothing on a held student by design; the owner's Clear does. A Clear restarts the window, so the same evidence never re-lists them — new evidence does.
- Play cross-check uses the best speed with 10+ games; a student who only plays bots rated is still "rated play" (bots are rated by owner decision).

---

## Fair Play Trainer — Phase 3 BUILT & LIVE in shadow (2026-09-08, late)

The plan said Phase 3 comes "after a month of decisions". There are **zero coach decisions yet**, so the fitted model cannot take over honestly. Built so it learns from day one and switches itself on only when it has earned it.

### Labelled examples (`FairplayService.labelledExamples`)
- Every `fairplayEvents` row with `label` (Clear → honest; Hold / Reset → assisted) carries the score components at the time — that is the training row.
- Resets made before decisions were evented (`ratingAdjustments`) are replayed: components over the 30 days before the reset → assisted. Today that yields exactly one example, mageswaran (40/30/15/8/10/0/0 → model 100).

### The model (`apps/api/src/fairplay/model.ts`, pure)
- Logistic regression on the seven components scaled by their caps. **Prior centred on the hand weights**: weights `cap/12`, bias `−5`, so `score = 60 + 12·logit(p)` reproduces the hand score exactly with no data; every decision pulls it away (L2 toward the hand weights, λ 0.3, gradient descent, no deps).
- `train()` → weights, `n` per label, leave-one-out replay (`cv`: accuracy, false alarms, missed), `active`, `reason`. **Gate**: ≥ 10 assisted and ≥ 20 honest decisions and leave-one-out accuracy ≥ 0.9; otherwise shadow.
- Nightly `refitModel()` (in `runNightly`, before scoring) → `fairplayModel{_id:"current"}` + `fairplayModelHistory`. `scoreUser` computes `handScore` and `modelScore` every time; `score`/`band` come from the model only when `active`. `fairplay` docs store both plus `modelActive`.
- Panel: "🧠 Learning from your decisions: shadow — needs 10 assisted and 20 honest decisions (have 1 / 0)"; rows show `model N` when the shadow score differs; the drawer says which is in use.

### Monthly fairness report (`fairnessReport(academyId, "YYYY-MM")`)
- Solves and flagged solves by the academy's students that month; students put on the list (new `watch` events, plus `review`); **false alarms** = students cleared that month who had been listed before → **per 500 solves, target < 1**; catches = held or reset (incl. audited resets); **time to Review** = hours from the first flagged solve in the window to the Review event, median, **target < 24 h**; decisions; model status and hand/model band agreement.
- `GET /api/academy/fairplay-report?month=` (coach/owner) → panel "Fairness report" section with a three-month picker and on-target / above-target badges. Emailed to each academy owner on the **1st at 03:00 UTC** for the previous month (`runMonthly`, job-guarded); silent for academies with no solves.
- September so far (Guna): 3014 solves by 33 of 90 students, 1 flagged, 0 listed, 0 false alarms (on target), 1 catch (mageswaran), no Review yet, model shadow 1/0, agreement 91/91.
- `scripts/fairplay-model.ts [users…]` (`REPORT=<academy>:<YYYY-MM>`) lists the examples, refits, prints hand→fitted weights and leave-one-out; `fairplay-nightly.ts` gained `MONTHLY=dry`.

### Verified
Seeded example from today's reset · refit stays at the hand weights (flags 3.33→3.38, bias −5→−4.94 with one positive) · clean students score 0 hand / 1 model · list response carries `model` · report endpoint for 2026-09 / 2026-08 / bad month → defaults to this month · monthly dry run renders for both academies without sending · owner UI shows the status line, the report with badges and the month picker.

### Open
- The acceptance ("< 1 false alarm per 500 solves on cleared students; median time to Review < 24 h") is measured by the report every month; it cannot be claimed until there are decisions.
- Today's manual reset audit row lacked `academyId` — patched in place so the report counts it.

---

## Fair Play — detailed Fairness report page for coaches (2026-09-08, late)

Owner ask: *"detailed fairness report, with many features for coach to understand what issues happened, how it was detected by fairness engine."*

- **Page** `/academy/fairness?month=YYYY-MM` (`apps/web/src/pages/AcademyFairness.tsx`; menu → 🛡 Fairness report; "Full report →" on the panel; printable). Owner sees the academy, a coach their own roster (`scope`).
- **API** `GET /api/academy/fairplay-report/detail?month=` → `FairplayService.fairnessReportDetail` (0.4 s on Guna's September). Sections:
  1. **At a glance** — solves, flagged, listed, false alarms per 500 (target), catches, time to Review (target), held wins, decisions.
  2. **Incidents** — one card per student with any event / audited reset / current Watch-Review-hold this month: header (band now, rating, peak score + day, counts), **timeline** (first flagged solve, score peak with the component split, Watch, Review, owner emailed, Hold/Clear/Reset with who), **daily score sparkline** (trailing-30-day score per day of the month, Watch/Review lines), **How it was detected** — `explainDetection()` writes numbered plain-words sentences per component with the points ("31 wins on 2400+ puzzles took under 5 s — they won 94% of 133… the academy's honest solvers take 25–50 s there. Worth 30 points."), **What the engine did** (flagged wins with no rating, held wins, Review entry + hours after first flag, owner email, the decision), **evidence table** (each flagged solve: time, puzzle link to replay, rating, seconds, per-move gaps, rule names; plus the fastest hard wins), proctored-exam leaves, decision box with note.
  3. **What the engine did this month** — the six live rules in coach words with solves/students each; fast solves on 2000+, excused as drills, left-the-tab solves, held wins.
  4. **Exams and homework** — proctored attempts clean/left with per-student leaves; homework solves that lost focus.
  5. **Signal health** — crowd baseline coverage + band medians; model status + leave-one-out; hand-vs-model disagreements.
  6. **How detection works** — the rules, the score, the bands, decisions, proctoring, "students see none of this".
- **Replayed flags.** Solves before the live detector (8 Sep) carry no stored `dub`; the report replays the detector (`withRetroFlags`, exported from `score.ts`) so the evidence and the 40 flag points are explained, and says plainly that those wins *did* move rating at the time. Audited resets without an event become the decision. `RULES` (labels + meanings) and `explainDetection` are exported for reuse in mail.
- Verified on Guna September: mageswaran card — first replayed flag 3 Sep 08:58 (2579 in 5.2 s, engine rhythm), peak 100 on 3 Sep (40/30/15/8/10), reset 8 Sep with the audit note; 55 flagged solves (47 streak, 30 fast hard, 11 rhythm); the six "how" sentences; evidence rows with 1.1–1.8 s gaps. Coach `sarika`: roster scope, 2 students, 0 incidents. Page renders on chessguru.cc without script errors; screenshots in scratchpad.
