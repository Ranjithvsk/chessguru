# Session 2026-05-30 — realtime decisions (ADR-0008) + M0 build spec

**What:** Turned the deep realtime plan into buildable next-layer artifacts:
1. `decisions/ADR-0008-realtime-stack.md` — recommended answers to the 7 realtime open decisions.
2. `plans/online-play-m0-walking-skeleton.md` — the M0 milestone specced down to concrete v2 monorepo
   files + 6 exit criteria.
Both linked in `INDEX.md`.

**Why:** Owner said "go" after I offered (1) decide the open questions and (2) spec M0. Did both. The
infra/budget call (parent §10) is the owner's and stays the blocker; everything here is build-ready spec.

**ADR-0008 decisions (Status: Proposed — flips to Accepted on owner + infra sign-off):**
- D1 uWebSockets.js for `apps/ws`, behind a 1-file adapter (swap-to-`ws` seam).
- D2 roll our own grain directory (Redis SET NX + lease), not Cluster hash-slots, not an actor lib.
- D3 JSON + versioned envelope now; binary path reserved behind a codec seam.
- D4 correspondence deferred past M5; clock kept pluggable so it's a later impl, not a rewrite.
- D5 single-region authority + regional gateways later; lag comp buys fairness.
- D6 direct `game:out:{g}` pub/sub; relay tier only for thousands-of-viewers broadcasts.
- D7 `apps/lobby` its own process from day one.
Reversible seams (D1 adapter, D3 codec, D4 clock) are the only hedges; if M5 load tests contradict a
choice the reversal is local, not a rewrite.

**M0 spec highlights:**
- New packages: `packages/protocol` (envelope + M0 message subset + codec), `apps/ws` (uWS gateway,
  socket adapter, directory cache, bus, router), `apps/game-engine` (node-id, consistent-hash ring,
  directory SET NX+lease, per-game promise-chain mailbox, EchoGrain, registry, Redis snapshot).
- M0 proves transport + directory single-writer + game:in/out routing + sub/resync + crash-rehydration
  on a trivial **echo log** (no chess yet). Dev needs only local Redis + 2 engine nodes; no Mongo.
- 6 exit criteria: ordered echo through the authority, single-writer placement (SET NX loser proven),
  stale-seq rejection+recovery, kill-owner→rehydrate ≤15s, reconnect-to-any-gateway tail replay, health.
- M1 then swaps EchoGrain → chess RoundGrain with directory/mailbox/lease/snapshot **unchanged** — the
  reason M0 exists.

**Files:** `decisions/ADR-0008-realtime-stack.md` (new), `plans/online-play-m0-walking-skeleton.md`
(new), `INDEX.md` (ADR + M0 lines).

**Verification:** docs only; no code. Still PROPOSED/Proposed — parent §10 infra/budget gates M0 build.

**Open items:** owner to (a) confirm/adjust ADR-0008 D1–D7, (b) make the infra/budget call. On both →
build M0. Next spec-able step if asked: M1 (chess RoundGrain) file-level spec.
