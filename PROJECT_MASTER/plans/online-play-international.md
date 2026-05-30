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


---

# Appendix A — The complete Lichess map ("100% of the idea")

_Added 2026-05-30. Goal of this appendix: enumerate **everything** Lichess is — every open-source
component and every user-facing feature — so the roadmap above is measured against the full target,
not a guess. Source: lichess.org/source + the `lichess-org` GitHub org (read 2026-05-30). For each
item: **what it is**, and **our reuse/build stance**._

## A1. The full component ecosystem (~40 repos)

Lichess is **not a monolith** — it's `lila` (the core) plus a constellation of independent services
and libraries, each scaled and deployed on its own. The single most important architectural lesson is
this decomposition. Mapped to our Node/Nest world:

### Core site
| Lichess | Tech | Job | ChessGuru stance |
|---|---|---|---|
| **lila** | Scala/Play + Akka actors | The site: games, tournaments, users, everything stateful | = our NestJS API + game-engine tier (split, since we have no Akka) |
| **scalachess** | Scala | Rules, all variants, FEN/PGN, clocks, insufficient-material, perft | **chess.js** now; evaluate **chessops** (TS) for variants; WASM move-gen later |
| **chessops** | TypeScript | Variant rules / FEN / position ops on the FE | Adopt for v2 web — superset of chess.js, variant-aware |
| **compression** | Java | Move + clock **bit-compression** for storage | **Copy the idea**: store games as compact UCI + clock arrays (already in §5) |
| **chessground** | TypeScript | Board UI | **Already used** ✅ |
| **pgn-viewer** | TypeScript | Embeddable PGN/game viewer | Build/adopt for studies, shares, blog |
| **Stockfish (wasm/js)** | C++→WASM | In-browser engine for local analysis | Ship client-side analysis with stockfish.wasm |
| **leroyjenkins** | Rust | fail2ban-style **DDoS mitigation** (bans abusive IPs at edge) | Cloudflare covers most; revisit at scale |

### Realtime + HTTP edge
| Lichess | Tech | Job | ChessGuru stance |
|---|---|---|---|
| **lila-ws** | Scala | Dedicated **WebSocket server**; stateless pipe, talks to lila over Redis | = our **WS tier** (uWebSockets.js) — §5 |
| **lila-http** | Rust | Offloads heavy **read-only HTTP** (e.g. tournament standings) from lila | Cache/CDN + a read service for hot endpoints |
| **lila-push** | Rust | **Web Push** (move notifications, correspondence, challenges) | Add a push service (web push + mobile FCM/APNs) |
| **lila-gif** | Rust | Renders **GIFs** of positions/games; frame-by-frame stream | Nice-to-have; share images / social |
| **lila-ip2proxy** | Rust | Flags **proxy/VPN IPs** (abuse/multi-account) | Hook into anti-cheat + signup abuse |

### Analysis / engine
| Lichess | Tech | Job | ChessGuru stance |
|---|---|---|---|
| **fishnet** | Rust + Stockfish/Fairy-SF | The **distributed analysis client** volunteers run | Reuse our puzzle-factory Stockfish protocol as the worker |
| **lila-fishnet** | Scala | Server side: **queue + dispatch** of analysis jobs to fishnet | = **BullMQ queue** + dispatcher (we already have BullMQ) |
| **lila-engine** | Rust | **External-engine broker** — connect your own engine to the analysis board | Phase-later; OAuth-scoped engine relay |
| **external-engine** | Python | Reference provider that pairs a local engine to the broker | Doc/sample once broker exists |
| **lila-openingexplorer** | Rust + RocksDB | Opening explorer over **trillions** of positions, all variants | **Built our own slice (2026-05-30)** ✅ — scale path = RocksDB-style KV |
| **lila-tablebase** | Rust | **Syzygy 7-piece** endgame tablebases | Host tablebase service; large static data |

### Competitive infra
| Lichess | Tech | Job | ChessGuru stance |
|---|---|---|---|
| **bbpPairings** | C++ | **Swiss** tournament pairing engine (Burstein/Dutch) | Wrap bbpPairings binary; Arena pairing we build |
| **lila-search** | Scala + **Elasticsearch** | Search: games, users, teams, forum, studies | Add Elasticsearch/OpenSearch service |

### Anti-cheat
| Lichess | Tech | Job | ChessGuru stance |
|---|---|---|---|
| **irwin** | Python ML | Neural-net **cheat detector** (per-game/per-move analysis) | Build the data pipeline first; ML later (§8) |
| **kaladin** | Python ML | Complementary ML model (boost/sandbag, statistical) | Same |

