# Plan (deep): Realtime online play — architecture

**Status:** PROPOSED (2026-05-30) · companion to [online-play-international.md](online-play-international.md)
(§5 of that doc is the summary; **this** is the deep design). Scope = the hard part: **human-vs-human
realtime games at international scale**, on Node (no Akka), reusing the v2 NestJS+Mongo+Redis stack.

> **Authority note:** nothing here exists in code yet. ChessGuru's only socket today is the
> engine-battle WS (`engine_runner.js`): a **single-node broadcast** server (`bc()` → all clients),
> spectator-only, no per-game routing, no server clocks. It proves the transport, not the architecture.
> This doc specifies what must be built.

---

## 0. The one hard problem

Everything else is plumbing. The hard problem is: **a chess game is a tiny state machine that two
people mutate concurrently, over unreliable networks, where the clock is part of the state and
milliseconds decide wins.** Get these four invariants right and the rest follows:

1. **Single writer per game.** Exactly one process may mutate game `G` at any instant. No locks, no
   races, no two nodes disagreeing about whose turn it is.
2. **Server-truth clocks.** The client never decides time. The authority computes remaining time
   monotonically and is the sole judge of a flag (timeout).
3. **Idempotent, ordered moves.** Every move carries a ply index; the authority rejects stale/dup/out-of-turn.
4. **Survivable.** A crashed node loses no in-progress game; it rehydrates elsewhere within seconds.

lila solves #1 with Akka actors (1 game = 1 actor, mailbox-serialized). We have no actor runtime, so
we **build the equivalent**: a *grain directory* (Orleans-style) + a per-game serialized event loop.

---

## 1. Service topology

```
                         Cloudflare (TLS, WAF, regional PoPs)
                                       │
        ┌──────────────────────────────┼───────────────────────────────┐
        │ static web (React/Vite)       │   WS GATEWAY tier              │   ← stateless socket pipes
        │  apps/web (CDN)               │   apps/ws  (uWebSockets.js)    │     hold connections only,
        └──────────────────────────────┘   N nodes · regional           │     relay JSON ↔ Redis
                                       │                                  │
                                  ┌────┴───────────── Redis ─────────────┴────┐
                                  │  pub/sub bus · game directory · presence  │
                                  │  seek pools · clock leases · rate limits  │
                                  └────┬───────────────────────────┬─────────┘
                                       │                           │
                        ┌──────────────┴─────────┐     ┌───────────┴───────────┐
                        │ GAME-ENGINE tier        │     │ MATCHMAKER service     │
                        │ apps/game-engine        │     │ apps/lobby             │
                        │ 1 active game = 1 grain │     │ seek pools → pairing   │
                        │ single-writer · clocks  │     │ (Lua-atomic)           │
                        │ N nodes · hash-placed   │     └───────────┬───────────┘
                        └──────────────┬─────────┘                 │
                                       │ persists finished/snapshots │ creates games
                        ┌──────────────┴───────────── NestJS API (apps/api) ──────────┐
                        │  users · ratings (Glicko-2) · REST · OAuth · Bot/Board API   │
                        └──────────────┬───────────────────────────────────────────────┘
                                       │
                            sharded MongoDB (games, users, rounds)  ·  fishnet fleet (analysis)
```

**Process boundaries (new apps in the v2 monorepo):**
- `apps/ws` — WebSocket gateway. Stateless. Scales by node count. **uWebSockets.js.**
- `apps/game-engine` — the authority. Holds live games in memory. Stateful but recoverable.
- `apps/lobby` — matchmaking/seek pools. Can start co-located with the API, split later.
- `apps/api` — existing NestJS; gains users/ratings/REST/OAuth. **Never** holds game state.

Keeping these as separate processes (not NestJS gateways inside the API) is the core lila lesson:
the socket tier and the authority scale on completely different axes (connections vs active games).

---

## 2. The grain directory — how "single writer" works without Akka

This is the heart of the design. Borrowed from **Microsoft Orleans' virtual-actor placement**.

