# Session 2026-05-30 — M0 realtime walking skeleton BUILT & verified

**What:** Implemented milestone **M0** of the realtime online-play plan in the v2 monorepo and
verified all 6 exit criteria (13/13 assertions) against a live 2-engine + 1-gateway cluster on
local Redis. No chess yet — M0 proves the *architecture* on an append-only echo log.

**Why:** Owner said "build". M0 is the buildable foundation that doesn't need the §10 infra decision
(local Redis only). Proves transport + grain directory (single-writer) + routing + recovery before
chess goes in at M1.

**Built (per ADR-0008 + the M0 spec):**
- `packages/protocol` — `@chessguru/protocol`: versioned envelope + client/server message unions,
  JSON codec (D3 seam), Redis channel/key names + timings, consistent-hash ring (FNV-1a, 64 vnodes).
- `apps/game-engine` — the authority: ioredis conns, node-id, Cluster (heartbeat ZSET + ring
  placement), Directory (Orleans-style `SET NX`+lease, renew, compare-and-del release, ownership
  recheck), Mailbox (per-game promise chain), EchoGrain (append log w/ seq idempotency), Registry,
  Redis snapshot (hot state TTL=4×lease), main (subscribe `game:in:{node}`, heartbeat, /healthz).
- `apps/ws` — the gateway: `SocketServer` interface + `UwsSocketServer` (uWebSockets.js) behind the
  D1 swap seam, Router (owner resolve via cache→lease→ring, route to `game:in`, fan out `game:out`,
  targeted `ws:reply`), main on `:18080`.
- `scripts/m0-verify.mjs` (ws+ioredis driver, SIGKILLs the owner via `engine:pid`) + `scripts/run-m0.sh`.

**Stack notes:** runs under global `tsx` (no build step); `corepack pnpm install` added uWebSockets.js
(prebuilt linux-x64 binary, Node-20 ABI) + ws; ioredis reused from the existing store. All three
packages `typecheck` clean.

**Verified:** ordered echo through authority + monotonic seq; single-writer (`SET NX` loser proven);
stale-seq reject+recover+no-broadcast; **SIGKILL owner → re-place on survivor → full-log rehydrate,
seq uninterrupted**; reconnect+resync exact tail; gateway /healthz. `13 passed, 0 failed`.

**Gotchas hit & fixed:** (1) port 8080 already taken on this box → gateway moved to 18080; (2) `tsx`
spawns a child node proc that survives a parent kill → harness cleanup now also clears by port;
(3) discriminated-union narrowing in the engine — reordered to check `append` positively;
(4) dropped `Buffer` from the codec so the leaf protocol package needs no `@types/node`.

**Files:** `v2/packages/protocol/**`, `v2/apps/game-engine/**`, `v2/apps/ws/**`,
`v2/scripts/{m0-verify.mjs,run-m0.sh}`, `v2/package.json` (+ws devDep), `v2/pnpm-lock.yaml`;
docs: `plans/online-play-m0-walking-skeleton.md` (status→BUILT + impl section), `INDEX.md`.

**Verification:** `cd v2 && bash scripts/run-m0.sh` → 13/13. No production services touched (new
apps are not in pm2; ran ad-hoc then torn down).

**Open items:** owner sign-off on ADR-0008 + the §10 infra/budget call before anything runs as a
deployed service. **Next build step: M1** — replace EchoGrain with a chess RoundGrain (chessops:
position, legality, game-end) + Mongo persistence, machinery unchanged.