### Data / dev / docs
| Lichess | Tech | Job | ChessGuru stance |
|---|---|---|---|
| **database** | — | Public **monthly game/puzzle dumps** (PGN) | Could publish dumps later; ingest format now |
| **lila-db-seed** | Python | Seed a dev Mongo with sample data | **Build the equivalent** — repeatable dev seeding |
| **lila-docker** | Rust/Compose | One-command **local dev** for the whole stack | Mirror with docker-compose for our multi-service v2 |
| **chess-openings** | Python | Canonical **ECO opening-name** dataset | **Already ingested** into our explorer ✅ |
| **api / api-ui / api-demo** | TS | Public **HTTP API** docs + OAuth/gameplay demos | Ship OpenAPI + a Bot/Board API (§11) |
| **berserk / lichess-bot** | Python | Official Python **API client** + **bot bridge** | Provide a Bot API + reference bot |
| **picfit** | Go | **Image resizing** server (avatars, uploads) | Use a CDN image resizer / picfit |
| **playframework-lila** | Scala | Their Play fork | N/A (we're on Nest) |
| **scalalib / scalachessjs** | Scala/JS | Shared utils / JS chess port | N/A; our `packages/types` is the shared layer |

### Mobile (full native stack)
| Lichess | Tech | Job | ChessGuru stance |
|---|---|---|---|
| **mobile** | **Flutter/Dart** | The official app | Plan target (§11); Flutter chosen by Lichess |
| **flutter-chessground** | Dart | Board widget for Flutter | Reuse if we go Flutter |
| **dartchess** | Dart | Chess rules for native | Reuse if we go Flutter |
| **dart-multistockfish** | Dart/C++ | On-device Stockfish bindings | On-device analysis on mobile |
| **lichobile** (legacy) | Ionic/Capacitor | Old app — informs what *not* to repeat | Reference only |

## A2. The complete feature catalog

Everything a logged-in Lichess user can do, grouped. `[done]` = exists in ChessGuru, `[plan]` = in the
roadmap above, `[gap]` = not yet mapped anywhere — **candidate additions**.

### Play
- Live games: Bullet/Blitz/Rapid/Classical, custom clocks, **increment + Bronstein delay** `[plan]`
- **Berserk** (halve your clock for a tournament point) `[plan]`
- **Correspondence** + conditional premoves, vacation mode `[plan]`
- **Premove**, takeback (casual), draw offer / resign / abort / claim-on-disconnect `[plan]`
- **Rematch**, rematch-on-the-same-color `[plan]`
- **8 variants**: Chess960, Crazyhouse, Atomic, Antichess, King of the Hill, Three-check, Horde, Racing Kings `[plan]`
- Play **vs Stockfish** (levels 1–8) and **vs friend** by challenge link `[gap→easy]`
- **Bot/Board API** play (lichess-bot, OAuth) `[plan]`
- Anonymous/casual play without account `[gap]`

### Training
- **Puzzles** (themes, rating, dashboard) `[done]`
- **Blindfold** mode `[done]`
- **Puzzle Storm** (3-min combo run), **Puzzle Racer** (5-player race), **Puzzle Streak** `[gap]` ← high-value, leverages our 5.9M puzzles
- **Coordinates** trainer, **Board Editor** (`[done]`), **Opening explorer** (`[done]`)
- **Practice** (guided endgame/tactics drills), **Learn** (interactive chess basics for beginners) `[gap]`

### Analysis
- Local **stockfish.wasm** eval + **cloud eval** (fishnet) `[plan]`
- **Opening explorer** + masters DB + your-own-games explorer `[done-slice]`
- **Endgame tablebase** probe `[plan]`
- **Studies** — multi-chapter, collaborative, embeddable, PGN import/export `[gap]` ← major feature
- **Broadcasts** — relay live tournaments with multi-board + round PGN ingest `[gap]`
- Computer analysis of finished games (ACPL, blunder/mistake/inaccuracy, **annotated**) `[plan]`

### Competitive
- **Arena** tournaments (rolling, berserk, streaks) `[plan]`
- **Swiss** tournaments (bbpPairings) `[plan]`
- **Simuls** (one vs many) `[gap]`
- **Leaderboards**, rating distributions, **Insights** (personal stats engine) `[gap]`
- **Team battles** (teams compete inside an arena) `[gap]`

### Social / platform
- **Teams** (join/create, forum, team battles) `[gap]`
- **Forums**, **blog**, **studies sharing**, **TV** (watch best ongoing games per category) `[gap]`
- **Following / blocking**, **challenges inbox**, **messaging/PMs** `[gap]`
- **Profiles** with rating history graphs, game history, **streaks/trophies** `[partial]`
- **@mentions**, notifications, web push `[gap]`
- **Coach / streamer** directories `[gap]`

### Account / trust / platform-quality
- **OAuth2** provider + personal API tokens + scopes `[plan]`
- **2FA / TOTP**, account closure, **GDPR export/erase** `[gap]`
- **i18n** — ~150 languages (crowd-sourced via Crowdin) `[gap]`
- **Mod tools** — report queue, the **anti-cheat mod console**, shadowban, IP/print analysis `[plan]`
- **Accessibility** — full keyboard/screen-reader board, NVDA support `[gap]`
- **Zen mode**, board themes, piece sets, sound sets, **PGN/FEN everywhere** `[partial]`

## A3. Architectural patterns worth copying verbatim

Beyond §5, these are the specific lila design choices that make international scale work:

1. **One game = one actor, single-writer.** No distributed locks on game state — the owning node is the
   only writer. We emulate with **consistent-hash(gameId) → owning game-engine node** (§5).
2. **Everything coordinates over Redis pub/sub**, not direct service-to-service calls. WS↔engine,
   engine↔API, lobby presence, tournament standings fan-out — all channels. Loose coupling = independent scale.
3. **Read-heavy load gets its own service** (`lila-http`): tournament standings, TV, leaderboards are
   computed once and served from cache, never re-querying the authority per viewer.
4. **Bit-level storage compression** (`compression`): moves and clocks are packed; at millions of
   games/day storage and bandwidth dominate. Store UCI+clock as packed arrays, not documents-per-move.
5. **Analysis is a volunteer/worker fleet behind a queue** — never inline. The site enqueues; fishnet
   nodes pull, compute, post back; results cached. We already have the queue (BullMQ) and the worker
   (puzzle factory) — wire them to game analysis.
6. **Stateless edges, stateful core.** WS nodes, HTTP read nodes, search, explorer, tablebase, image
   resize, GIF, push — all horizontally scalable and individually deployable. Only the game-engine tier
   and Mongo are stateful authorities.
7. **Anti-cheat is offline + batch + mod-in-the-loop**, not realtime blocking. Capture fingerprints
   during play, score asynchronously, surface to a human mod queue.

## A4. What this adds to the roadmap (new candidate phases / pillars)

Folding the gaps above into §12's phasing — concrete adds, roughly in value/leverage order:

- **Quick win, pre-realtime:** **Puzzle Storm / Racer / Streak** — pure FE + our existing puzzle DB +
  a small leaderboard; ships value now without the realtime game engine. **Do this first.**
- **Quick win:** **Play vs Stockfish** and **challenge-a-friend** — reuses the engine + a 2-player
  session; a stepping-stone that exercises the realtime core with lower stakes than rated lobby play.
- **Phase 4+ majors now explicitly in scope:** **Studies**, **Broadcasts**, **Simuls**, **Insights**,
  **Teams + team battles**, **TV**, **search (Elasticsearch)**, **tablebase service**, **web push**.
- **Platform-quality, cross-cutting (not a phase — a standing bar):** i18n (Crowdin), 2FA, GDPR
  export/erase, accessibility (keyboard/screen-reader board), OAuth2 + Bot/Board API, mod tooling.
- **Infra services implied by the above:** `lila-http`-style read tier, push service, image resizer
  (picfit), GIF renderer, search cluster, tablebase host, dev-seed + docker-compose for the whole stack.

## A5. Updated open decisions (additions to §14)

6. **chess.js vs chessops** for the rules layer — chessops is variant-aware and matches Lichess; if we
   want the 8 variants, decide early (it shapes the FE + engine tier).
7. **Studies/Broadcasts data model** — these are large, collaborative, tree-structured PGN documents;
   decide storage + realtime-collab approach before promising them.
8. **i18n from the start vs retrofit** — retrofitting ~150 locales is painful; if international is the
   thesis, bake i18n into the React app's first components.
9. **Mobile: Flutter (Lichess's choice) vs React Native** — Lichess reuses dartchess/flutter-chessground;
   we'd reuse our React/TS instead. Trade-off: code reuse vs ecosystem.
10. **Which features are explicitly OUT of v1** — say it plainly (e.g. no Studies/Broadcasts/Simuls/
    variants until the realtime core + tournaments are proven) so scope doesn't creep into the foundation.