### 2.1 Placement
- A game grain is *virtual*: it "exists" for every gameId, but is *activated* (loaded into memory on
  some node) only when there's traffic.
- **Directory** = Redis hash/string per game: `game:owner:{gameId} -> {nodeId, leaseExpiry}`, written
  with `SET game:owner:{gameId} {nodeId} NX PX 15000` (atomic single-activation; NX = only if absent).
- **Cold placement:** when a move/event for `G` arrives and no owner is set, the requesting node runs
  the placement function — **consistent hash of gameId over the live node ring** (so placement is
  deterministic and spreads load) — and attempts the `SET ... NX`. Winner owns it; losers read the winner.
- **Sticky:** once placed, a game stays on its owner for its whole life (no rebalancing of *live*
  games — moving a running game is needless risk). New games spread across nodes naturally.

### 2.2 Lease & liveness
- The owner **renews its lease** (`PEXPIRE game:owner:{gameId} 15000`) on every event and via a 5 s
  heartbeat. While alive, it's the sole writer.
- If the owner **dies**, the lease expires (≤15 s). The next event for `G` finds no owner → re-places
  via the ring (which has now lost the dead node) → new owner **rehydrates** state from Redis snapshot
  (§5) and resumes. Players see a ≤15 s "reconnecting" blip, not a lost game.
- **Split-brain guard:** a node only mutates a game whose lease it currently holds; before persisting
  it re-checks ownership (`GET game:owner == self`). If it lost the lease (e.g. GC pause > TTL), it
  drops the write and self-evicts the grain. The Redis lease is the single source of truth for "who owns G".

### 2.3 Per-game serialization (the "mailbox")
Within the owner node, each game has a **promise-chained async queue** keyed by gameId: events for the
same game run strictly one-at-a-time (`tail = tail.then(() => handle(evt))`), different games run
concurrently. This reproduces an actor mailbox without a framework. No shared mutable state across games.

> **Routing without a central router:** the WS gateway, holding a player's socket, computes the owner
> for `G` (directory lookup, cached) and `PUBLISH game:in:{ownerNode}` (one inbox channel per engine
> node). The owner is subscribed to its own inbox. Replies go out on `game:out:{gameId}`, which every
> WS node holding a participant/spectator socket is subscribed to. Two Redis hops, no extra service.

---

## 3. The wire protocol

One **versioned envelope** over WebSocket, JSON for v1 (binary/MessagePack later if profiling demands):

```jsonc
// envelope
{ "v": 1, "t": "<type>", "g": "<gameId>", "s": <seq>, "d": { ... } }
//  v=protocol version  t=type  g=game (optional)  s=client seq  d=payload
```

### 3.1 Client → server
| `t` | payload | meaning |
|---|---|---|
| `hello` | `{token?}` | open: authenticate (session cookie or OAuth bearer), negotiate `v` |
| `sub` / `unsub` | `{g}` | subscribe/unsubscribe to a game's stream (spectate or own game) |
| `move` | `{g, uci, ply, moveId}` | play a move; `ply`=expected ply, `moveId`=client uuid (idempotency) |
| `premove` | `{g, uci}` | queued premove (server applies iff legal when it becomes your turn) |
| `resign` / `abort` / `draw-offer` / `draw-accept` / `draw-decline` / `takeback-offer` / `takeback-accept` | `{g}` | game-flow actions |
| `rematch-offer` / `rematch-accept` | `{g}` | post-game |
| `resync` | `{g, havePly}` | "I reconnected / missed messages — send full state from havePly" |
| `ping` | `{ts}` | client clock + lag probe |

