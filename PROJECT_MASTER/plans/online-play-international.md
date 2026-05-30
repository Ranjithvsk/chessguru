# Plan: International-scale realtime play & "Lichess-level" platform

**Status:** PROPOSED (2026-05-30) · scope chosen by owner = **true international scale** (design for
Lichess-like load from day one, not a single-box MVP).

> **Authority note:** this is a *design/roadmap* doc. It describes a target that does **not** exist in
> the code yet. ChessGuru today is a trainer (puzzles, blindfold, opening explorer, engine battles) —
> there is **no** human-vs-human realtime play. See the gap analysis below.

## 1. Goal
Take ChessGuru from a single-player trainer to a Lichess-class platform: realtime human play, cloud
analysis, tournaments, studies/broadcasts, variants, anti-cheat, social, search and mobile — on an
architecture that can scale horizontally to millions of games/day.

## 2. Guiding principle (the one rule copied from lila)
**Realtime play and analysis are independent, horizontally-scalable services coordinated over Redis
pub/sub — never endpoints inside the main API.** lila (the monolith) owns game logic; `lila-ws` owns
sockets; `fishnet`/`lila-fishnet` own analysis; `lila-openingexplorer`, `lila-tablebase`,
`lila-search` are separate. We mirror that separation in Node.

## 3. How Lichess is built (reference)
| Component | Tech | Job |
|---|---|---|
| **lila** | Scala + Play + **Akka actors** | Core site; every game/tournament is an actor |
| **lila-ws** | Scala | Dedicated WebSocket server; talks to lila via Redis |
| **scalachess** | Scala lib | Rules, all variants, FEN/PGN, clocks, insufficient material |
| **chessground** | TS | Board UI — **already used by ChessGuru** |
| **fishnet + lila-fishnet** | Rust/Py | Distributed Stockfish (cloud + game analysis) via a queue |
| **lila-openingexplorer** | Rust + RocksDB | Opening explorer — **ChessGuru built its own slice (2026-05-30)** |
| **lila-tablebase** | Rust | Syzygy 7-piece endgame tablebases |
| **lila-search** | Elasticsearch | Game/user/team/forum search |
| **irwin / kaladin** | Python ML | Anti-cheat (neural net + statistical boost/sandbag) |
| Store | **MongoDB** (sharded) + **Redis** | Primary DB + cache/pubsub/coordination |

## 4. Target topology (ChessGuru)
```
                 Cloudflare (CDN + edge, regional POPs)
                            │
   ┌────────────────────────┼────────────────────────┐
   │  static web (React)     │   WS tier (uWebSockets) │  ← dumb socket pipes,
   └────────────────────────┘   stateless · N nodes    │     stateless, scale by node count
                            │   Redis pub/sub bus        │     (lila-ws equivalent)
                  ┌─────────┴──────────┐
                  │  game-engine tier  │  ← AUTHORITY: 1 active game = 1 in-memory
                  │  (round actors)    │     "round actor", pinned by consistent-hash(gameId)
                  └─────────┬──────────┘
        NestJS API ─────────┤  lobby/seek, users, ratings, REST + OAuth + Bot/Board API
                            │
   sharded MongoDB  ·  Redis  ·  fishnet worker fleet  ·  anti-cheat batch  ·  Prometheus/Grafana
```

## 5. The realtime game engine (the hard part — Node, no Akka)
- **WS tier = dumb pipes.** Hold connections only; relay JSON ↔ Redis channels. Stateless → add
  nodes behind an L4 LB. Use **uWebSockets.js** (or `ws`) for throughput.
