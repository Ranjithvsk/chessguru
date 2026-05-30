# ADR-0008: Realtime online-play stack & the grain-directory authority

**Status:** Proposed · **Date:** 2026-05-30 · **Owner sign-off:** pending (infra/budget, parent §10)

Answers the 7 realtime-specific open decisions in
[plans/online-play-realtime-architecture.md](../plans/online-play-realtime-architecture.md) §12.
These are *recommendations*; this ADR flips to **Accepted** once the owner confirms (and the infra
decision unblocks M0). Captured now so M0 can be specced against concrete choices, not a fork.

## Context
We're adding human-vs-human realtime play on Node (no Akka), inside the v2 pnpm monorepo
(React web + NestJS api + Redis + Mongo). The deep plan lays out the architecture; this ADR commits
the technology and pattern choices it left open, with rationale, so they don't get re-litigated mid-build.

## Decisions

### D1 — Socket library: **uWebSockets.js** for `apps/ws`, behind a thin adapter
Standalone process, not a NestJS gateway (that couples sockets to the stateless API). uWS gives the
best connection throughput in Node. **Risk mitigation:** wrap it behind a 1-file `SocketServer`
interface so we can swap to `ws` if the C++ binding / ops burden bites — M0 ships the adapter so the
choice is reversible. *(Resolves §12.1)*

### D2 — Authority model: **roll our own grain directory** (Orleans-style)
Redis `SET game:owner:{id} {node} NX PX 15000` for single-activation + lease; consistent-hash cold
placement; sticky; per-game promise-chain mailbox. **Not** Redis-Cluster hash-slots (couples placement
to sharding topology) and **not** an off-the-shelf actor lib (none give distributed single-activation
in Node without dragging in a runtime). Revisit only if the directory logic grows hairy. *(Resolves §12.2)*

### D3 — Wire protocol: **JSON at launch, versioned envelope, binary path reserved**
`{v,t,g,s,d}` envelope with `v=1`. JSON for dev speed and debuggability. The `v` field + a codec seam
let us add MessagePack/binary later **without** a protocol break, *iff* bandwidth/CPU profiling demands
it. Don't pre-optimize. *(Resolves §12.3)*

### D4 — Correspondence: **deferred past M5**, but the grain stays clock-pluggable
Same grain, different clock + transport (no live socket; push notifications). Including it in v1 adds
offline-resume + push surface we don't need to prove the realtime core. Build the clock behind a
strategy interface so correspondence is a later clock impl, not a rewrite. *(Resolves §12.4)*

### D5 — Geography: **single-region authority + Redis + Mongo first; regional gateways later**
Authority and data central (IN or EU — tie to the parent §10 infra/budget call). Per-player lag
compensation makes central authority fair across regions for launch traffic. Add regional `apps/ws`
PoPs only when cross-region RTT measurably hurts; revisit regional authority only after that. *(Resolves §12.5)*

### D6 — Spectator fan-out: **direct Redis `game:out:{g}` pub/sub**, relay tier only when forced
Simplest correct thing: WS nodes subscribe per-game and relay to their sockets. A `lila-http`-style
read/relay tier is introduced **only** for the thousands-of-viewers case (broadcasts), not for normal
games. *(Resolves §12.6)*

### D7 — Lobby placement: **its own `apps/lobby` process from day one**
Matchmaking has a different load profile and failure domain than both the stateless API and the
stateful authority; starting it separate avoids a later extraction. It's small, so the cost is low.
*(Resolves §12.7)*

## Consequences
- M0–M5 can be specced and built against fixed interfaces; the reversible seams (D1 adapter, D3 codec,
  D4 clock strategy) are the only places we hedge.
- New monorepo packages: `apps/ws`, `apps/game-engine`, `apps/lobby`, `packages/protocol` (shared
  envelope + message types), `packages/chess-core` (rules/clock, later). `apps/api` gains users/ratings/OAuth.
- **Still gated on parent §10 infra/budget** — none of this runs on the shared 7.6 GB OVH box.
- If load testing (M5) contradicts D1/D3/D5, the seams make the reversal local, not a rewrite.

## Related
[plans/online-play-realtime-architecture.md](../plans/online-play-realtime-architecture.md) ·
[plans/online-play-international.md](../plans/online-play-international.md) · parent §10 (infra/budget blocker).