### 3.2 Server → client
| `t` | payload |
|---|---|
| `state` | full snapshot: `{fen, moves[], clock:{w,b,lastTs}, turn, status, players, ply}` (reply to `hello`/`sub`/`resync`) |
| `move` | `{uci, san, ply, clock:{w,b}, byMs}` — one applied move + authoritative clocks |
| `clock` | `{w, b, running, ts}` — periodic clock tick / correction |
| `end` | `{result, reason, ratingDiff?}` — mate/resign/flag/draw/abort + Glicko delta |
| `offer` | `{kind:'draw'|'takeback'|'rematch', by}` |
| `error` | `{code, msg}` — illegal move, not-your-turn, stale-ply, unauthorized |
| `pong` | `{ts, lag}` |
| `presence` | `{g, white:'online'|'gone', black:...}` — opponent connection state |

**Idempotency & ordering:** the authority tracks `ply`. A `move` with `ply != expected` is rejected
(`stale-ply`) and answered with a `state` so the client re-syncs. `moveId` dedups retransmits. Clients
never advance their own clock authoritatively — they render from the last `move`/`clock` server timestamp.

---

## 4. The round grain — game lifecycle & rules

### 4.1 State machine
```
            create (lobby)              both connected
  [created] ─────────────▶ [ready] ───────────────────▶ [playing]
      │ no-show (abort timer)              │
      ▼                                     │ resign / draw-agreed / mate / stalemate /
  [aborted]                                 │ flag(+material) / threefold / 50-move / insufficient
                                            ▼
                                       [finished] ──▶ persist + rate + (rematch?)
```
- **Abort window:** before move 1 (or before both sides have moved once), either player may `abort`
  with no rating effect; also auto-abort if a player never connects within N seconds.
- **Correspondence** is the same machine with multi-day clocks and offline play (no live socket needed;
  notifications via push). Live and correspondence share the grain logic, differ in clock + transport.

### 4.2 Move validation pipeline (in the grain, single-writer)
1. ownership re-check (lease == self) → else reject/evict
2. auth: sender is the player whose turn it is
3. `ply` matches expected; `moveId` not already applied (idempotent)
4. legality via **chessops** (variant-aware) / chess.js — move is legal in current position
5. **clock first**: compute elapsed, debit mover, apply lag comp, check flag (§4.3) *before* accepting
6. apply: push move, flip turn, recompute game-end (mate/stalemate/draw rules), add increment
7. snapshot hot state to Redis (§5); `PUBLISH game:out:{g}` the `move`; arm the opponent's flag timer

### 4.3 Clocks — the part that must be exactly right
- Times stored in **integer milliseconds**. Authority records `lastMoveServerTs` (monotonic clock,
  `process.hrtime`-based, not wall-clock — wall-clock jumps).
- On a move: `elapsed = nowMonotonic - lastMoveServerTs; remaining[mover] -= elapsed; then remaining[mover] += increment` (Fischer). Bronstein/simple delay handled as variants of this debit.
- **Flag (timeout)** detected two ways: (a) reactively when a move arrives with `elapsed > remaining`,
  (b) proactively via an armed timer set to fire at `remaining` ms; on fire the grain declares a flag.
  On flag, result = loss **unless the opponent has no mating material** → draw (insufficient material).
- **Lag compensation:** the gateway measures each client's RTT (`ping`/`pong` moving average). The grain
  refunds up to a cap (~1 s, lila-style) of *network* lag so a laggy connection doesn't lose on time for
  packets in flight. Lag is measured per-player and applied to that player's debit only.
- **Berserk:** at game start, halve the clock and drop increment for the berserking side (tournament
  context); flag rules unchanged.
- `clock` correction ticks broadcast every ~1–3 s while a clock is low, so spectators/players don't
  drift; the move messages carry authoritative clocks regardless.

### 4.4 Premove / takeback / offers
- **Premove:** stored on the grain; when the turn flips to that player, the grain validates the queued
  UCI against the new position and auto-applies (or discards if now illegal). Zero added latency.
- **Takeback:** offer/accept; only in casual games (never rated/tournament). Rewinds ply + clocks to a
  stored prior snapshot.
- **Draw/rematch offers:** held on the grain with a one-offer-outstanding rule; expire on the next move.

---

## 5. Persistence & state