- **Game-engine tier = single-writer authority.** Each active game is an in-memory round actor
  **pinned to exactly one node via consistent hashing on `gameId`** → two nodes never mutate the same
  game (this is lila's lila-ws-pipe + lila-round-authority split). A routing layer sends all events
  for game `G` to its owning node over Redis.
- **Clocks are server-truth** — computed monotonically server-side, broadcast as deltas; client only
  renders. Handle increment / delay (Bronstein) / Berserk here.
- **Crash recovery** — live state mirrored to Redis; on node loss the game re-hydrates on its new
  hash-owner. Final game persisted to Mongo as compact UCI + clock arrays.
- **Move legality** via chess.js now; later a faster WASM move-gen (scalachess-class) if profiling
  demands it. Variants handled in this layer.

## 6. Data & scaling
- **MongoDB**: shard `games` by hash(`gameId`), `users` by hash(`userId`); read-replicas feed
  explorer / analysis / insights (puzzles are already 5.9M docs). Compact game storage.
- **Redis**: pub/sub bus + per-game channels + lobby/presence pools + rate limiting + clock ticks.
- **Backpressure & idempotency**: every client move carries a ply index; engine rejects stale/dup.

## 7. Analysis — fishnet pattern
BullMQ/Redis queue + a **separate Stockfish worker fleet** (own machines / volunteer nodes), results
cached in Mongo. Reuse the existing puzzle-factory Stockfish protocol. Powers: post-game analysis,
"request a computer analysis", and the puzzle generator.

## 8. Anti-cheat (mandatory once games are rated/public)
Capture per-move centipawn-loss + move-time fingerprints → offline ML (irwin-style) batch jobs + a
**mod queue** + boost/sandbag statistical detection. Cannot ship public rated play without this.

## 9. Latency = international
Players are worldwide → **regional WS/edge clusters** so sockets terminate near the user (IN vs US).
Game authority can stay central while sockets are regional; revisit if cross-region RTT hurts.

## 10. Infra reality (DECISION REQUIRED — flagged for owner)
This **cannot** run on the current shared 7.6 GB OVH VPS (it co-hosts DreamWorld production). It needs:
- a dedicated **orchestrated cluster** (k8s or Nomad),
- **managed sharded MongoDB** (replica set + shards) and **managed Redis**,
- **CDN/edge** (Cloudflare already in front),
- a **Stockfish worker fleet**,
- **metrics** (Sentry/GlitchTip exist; add Prometheus/Grafana).

→ Real cost + ops commitment. **Pick the cloud/budget before phase 1 build starts.**

## 11. Feature pillars (the full target map)
- **Play**: seek/lobby pools by time-control, clocks/Berserk, resign/draw/rematch/abort,
  correspondence, **8 variants** (960, Atomic, Horde, KotH, 3check, Antichess, Crazyhouse, RacingKings)
- **Analysis**: server eval (fishnet), opening explorer (done), tablebases, **Studies**, **Broadcasts**
- **Competitive**: **Arena + Swiss** tournaments, Simuls, leaderboards, rating distributions, **Insights**
- **Anti-cheat**: irwin/kaladin-style + mod tools
- **Training**: Puzzles (done), **Storm / Racer / Streak**, Coordinates, Practice, Learn
- **Platform/social**: teams, forums, messaging, follow/block, TV, **OAuth + Bot/Board API**,
  mobile (Flutter), i18n, GDPR/2FA, account security

## 12. Phased roadmap (architecture-correct, value-incremental)
1. **Realtime core** — WS tier + game-engine tier + Redis bus; two humans play one rated live game,
   clocks authoritative. *(foundation everything hangs off)*
2. **Lobby/seek** pools by time-control → rated result → existing Glicko-2 → games stored.
3. **Game flow** — resign / draw offer / rematch / abort / **reconnection** / correspondence.
4. **Analysis (fishnet)** → **Arena tournaments** → **variants** → **Studies/Broadcasts** →
   **anti-cheat** → social/search → mobile.

## 13. Current ChessGuru assets we reuse
chessground board, Glicko-2 (Lichess-exact), Stockfish puzzle factory, Redis + BullMQ, NestJS + Mongo,
opening explorer (own), Sentry/GlitchTip, the engine-battle WS (clock/move stream — a working proto of
the socket layer, currently spectator-only).

## 14. Open decisions before building
1. **Infra/cloud + budget** (§10) — the blocker.
2. WS lib: **uWebSockets.js** vs `ws` vs NestJS gateway-as-separate-process.
3. Game-engine ownership: custom consistent-hash router vs an off-the-shelf actor framework.
4. Scope of v1 variants (start standard-only?).
5. Keep building inside the v2 monorepo (new `apps/ws`, `apps/game-engine`) vs separate repos.
