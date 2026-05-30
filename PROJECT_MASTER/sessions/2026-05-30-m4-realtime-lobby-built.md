# Session 2026-05-30 — M4 realtime: lobby / seek / challenge BUILT

**What:** Milestone **M4** of the realtime online-play plan — a new `apps/lobby` process that matches
strangers via seek pools and supports challenge-by-link. 9/9 acceptance. With M0–M3 this completes
"two strangers get paired and play a rated, timed game".

**Why:** Owner said "build" → continue from M3.

**Built — `apps/lobby` (new process, ADR-0008 D7):**
- **Seek pools** in Redis sorted sets keyed by exact time-control + rated (`seek:pool:{tc}:{0|1}`),
  scored by the seeker's rating (read from `live_perfs`, default 1500). One live seek per user.
- **Lua-atomic match pop** — a script ZRANGEBYSCOREs a rating window and ZREMs the first compatible
  seek in one atomic step, so concurrent/duplicate pairing can't double-book a seeker.
- **Widening sweep** (every 3s) — re-tries waiting seeks with a window that grows by wait time
  (`200 + waited·40`), so a lone seeker eventually matches a rating-distant opponent.
- **Challenge-by-link** — `challenge` stores a pending challenge (Redis, 5-min TTL) and returns an id;
  `challenge-accept {id}` pairs challenger (white) + acceptor (black). (Presence-push to a named online
  friend deferred — link/accept covers the Lichess challenge-link flow.)
- **Pairing → game**: the lobby computes the owner via the consistent-hash ring and sends the engine a
  new **`setup`** event (configure + seat both + start clock); then sends each player a `matched`
  message. Clients just `sub` the game and play — **no seating race** (seats are set by `setup`, not by
  join order).

**Wiring:** protocol gains `seek/unseek/challenge/challenge-accept` (client), `seek-ack/matched/
challenge-created` (server), `InSetup` (engine), `LobbyInbound` union, `ch.lobbyIn`. `speedOf` moved
into `@chessguru/protocol` (perfs.ts now re-exports it — deduped). Gateway forwards lobby messages to
`lobby:in`; engine handles `setup`.

**Verified (`bash v2/scripts/run-m4.sh`, 9/9):** first seeker gets `seek-ack`; second seeker → both
`matched` into the same game with opposite colours (waiter = white) + opponent/clock; the lobby-created
game is live (white's `e2e4` applies, seated by `setup`); challenge `create` returns an id; `accept`
pairs both (challenger white, casual rated=false).

**Bug found & fixed:** the lobby's subscriber ioredis connection threw "Connection in subscriber mode"
on its readyCheck INFO and dropped the `lobby:in` subscription → seeks never processed. Fixed with
`enableReadyCheck:false` on the sub connection (+ `error` handlers on both). Engine/gateway were
unaffected (no reconnect), but the same hardening is worth porting there later.

**Files:** new `v2/apps/lobby/**`; `v2/packages/protocol/src/{envelope,channels}.ts`;
`v2/apps/game-engine/src/{main,perfs}.ts`; `v2/apps/ws/src/router.ts`; `v2/scripts/{m4-verify.mjs,
run-m4.sh}`; `v2/pnpm-lock.yaml`; docs: `plans/online-play-realtime-architecture.md` (§11 M4 BUILT),
`INDEX.md`. All five packages typecheck clean. No persisted test docs (M4 games don't finish); ports
clean; new apps still out of pm2.

**Deferred (noted):** presence-push challenge to a named online friend; `KEYS seek:pool:*` in the sweep
(fine at dev scale, swap for a tracked set at scale); multi-instance lobby concurrency hardening.

**Open items:** owner sign-off on ADR-0008 + §10 infra/budget before deploy. **Phase-1 lobby loop is
complete** (seek → match → play rated/timed → finish/rate). **Next: M5 — hardening** (premove polish,
rate limits, anti-cheat move-time capture, Prometheus/Grafana metrics, bot-fleet load + node-kill
chaos, multi-gateway).