### 5.1 Hot state (Redis) — for crash recovery, ~game lifetime TTL
`game:state:{g}` (hash or packed JSON): `{moves, clock, turn, ply, status, players, lastMoveTs,
offers, drawState}`. Written after every accepted move. This is what a re-placed grain rehydrates from.
Keep it small; it's the recovery log, not the archive.

### 5.2 Cold state (MongoDB) — the archive
On game end (and lazy mid-game checkpoints for correspondence), persist a compact doc:
```jsonc
{
  _id, players: [{userId, color, ratingBefore, ratingAfter}],
  variant, speed, timeControl: {initial, increment},
  moves,            // packed: space-joined UCI, OR 2-bytes/move (lila `compression` idea) at scale
  clocks,           // delta-encoded centisecond array
  result,           // "1-0" | "0-1" | "1/2-1/2"
  status,           // mate|resign|timeout|draw|stalemate|aborted|...
  createdAt, finishedAt, rated, tournamentId?, analysis?
}
```
- **Sharding:** `games` sharded by `hash(_id)`; `users` by `hash(userId)`. Read-replicas feed
  explorer/analysis/TV so the write path is never blocked by reads.
- **Compression matters at scale:** millions of games/day → bit-pack moves + clocks (lila's `compression`
  repo). Start with UCI strings; swap encoder behind a `moves` codec interface when storage bites.

### 5.3 Ratings
Game end → `apps/api` consumes an `end` event (Redis) → runs the existing **Lichess-exact Glicko-2**
(`v2/apps/api/src/glicko`) → updates both `userperfs` + writes a `Round`/game-history row → returns
the delta in the `end` message. Guests don't persist (mirrors the puzzle path).

---

## 6. Matchmaking (apps/lobby)

- **Seek pools** in Redis **sorted sets**, one per `(variant, speed)` bucket, scored by rating:
  `seek:blitz:5+3` → ZADD score=rating member=`{userId,seekId,ratingRange}`.
- A **seek** says "I want blitz 5+3, ±150 rating". The matcher does a `ZRANGEBYSCORE` window around the
  seeker's rating; first compatible opponent wins.
- **Atomic pairing** via a Lua script (or a short-lived lock): pop both seekers, create the game, place
  it in the directory, notify both gateways — all-or-nothing so nobody double-matches.
- **Direct challenges** (challenge-a-friend, Bot API) bypass pools: create game, send a challenge
  notification, start on accept.
- **Pairing fairness:** widen the rating window over wait time; expire stale seeks; honour color
  preference / rated flag / time control exactly.

---

## 7. Failure modes & recovery (explicit)

| Failure | Detection | Recovery |
|---|---|---|
| Game-engine node crash | lease expiry ≤15 s | next event re-places game on a live node; rehydrate from `game:state:{g}`; players auto-`resync` |
| Player disconnect (live game) | gateway `close` → `presence:gone` | game keeps running (clock ticks!); grace timer; on expiry → opponent may claim win/draw; reconnect restores via `resync` |
| Gateway node crash | LB health check | clients reconnect to another gateway, `hello`+`resync`; game state untouched (authority is elsewhere) |
| Redis blip | publish/lease errors | grains keep in-memory truth; on reconnect re-assert lease + re-snapshot; bus messages are at-least-once → idempotency handles dups |
| Stale/dup move | `ply`/`moveId` mismatch | reject with `error`, send fresh `state` |
| Clock skew on a node | monotonic clock only; lease cross-check | never trust wall-clock for elapsed |
| Abandoned game (both gone) | no events + grace | auto-abort (pre-move-1) or adjudicate by clock/flag |

**Single-region first:** authority + Redis + Mongo in one region (IN or EU). Gateways go regional
**later** (sockets terminate near the user; authority stays central). Lag comp already makes central
authority fair across regions; add regional authority only if cross-region RTT measurably hurts.

---

## 8. Capacity & scaling math (sanity, not promises)

- **Gateway:** uWebSockets.js sustains 100k+ idle conns/node; budget ~20–30k *active* conns/node with
  app logic + relay. Scale linearly by adding gateways behind an L4 LB.
