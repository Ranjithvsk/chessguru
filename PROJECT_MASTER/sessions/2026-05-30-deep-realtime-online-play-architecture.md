# Session 2026-05-30 — deep realtime online-play architecture

**What:** Wrote a dedicated deep-design doc `plans/online-play-realtime-architecture.md` (365 lines)
for human-vs-human realtime play — the "hard part" that §5 of the international plan only summarised.
Linked it from `INDEX.md` and cross-referenced it from the parent plan's §5.

**Why:** Owner asked to "plan deeply with architecture, everything — plan deep for online play." The
parent doc is the platform roadmap; this is the buildable engineering spec for the realtime core.

**Grounding read first:** the only socket today is `engine-battle/engine_runner.js` — a single-node
broadcast (`bc()` → all clients), spectator-only, no per-game routing, no server clocks. Confirms the
transport works but the architecture must be built. v2 monorepo layout (`apps/api` Nest, `apps/web`
React) checked so new apps slot in cleanly.

**The design, in one line each:**
- **Four invariants** drive everything: single-writer per game, server-truth clocks, idempotent/ordered
  moves (ply index), survivability.
- **Topology:** new processes `apps/ws` (uWebSockets.js gateway, stateless), `apps/game-engine`
  (authority, in-memory grains), `apps/lobby` (matchmaking); `apps/api` never holds game state.
- **Single-writer without Akka:** an Orleans-style **grain directory** — Redis `SET NX` + lease for
  single-activation, consistent-hash cold placement, sticky, lease-expiry → rehydrate-on-new-node;
  per-game promise-chain = the actor mailbox. Routing = directory lookup + `game:in/out` Redis channels.
- **Wire protocol:** one versioned envelope; full client→server / server→client message tables;
  ply+moveId idempotency; `resync` for reconnect.
- **Round grain:** lifecycle state machine, 7-step move-validation pipeline, premove/takeback/offers.
- **Clocks:** integer ms, monotonic time, Fischer/Bronstein, flag(+insufficient-material), lag comp,
  berserk, periodic correction ticks.
- **Persistence:** hot state in Redis (recovery), cold compact game docs in sharded Mongo (UCI+clock
  codec, lila `compression` idea); Glicko-2 on end.
- **Matchmaking:** Redis sorted-set seek pools + Lua-atomic pairing + direct challenges.
- **Failure table:** node crash, player/gateway disconnect, Redis blip, stale move, abandoned game.
- **Capacity math, cross-cutting** (auth-on-socket, rate limits, anti-cheat capture, SLIs, test harness),
  **tech-choice rationale table**, and an **M0–M5 walking-skeleton build plan** (echo → legal game →
  clocks → flow+rating+reconnect → lobby → hardening), plus 7 realtime-specific open decisions.

**Files:** `plans/online-play-realtime-architecture.md` (new), `plans/online-play-international.md`
(§5 cross-link), `INDEX.md` (sub-line under the international plan).

**Verification:** docs only; no code touched. Still PROPOSED — parent §10 infra/budget is the blocker
before M0.

**Open items:** owner to pick the realtime open decisions (uWS vs ws, directory home, JSON vs binary,
correspondence-in-v1, single vs regional authority); then M0 walking skeleton.
