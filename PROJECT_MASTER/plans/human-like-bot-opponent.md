# Human-like bot opponent for Play (Maia-3)

**Status:** LIVE (unrated) — Maia-3 bot shipped 2026-09-06; replaced as primary by the lc0 + Maia-1 1100–1900 ladder on 2026-09-07 (commit `e94b90e`, see [sessions/2026-09-07-play-bot-ladder-shipped.md](../sessions/2026-09-07-play-bot-ladder-shipped.md)). Maia-3 now serves only as a 25% variety draw inside its measured 1130–1690 band. Rated remains OFF pending the owner's call and the gateway token fix.

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

### Local install (France, `vps-2c160fde`) — done 2026-09-06

```bash
git clone --depth 1 https://github.com/CSSLab/maia3.git /home/dreamworld/opt/maia3
python3 -m venv /home/dreamworld/opt/maia3/.venv
# CPU wheel EXPLICITLY — plain `pip install torch` pulls multi-GB CUDA wheels
/home/dreamworld/opt/maia3/.venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu
cd /home/dreamworld/opt/maia3 && .venv/bin/pip install .
.venv/bin/maia3-cache --model maia3-5m
.venv/bin/maia3-uci --model maia3-5m --device cpu --no-use-amp
```

Installed **outside** the ChessGuru repo, deliberately — see the licensing rule below;
keeping it out of the tree makes accidental vendoring impossible. Got
`torch 2.14.0+cpu` (cuda build `None`), `maia3 0.1.0`; checkpoint cached under
`~/.cache/huggingface/`. Disk was 87% full, hence the CPU index.

UCI options confirmed live: `Elo/SelfElo/OppoElo` **spin, default 1500, min 0 max 5000**;
`MultiPV` default 5, min 1 max 20; `Temperature` 1.0; `TopP` 1.0.

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

### Calibration round 1 — measured 2026-09-06

`scripts/maia_calibration.py`, maia3-5m, ladder 800/1100/1400/1700/2000, full round robin,
30 games per pair, 300 games. Clean sample: **0 hit the 300-ply cap** (so no adjudication
bias), 12% draws, avg 73 ply.

| SelfElo | implied | delta |
|---|---|---|
| 800 | 1133 | **+333** |
| 1100 | 1286 | +186 |
| 1400 | 1393 | −7 |
| 1700 | 1499 | −201 |
| 2000 | 1688 | **−312** |

**Ladder span: nominal 1200 → achieved 556 (0.46x).** Every pairing is compressed; the
ratio ranges 0.29–0.64 with no pair above 0.64.

Raw games: [`research/maia-calibration-raw-games.jsonl`](../research/maia-calibration-raw-games.jsonl)
(300 games, 120 per level; recovered from `/tmp` 2026-09-06 before it was lost). Recomputed
independently with a mean-anchored logistic fit: span 609, slope 0.480 — same conclusion by
a different method.

> **Read this correctly.** The robust result is the **compression ratio**, not the implied
> column. Absolute numbers are anchored by construction — the ladder mean is pinned to the
> nominal mean — so "1400 is accurate" is an artefact of anchoring, not a finding. This is
> also Maia-vs-Maia only; self-play can compress a model against itself in ways that do not
> transfer. **A human anchor is still required.**

**Consequence for the design:** do **not** set `SelfElo` = the seeker's rating. A 900-rated
student would face something performing near 1150 and lose rating steadily; a 1900 student
would face ~1550 and farm it. The mapping has to be inverted through the measured curve,
which needs the human anchor first to place it on our actual Glicko scale.

**Still open before rated:** bot vs known-rated students, ≥200 games spread across the
academy's real band, comparing realised score to Glicko expectation. Until then the bot
ships **unrated** or not at all.

### Calibration round 2 — measured 2026-09-06, shipped config

Round 1 ran before `--use-uci-history` was added, so it described an engine we do not
ship. Re-run with the exact argv `apps/bot-player/src/engine.ts` spawns
(`--device cpu --no-use-amp --use-uci-history`), same ladder, 300 games, 8% draws, avg 71
ply, again 0 ply-cap hits.

| SelfElo | implied | delta |
|---|---|---|
| 800 | 1185 | **+385** |
| 1100 | 1202 | +102 |
| 1400 | 1349 | −51 |
| 1700 | 1572 | −128 |
| 2000 | 1693 | **−307** |

**Ladder span: nominal 1200 → achieved 508.** OLS over the five points gives slope
**0.462** (R²=0.94) and 1123 at SelfElo 800 — against 0.4625 and 1133 in round 1.

**The compression ratio did not move.** History conditioning changes which moves come
back, not how much SelfElo separation survives as playing strength. That is the useful
result: the `think.ts` mapping is robust to this config change, and the 10-point intercept
shift sits inside the noise of a 300-game sample — and is anchored by construction anyway,
so it was never the load-bearing number.

`think.ts` carries round 2's constants only so the shipped numbers come from the run whose
argv matches the shipped engine. Net effect on `selfEloFor()` is +22 SelfElo across the
usable band, roughly 10 points of real strength.

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

**Resolved 2026-09-06 — recover it by resampling, not by reading it.**

`uci.py:333` computes `policy` per candidate but **never prints it**. The info line emits
only `score cp` + `wdl`, and those come from the *value* head via a second forward pass
over candidate positions (`uci.py:336-354`). Observed at startpos: cp by MultiPV rank was
`104, 105, 31, 29, 75` — **not monotone**, because rank is policy order while cp is value.
So cp gaps are the wrong quantity and must not be used as the complexity proxy.

We cannot patch `uci.py` to emit policy (AGPL rule above), and importing `maia3` as a
library into our own process would be linking, a far stronger copyleft trigger than
stdio. Both routes are closed.

Instead: **`bestmove` is *sampled*, not argmax** — `uci.py:322` calls
`sample_from_logits` → `torch.multinomial`, with defaults `Temperature=1.0`, `TopP=1.0`
(verified live). Repeated `go` on one position therefore yields i.i.d. draws from the
policy, and the agreement rate between draws estimates the collision probability
`Σpᵢ²` — a legitimate concentration measure (order-2 Rényi entropy).

Measured, maia3-5m @ SelfElo=1200, 24 samples, MultiPV=1:

| position | distinct | top-1 | collision |
|---|---|---|---|
| Bxf7+, Kxf7 near-forced | 1 | 100% | **1.00** |
| startpos | 3 | 83% | **0.71** |
| quiet Italian middlegame | 7 | 38% | **0.24** |

Monotone across the full range and rating-conditioned for free. **K≈6–8 samples suffices**
in production (~70–100 ms each on CPU) — negligible against multi-second think times, and
**one of those samples is the move we play**, so move selection costs nothing extra.

Note ~70–100 ms/sample was measured even at MultiPV=1, above the 27 ms bare forward pass,
because the candidate value pass at `uci.py:335-354` runs regardless of MultiPV.

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

1. **Strength calibration** — ⚠️ STILL BLOCKS RATED. Round 1 (Maia-vs-Maia) done
   2026-09-06: **0.46x compression**, so `SelfElo` cannot map 1:1 to student rating. Round 2
   (human anchor, ≥200 games vs known-rated students) not started. See gate above.
2. ~~**Policy exposure via UCI**~~ — ✅ RESOLVED 2026-09-06, see think-time §1: policy is
   never emitted, but resampling `bestmove` recovers concentration through plain UCI.
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