- **Game-engine:** a grain is a few KB + one timer; CPU is the bound, driven by move rate × legality
  checks. A bullet scramble peaks at a few moves/sec/game. One node holds **tens of thousands** of
  concurrent games; scale by node count, games spread by the placement hash.
- **Redis:** pub/sub fan-out + directory + pools. Watch channel cardinality (one `game:out:{g}` per live
  game); shard with Redis Cluster by gameId hash-tag when one instance saturates.
- **Mongo:** writes are end-of-game + checkpoints (low rate vs reads); reads scale on replicas.
- **The real ceiling** is Redis pub/sub fan-out and gateway count, both horizontal. Nothing here has a
  single vertical bottleneck except the per-game single writer — which is the point (and is per-game, so
  it scales with game count).

---

## 9. Cross-cutting

- **Auth on the socket:** `hello` carries the session cookie (same `connect-mongo`/`express-session`
  origin) or an OAuth bearer (Bot/Board API). No game mutation from an unauthenticated socket. Spectating
  may be anonymous.
- **Rate limiting & abuse:** per-connection message budget (Redis token bucket); reject move floods;
  `lila-ip2proxy`-style proxy flagging for multi-account abuse.
- **Anti-cheat capture (now, scoring later):** every move records `{timeUsedMs, evalCpLoss?(post-hoc),
  clientLag}` → fed to the offline irwin/kaladin-style batch + mod queue (see parent §8). Capture the
  data from day one even before the ML exists; you can't backfill move-times.
- **Observability:** SLIs = **move round-trip latency** (client→authority→client), **clock drift**
  (server vs client render), grain count/node, lease churn, seek→match time, reconnect rate. Prometheus
  + Grafana; Sentry/GlitchTip already wired.
- **Testing:** (a) deterministic unit tests on the grain (clock math, flag+material, threefold, premove);
  (b) a **scripted bot fleet** (lichess-bot-style) for load + chaos (kill an engine node mid-game, assert
  rehydration); (c) replay real PGNs through the grain to fuzz rules.

---

## 10. Tech choices (with rationale)

| Decision | Choice | Why |
|---|---|---|
| Socket lib | **uWebSockets.js** (standalone `apps/ws`) | Highest conn throughput in Node; standalone keeps the socket tier independent of the API. `ws` is the fallback if uWS's C++ binding ops burden is too high. **Not** a NestJS gateway — that couples sockets to the stateful-free API. |
| Authority model | **Grain directory (Orleans-style) + per-game promise chain** | Closest Node-native equivalent to lila's actors; single-activation via Redis `SET NX` + lease; sticky placement; survivable. Beats raw consistent-hash (which moves live games on membership change). |
| Rules engine | **chessops** (+ chess.js where already used) | Variant-aware, matches Lichess, FE+BE shareable. WASM move-gen only if profiling demands. |
| Bus | **Redis pub/sub** (+ Streams for durable queues like analysis) | Already in the stack; lila's exact coordination model. |
| Clocks | **Monotonic server time, integer ms, lag-comp** | Wall-clock jumps; ms precision; lila-proven lag refund. |
| Storage | **Mongo (sharded) + compact codec** | Already the data model; compression behind an interface. |

---

## 11. Build phases (walking-skeleton first)

