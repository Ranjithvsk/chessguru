# Session 2026-05-30 — M5 realtime: hardening BUILT (Phase 1 complete)

**What:** Milestone **M5** (hardening) — the last of realtime Phase 1. Added premove, per-connection
rate limiting, anti-cheat move-time capture, Prometheus `/metrics`, and a bot-fleet load+chaos test.
7/7 acceptance, including the headline: **8 games across two gateways survive a mid-flight engine
SIGKILL and all finish correctly (zero lost games)**. With M0–M4 this completes Phase 1.

**Why:** Owner said "go" → build M5.

**Built:**
- **Premove** — client `premove {uci}`; grain stores one per side (`premoves`); after a move flips the
  turn, the engine `consumePremoves` loop auto-applies the waiting side's premove (and chains, bounded),
  discarding it if illegal. Zero added latency.
- **Rate limiting** — gateway per-connection token bucket (40 burst, 40/s refill); floods get an
  `error: rate-limited` and are dropped, the socket stays up.
- **Anti-cheat capture** — grain records per-move think time (`moveTimes[]`, ms), persisted alongside
  `moves` in `live_games` for offline analysis later (can't backfill, so captured from day one).
- **Prometheus `/metrics`** — engine exposes `cg_games_active / cg_moves_total /
  cg_games_finished_total / cg_flags_total`; gateway exposes `cg_ws_connections /
  cg_ws_messages_total / cg_ws_rate_limited_total`. (Grafana wiring is deploy-time.)
- **Multi-gateway + chaos** — `run-m5.sh` boots 2 engines + lobby + **two gateways** (:18080/:18081).
  The load test puts white on gw1 and black on gw2 (cross-gateway play via `game:out`), runs 8 games,
  SIGKILLs engine e1 mid-game, waits out the lease, and every game re-places on the survivor,
  rehydrates, and plays to checkmate.

**Verified (`bash v2/scripts/run-m5.sh`, 7/7):** premove auto-applies on the player's turn; an 80-msg
ping flood is rate-limited; think-times persisted (length == moves, all ≥0); engine + gateway
`/metrics` expose counters; cross-gateway play works; **all 8 games survive the node-kill and finish 0-1**.

**Files:** `v2/packages/protocol/src/envelope.ts` (premove); `v2/apps/game-engine/src/{grain,snapshot,
mongo,main}.ts`; `v2/apps/ws/src/{socket-server,router}.ts`; `v2/scripts/{m5-verify.mjs,run-m5.sh}`;
docs: `plans/online-play-realtime-architecture.md` (§11 M5 BUILT), `INDEX.md`. All packages typecheck
clean; test `live_games`/`live_perfs` deleted; new apps still out of pm2.

**Deferred (deploy-time / later, noted):** Grafana dashboards, multi-instance lobby concurrency,
presence-push challenges, casual takeback/abort, pause-on-unavailable, binary protocol.

**Status: realtime Phase 1 (M0–M5) COMPLETE & verified.** The stack does the whole loop —
seek/challenge → Lua-atomic match → pre-seated timed game → legal play with premove → flow
(draw/resign/rematch) → rated finish → persisted — single-writer, crash-survivable, across multiple
gateways, with rate limits + metrics + anti-cheat capture. **Still gated for deploy on owner sign-off of
ADR-0008 + the §10 infra/budget decision (cannot run on the shared OVH box).** Natural next steps when
unblocked: Phase 4 (fishnet analysis → Arena/Swiss tournaments → variants → studies/broadcasts →
anti-cheat ML → social → mobile), or wire the v2 web client to play on this engine.
