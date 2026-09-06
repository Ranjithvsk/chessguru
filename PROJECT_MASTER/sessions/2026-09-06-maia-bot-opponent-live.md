# 2026-09-06 — Maia-3 bot opponent live, plus two lobby bugs

## Why

Owner reported quick pairing still stuck on "Searching for an opponent…" after the
previous session brought the play backend up. Two separate causes: nothing was in the pool
to match against (the bot existed only as a plan document), and a real bug was leaving
dead seeks behind.

## What changed

### 1. Ghost seeks (`apps/ws/src/router.ts`, `apps/lobby/src/main.ts`)

`onClose` tore down game subscriptions but never published `unseek`. A closed tab left its
seek in Redis forever, so the next player "matched" a socket that no longer existed and sat
on a board where nothing would ever move. Confirmed in production — the single stale pool
entry was the owner's own abandoned seek, with zero gateway connections open.

- `router.ts` now publishes `unseek` on close.
- `onUnseek` only cancels when `pm.conn === e.conn`. Seeks are keyed by user, so a second
  tab supersedes the first; without this check, closing the first tab would cancel the seek
  the second one is waiting on.
- `sweep()` drops seeks older than `SEEK_MAX_MS` (10 min) as a backstop for a gateway that
  dies without sending `unseek`. Needed: an abrupt RST does not reliably fire `onClose`, so
  that path still depends on uWS idle detection plus this sweep. Graceful close — what a
  real closed tab does — is handled immediately.

### 2. Colour assignment (`apps/lobby/src/main.ts`)

Seats followed arrival order, so the longer waiter always got white. Found while reasoning
about the bot: it joins second every time, so it would have played black in *every single
game*. `pairSeek()` now coin-flips. `onAccept` still gives white to the challenger, which is
correct for a direct challenge.

### 3. `apps/bot-player/` (new)

Four modules. Talks to the gateway on loopback as an ordinary WS client, so it goes through
exactly the same seek/match/move path a browser does — no privileged backdoor.

- `engine.ts` — one long-lived `maia3-uci` process, serialised through a promise tail.
  `SelfElo`/`OppoElo` are process-global, so two games must never be mid-`go` together.
  Each think draws 4 independent policy samples: the first is played, the pairwise
  agreement rate across the rest (order-2 Rényi collision probability) estimates how forced
  the position is.
- `think.ts` — `selfEloFor()` inverts the measured compression curve; `thinkMs()` turns
  clock, ply and collision into a plausible human think time (lognormal σ=0.45, openings
  fast, 4% long thinks, time-trouble scaling).
- `names.ts` — 30 first × 24 surnames = 720 lowercase `first_last` names, filtered against
  `users._id` at startup so a bot can never collide with a real account.
- `session.ts` — one game. Resigns on a *material* heuristic, deliberately not an
  engine-evaluation one: the value head's sign convention is unverified, and resigning a
  won game is a far worse tell than never resigning at all.
- `main.ts` — watches the pool, waits a randomised 11–18s before stepping in.

AGPL-3.0 §13 is respected throughout: Maia-3 runs unmodified as its own process, reached
only over the UCI stdio boundary. Never forked, patched, vendored or imported.

## Two things that were nearly wrong

**Bot targeted the wrong player.** I first picked the *oldest* waiting seek. But `MATCH_LUA`
pops by `ZRANGEBYSCORE`, so a wide-range seek pairs with the **lowest-rated** player in the
pool — not the longest waiter. Caught before deploy. Left alone, `SelfElo` would have been
set for a player the bot was not actually going to face, quietly poisoning the very dataset
round-3 calibration depends on.

**Calibration described an engine we do not ship.** `--use-uci-history` was added to the bot
after round 1 was measured. Re-ran the full 300-game ladder with the exact shipped argv
(round 2, see the plan doc). Compression ratio did not move: slope 0.462 vs 0.4625. The
constants in `think.ts` were updated anyway so their provenance matches the shipped engine.
Both argvs now carry a lockstep comment pointing at each other.

## Verification

- E2E through the **public** URL (`wss://chessguru.cc/ws`), single client, empty pool:
  matched as `u:ramya_reddy`, played 9 real moves (e5 c5 d6 Bxh3 Bd7 exf4 Qh4+ fxg3 g2+),
  think times 1.0–7.7s, mean 4.1s. Logged to `bot_games` with `selfElo: 1594`.
- Ghost seek, graceful close: pool key gone, `seek:meta` 0, `seek:byuser` 0.
- All three touched packages typecheck clean.
- Weights copied to `/home/ubuntu/.cache/huggingface` with `HF_HUB_OFFLINE=1` — the engine
  must never reach for Hugging Face at move time.

## Open

- **Rated play is still gated.** `SelfElo`→strength is anchored by construction and has no
  human anchor, so v1 ships unrated. `Play.tsx:162` already always seeks unrated, and
  `main.ts` filters `!m.rated`, so this holds on both sides. Live games now accumulate the
  human-anchored dataset round 3 needs.
- Abort/disconnect behaviour for the bot side is not implemented.
- `/home/ubuntu/chessguru`'s git origin URL contains a plaintext GitHub PAT. That clone also
  carries 376 dirty files.
- Proposal, not done: symlink `apps/{ws,lobby,game-engine,bot-player}/src` from the ubuntu
  clone to dreamworld, matching the existing api/web pattern, so the play services cannot
  drift. Used rsync this session rather than making that change unrequested.
- Test rows left in Mongo pending owner OK to delete: `live_games` `g-b3af1586-ab5`,
  `g-485b1658-cee`, `g-2b4c2f65-1eb` (all `rated: false`) and one `bot_games` row.