> Each milestone is independently demoable. **M0–M3 = roadmap Phase 1 ("two humans play one rated
> live game").** Don't build tournaments/variants/analysis until M3 is rock-solid.

- **M0 — Walking skeleton (no chess).** ✅ BUILT 2026-05-30 (13/13). `apps/ws` (uWS) + `apps/game-engine` + Redis bus. A "game" is an
  echo: client sends `move`, authority echoes with a server seq to both sockets. Proves transport,
  directory placement, `sub`/`out` routing, `resync`. *Exit: two browsers exchange ordered messages
  through the authority; killing the engine node rehydrates the "game".*
- **M1 — A legal game, no clocks.** ✅ BUILT 2026-05-30 (14/14) — used chess.js (already in-repo; gives threefold/insufficient/50-move free), rules encapsulated so chessops/variants stay a local swap. Grain holds a chess position; validates legality/turn/ply;
  detects mate/stalemate/draws; persists a finished game to Mongo. *Exit: two humans play a full untimed
  game to checkmate; it shows in game history.*
- **M2 — Clocks.** Server-truth clocks, increment, flag (+insufficient-material), lag comp, periodic
  `clock` ticks, proactive flag timer. *Exit: a 1+0 bullet game flags correctly; lag doesn't steal time.*
- **M3 — Game flow + rating + reconnect.** ✅ BUILT 2026-05-30 (11/11) — resign + draw-offer/accept/
  decline + rematch (spawns a colour-swapped game); **Glicko-2 rating on rated game end** (shared
  `packages/glicko`, persisted to `live_perfs` by speed bucket); client disconnect→reconnect resumes
  the seat via `resync`. *Deferred: casual takeback, abort, pause-on-unavailable (clock keeps running
  during a node-outage for now). Verified: rated mate moves both ratings; draw-accept ends 1/2;
  reconnect resumes mid-game; rematch swaps colours.*
- **M4 — Lobby.** ✅ BUILT 2026-05-30 (9/9) — `apps/lobby` process: Redis sorted-set seek pools per
  exact time-control+rated, **Lua-atomic match pop**, widening sweep (window grows with wait), and
  challenge-by-link (create→accept). On a match the lobby pre-seats the game via a new engine `setup`
  event then notifies both players (`matched`); clients just `sub`+play (no seating race). *(Verified:
  two strangers seek 5+3 → matched opposite colours → play; challenge create→accept → casual game.)*
- **M5 — Hardening.** Premove polish, abuse/rate limits, anti-cheat capture, metrics dashboards, bot-fleet
  load + chaos tests, single→multi gateway. *Exit: a load test of N concurrent games with a node-kill
  passes with zero lost games.*
- **Then** → parent-plan Phase 4 (analysis/fishnet → Arena/Swiss → variants → studies/broadcasts →
  anti-cheat ML → social → mobile).

A lower-stakes warm-up that exercises M0–M2 without rated pressure: **play-vs-Stockfish** and
**challenge-a-friend casual** — same transport + grain, one side is an engine or there's no rating.

---

## 12. Open decisions (realtime-specific; complement parent §14 + §A5)

1. **uWebSockets.js vs `ws`** for `apps/ws` — throughput vs ops simplicity / binding maintenance.
2. **Grain directory home** — plain Redis `SET NX`+lease (rolled here) vs Redis Cluster hash-slots vs an
   off-the-shelf virtual-actor lib. Rolling-our-own is recommended; revisit if it gets hairy.
3. **JSON vs binary protocol** at launch — JSON for dev speed; commit to a MessagePack/binary path if
   bandwidth/CPU profiling demands (the envelope is versioned to allow it).
4. **Correspondence in v1?** — same grain, different clock+transport; cheap to include or defer.
5. **Single-region authority vs regional** from the start — recommend single-region + regional gateways
   later; lag comp buys time.
6. **Spectators on `game:out:{g}` directly vs a fan-out relay** — direct pub/sub is simplest; a relay/CDN
   tier (lila's `lila-http`) only when a single game has thousands of viewers (broadcasts).
7. **Where lobby lives** — inside `apps/api` initially vs its own process from day one.

---

## 13. What we reuse vs build new

**Reuse:** chessground (board), Glicko-2 (`v2/apps/api/src/glicko`), Redis+BullMQ, NestJS+Mongo, the
engine-battle WS as a throwaway reference for uWS wiring, Stockfish protocol (for vs-engine + analysis),
Sentry/GlitchTip. **Build new:** `apps/ws`, `apps/game-engine` (grains+clocks+rules), `apps/lobby`,
the wire protocol, the Mongo game schema + move/clock codec, the directory/lease machinery, anti-cheat
capture, the bot-fleet test harness.
