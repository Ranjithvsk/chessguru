# Human-like bot opponent for Play (Maia-3)

**Status:** PROPOSED — decisions settled with owner 2026-09-06, not yet built.

## Goal

When a player seeks an online game and no human is available, seed an opponent that
plays at roughly the seeker's rating, carries a plausible Indian name, and is not
distinguishable from a human by the player.

Academy sessions are small and time-zoned; the seek pool is frequently empty. A student
who waits 60s and gets nothing stops opening the app.

## Engine decision: Maia-3 (5M preset)

Maia predicts *what a human of rating X plays*, rather than playing well and being
handicapped. That is the whole problem, solved upstream.

Rejected alternatives:

- **Stockfish `UCI_LimitStrength`/`UCI_Elo`** — floors at ~1320, well above our students,
  and its errors are not human errors.
- **Stockfish `Skill Level`** — blunders in ways no human blunders.
- **lc0 at low nodes** — weak but alien.
- **LeelaQueenOdds** — built to *beat* weaker humans, not imitate them.
- **Maia-1** — nine separate lc0 weight files, `maia1100`…`maia1900`. Hard 1100 floor
  excludes our beginners.
- **Maia-2** — Python package, superseded by the lab's own recommendation.

**Maia-3** (Chessformer, ICLR 2026) speaks UCI natively, ships CPU-runnable presets, and
reaches 57.1% human move-match. `maia3-5m` is the "CPU, chess GUIs" preset.

### Verified properties (2026-09-06)

| Property | Value | Source |
|---|---|---|
| Elo range | `min 0 max 5000`, continuous | `maia3/uci.py:364-366`, `models.py:337-348` |
| Elo handling | linear interpolation between two learned embeddings anchored 0/5000 — no buckets | paper §4.2, γ=(5000−k)/5000 |
| Training coverage | rebalanced across 22 bins, 600–2600 in 100-pt steps + tails | [arXiv:2605.19091](https://arxiv.org/abs/2605.19091) |
| Evaluation span | 550–2950 | ibid. |
| CPU cost, MultiPV=1 | 27 ms/move @1 thread, 19 ms @4 (5,230,084 params, 21 MB fp32) | measured, 8-vCPU Haswell |
| CPU cost, MultiPV=5 | ~109 ms/move @1 thread (second batch-5 forward for WDL) | measured |
| Dependencies | standalone PyTorch — `torch, numpy, huggingface-hub, python-chess`. **No lc0.** | `pyproject.toml` |

**There is no 1100 floor.** Sub-1100 is genuinely covered. This was the main open risk
and it is closed.

## Licensing constraint (shapes the architecture)

- **Code: AGPL-3.0**, verified in the LICENSE body.
- **Weights: undetermined.** No `license:` key in any HF card frontmatter; card bodies
  contradict each other (79M says AGPLv3; 5M/23M/3M say "CC BY 4.0 (paper); see repo").
  Open unanswered issues: CSSLab/maia3 [#8](https://github.com/CSSLab/maia3/issues/8),
  [#11](https://github.com/CSSLab/maia3/issues/11), [#12](https://github.com/CSSLab/maia3/issues/12).
- **No non-commercial or research-only clause exists under any reading.** Commercial use
  is permitted; the ambiguity is about copyleft *scope*, not permission.
- `python-chess` is itself GPL-3.0+, inside the same process boundary.

AGPL §13 network copyleft triggers on running a **modified** version over a network.

> ⚠️ **Hard rule: never fork, patch, or vendor Maia-3.** Run the published package
> unmodified, as its own process, reached over a UCI stdio boundary. Every piece of our
> logic — think time, naming, disguise, matchmaking — lives outside that process. If we
> ever patch the engine, §13 bites and we owe Corresponding Source to every player.

This also means: no bundling the engine into `apps/bot-player`'s image as source, and no
"small fix" to `uci.py`. Anything the engine won't do, we do on our side of the pipe.

## Architecture

A separate `apps/bot-player` service that **joins the lobby as an ordinary client**.

The alternative — teaching `apps/lobby` and `apps/game-engine` about bots — would put
bot branches inside the clock and matchmaking paths that currently serve every real game.
Not worth the blast radius. As a lobby client, the bot exercises the same seek, match,
move and clock code as a human, so there is no second code path to keep correct.

```
apps/lobby  ──sweep() finds an aged seek──►  apps/bot-player
                                                  │  spawns / leases
                                                  ▼
                                            maia3-5m (UCI, unmodified)
```

- **Trigger:** `sweep()` (runs every 3s) flags a seek unmatched for **12–15s**.
- **Engine pool:** one long-lived `maia3-5m` process serving many games; at 27–109 ms per
  move and multi-second think times, throughput is a non-issue. No process per game.
- **`MultiPV=5`** — deliberately, for the policy spread (see think time). Cost accepted.
- **`SelfElo` = seeker's rating. `OppoElo` = seeker's rating.** `OppoElo` is not cosmetic:
  Maia models how people play *against* a given strength.

## Rated: yes

Owner decision, 2026-09-06. Follows from the disguise — if a player seeks a rated game and
is handed an unrated one, the UI itself gives the bot away.

`live_games` carries **`vsBot: true`**, internal only, **never serialised to the client**.
Without it we cannot answer a parent asking who their child played, and we cannot exclude
bot games from analytics.

> ⚠️ **Gate: strength calibration must be measured before rated go-live.**
> `SelfElo=1400` means "predicts what a 1400 *plays*" — it is **not** a guarantee the
> engine *performs* at 1400. Maia-1's playing strength was known to be compressed relative
> to its target band. If Maia-3 at `SelfElo=1400` actually performs at 1550, every hidden
> bot game silently inflates or deflates real student ratings.
> Measure empirically across our actual rating span before this touches a rated game.

## Disguise: full, no badge

Owner decision, 2026-09-06 ("no not badge").

- Plausible Indian display name from a curated pool; stable per bot identity for the game.
- No badge, no marker, no client-visible field distinguishing it.
- The `vsBot` flag stays server-side.

Note `Play.tsx:66` currently renders the opponent as a bare user id
(`p.opponent.replace(/^u:/, "")`) with no rating or avatar — the bot must present through
the same shape, and improving that display is a separate change that would affect both.

## Think time — the actual work

Maia gives us moves, not timing. **A bot answering in 40 ms every move is the tell people
actually notice**, and it is the single highest-value part of this plan.

### 1. Policy spread as the complexity signal

Maia's own move distribution tells us how obvious the position is *to a player of that
rating*. Concentrated top-1 probability → obvious → move fast. Flat distribution →
genuinely hard for that band → tank.

This is free, already rating-conditioned, and means we never hand-tune "what looks hard"
per level. It falls out of the model. This is why we run `MultiPV=5`.

*Open:* confirm whether Maia-3's UCI layer exposes policy probability per line or only a
score. If only scores, derive the spread from the score gap between lines instead.

### 2. Forced moves are near-instant

Only-legal-move, obvious recaptures, single sane check evasion — humans play these well
under a second. **A bot thinking 8s on a forced recapture is a dead giveaway.** This case
must short-circuit the sampler entirely.

### 3. Clock pressure compresses everything

Under ~10s remaining, humans move in fractions of a second and premove. Move times must
collapse accordingly, with a flag-avoidance floor so the bot does not lose on time in a
won position.

### 4. Log-normal, not uniform

Human move times are heavy-tailed. Sample around a median rather than a flat range, and
allow rare long thinks — a 30s tank once or twice a game reads as human; a consistent
4–6s every move reads as a script. Total time usage across the game must also look sane,
not just each move in isolation.

### Deliberately out of scope for v1

**Coupling speed to move quality.** Humans blunder more when rushing — real, but it means
overriding Maia's chosen move. First establish whether Maia alone is convincing; adding a
corruption layer on top of a human-move model is how we end up with neither.

## Open items

1. **Strength calibration harness** — blocks rated go-live. See gate above.
2. **Policy exposure via UCI** — does MultiPV give probabilities or only scores?
3. **Resign / draw behaviour** — Maia has none. A bot grinding K+Q vs K to mate in a dead
   lost position is a tell. Needs a rating-plausible resign threshold.
4. **Abort / disconnect behaviour** — humans sometimes vanish. Never doing so is itself a
   pattern.
5. **Name pool** — curated, regionally plausible, no collisions with real usernames.
6. **Weights license** — track CSSLab/maia3 #8/#11/#12; re-check before any distribution
   beyond serving play.
7. **Seek-pool interaction** — a bot must never match another bot, and must yield
   instantly if a human arrives during the trigger window.

## Verification plan

- Calibration: bot vs bot across `SelfElo` ladder, and bot vs known-rated students;
  compare realised performance to target.
- Timing realism: compare the bot's move-time distribution against real `moveTimes` already
  stored in `live_games` for the same rating band and time control.
- Disguise: blind test — show coaches anonymised game records and ask which opponent was
  the bot.
- Isolation: confirm `vsBot` never appears in any client payload.
