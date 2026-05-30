# M0 — Realtime walking skeleton (build spec)

**Status:** ✅ **BUILT & VERIFIED** (2026-05-30) — 13/13 acceptance checks pass against a live
2-engine + 1-gateway cluster on local Redis (`bash v2/scripts/run-m0.sh`). Implements milestone **M0** of
[online-play-realtime-architecture.md](online-play-realtime-architecture.md) §11, under the choices in
[ADR-0008](../decisions/ADR-0008-realtime-stack.md). **Gated on parent §10 infra/budget** — this is the
build-ready spec; don't run it on the shared OVH box.

> **What M0 proves (no chess yet):** transport (uWS), the **grain directory** (single-writer placement +
> lease), `game:in`/`game:out` routing, `sub`/`resync`, and **crash-rehydration**. A "game" is an
> append-only echo log. Exit criteria at the bottom.

## 1. New packages (pnpm workspace — already globs `apps/*`, `packages/*`)

```
v2/
├── packages/
│   └── protocol/                 @chessguru/protocol  — shared envelope + message types + codec seam
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── envelope.ts        Envelope<T>, ClientMsg, ServerMsg unions (M0 subset)
│           ├── codec.ts           encode()/decode() — JSON now (D3 seam for binary later)
│           └── index.ts
├── apps/
│   ├── ws/                        @chessguru/ws  — uWebSockets.js gateway (stateless)
│   │   ├── package.json           dep: uWebSockets.js (github tarball), ioredis, @chessguru/protocol
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── main.ts            boot: uWS app, :8080, /ws upgrade, /healthz
│   │       ├── socket-server.ts   D1 adapter: SocketServer iface wrapping uWS (swap-to-`ws` seam)
│   │       ├── connection.ts      per-socket: auth stub, seq, sub set, send()
│   │       ├── directory.ts       owner lookup (Redis GET + local cache) for routing
│   │       ├── bus.ts             ioredis pub/sub: publish game:in:{node}, sub game:out:{g}
│   │       └── router.ts          on client msg → resolve owner → publish; on game:out → fan to sockets
│   └── game-engine/               @chessguru/game-engine  — the authority (stateful, recoverable)
│       ├── package.json           dep: ioredis, @chessguru/protocol
│       ├── tsconfig.json
│       └── src/
│           ├── main.ts            boot: nodeId, subscribe game:in:{nodeId}, heartbeat, /healthz
│           ├── node-id.ts         stable per-process id (env NODE_ID or hostname:pid)
│           ├── ring.ts            consistent-hash ring over live engine nodes (for cold placement)
│           ├── directory.ts       SET NX + lease renew + ownership re-check + release
│           ├── mailbox.ts         per-game promise-chain (serialize same game, parallel across games)
│           ├── grain.ts           EchoGrain: in-mem log[], applies events, snapshots, rehydrates
│           ├── registry.ts        Map<gameId, Grain>; activate/evict; lease loop
│           └── snapshot.ts        Redis hot-state read/write (game:state:{g})
```

`apps/lobby` and `packages/chess-core` are **not** in M0 (they arrive M1/M4).

## 2. The protocol subset (M0 only)

```ts
// packages/protocol/src/envelope.ts
export interface Envelope<T = unknown> { v: 1; t: string; g?: string; s?: number; d?: T }

// client → server (M0)
export type ClientMsg =
  | Envelope<{ token?: string }>             // t:"hello"
  | Envelope<{}>                             // t:"sub"   (g required)
  | Envelope<{}>                             // t:"unsub" (g required)
  | Envelope<{ text: string; seq: number }>  // t:"append" (g required) — the stand-in for "move"
  | Envelope<{ haveSeq: number }>            // t:"resync" (g required)
  | Envelope<{ ts: number }>;                // t:"ping"

// server → client (M0)
export type ServerMsg =
  | Envelope<{ node: string }>                       // t:"hello-ok"
  | Envelope<{ log: string[]; seq: number }>         // t:"state"   (reply to sub/resync)
  | Envelope<{ text: string; seq: number; by: string }> // t:"appended"
  | Envelope<{ code: string; msg: string }>          // t:"error"   (e.g. stale-seq)
  | Envelope<{ ts: number }>;                        // t:"pong"
```

`codec.ts` is `JSON.stringify`/`parse` today; the seam means binary is a swap, not a protocol change (D3).

## 3. The grain-directory mechanics (the part M0 actually validates)

**Placement (cold).** Gateway gets an `append`/`sub` for `g`, no owner cached → `GET game:owner:{g}`.
If empty, it asks any engine node (or itself if co-located in dev) to place: the engine computes
`owner = ring.pick(g)` and runs `SET game:owner:{g} <ownerNode> NX PX 15000`. Winner activates the
grain; everyone else reads the winner. Gateway caches `g → ownerNode` (short TTL).

**Routing.** Gateway `PUBLISH game:in:{ownerNode}` with the envelope (it includes `g`). The owning
engine node is `SUBSCRIBE game:in:{nodeId}`; it dispatches into the per-game **mailbox** so same-game
events serialize. Grain appends to `log`, bumps `seq`, writes `snapshot.ts → game:state:{g}`, then
`PUBLISH game:out:{g}` an `appended`. Every gateway holding a socket subscribed to `g` relays it.

**Lease & liveness.** Owner renews `PEXPIRE game:owner:{g} 15000` on each event + a 5 s heartbeat over
all its active grains. Before each snapshot it re-checks `GET game:owner:{g} === nodeId`; if not, it
evicts the grain and drops the write (split-brain guard, D2).

**Crash → rehydrate.** Kill the owning engine node. Lease expires ≤15 s. Next `append`/`sub` for `g`
finds no owner → re-places on a surviving node → `snapshot.ts` reads `game:state:{g}` → grain resumes
with the full `log`/`seq`. Clients that were mid-session send `resync{haveSeq}` and get the tail.

**Idempotency/order.** `append` carries `seq`. Grain expects `seq === log.length`; mismatch → `error`
`stale-seq` + a fresh `state`. (This is the M0 stand-in for the move `ply`/`moveId` rule.)

## 4. Dev/run shape (no prod infra needed to develop)

- `pnpm --filter @chessguru/ws dev` → uWS on `:8080`, `/ws` upgrade, `/healthz`.
- `NODE_ID=e1 pnpm --filter @chessguru/game-engine dev` and a second `NODE_ID=e2 …` → two authority
  nodes sharing one local Redis (the ring has 2 members; placement spreads games; kill one to test
  rehydration).
- Local Redis only (`redis://127.0.0.1:6379`). No Mongo in M0 (echo log is Redis-only; Mongo persistence
  starts M1 when there are real finished games).
- A tiny `scripts/m0-client.mjs` (ws client) or two browser tabs against a 30-line test page to drive
  `hello → sub → append → resync`.

## 5. Acceptance (M0 exit criteria — all must pass)

1. **Ordered echo through the authority.** Two clients `sub` to game `G`; either `append`s; both receive
   `appended` in the same order with monotonic `seq`. (Not a local broadcast — it routes through the
   single owning engine node.)
2. **Single-writer placement.** With two engine nodes up, `G` is owned by exactly one (`GET game:owner:G`
   is stable); a second concurrent placement attempt loses the `SET NX`.
3. **Idempotent/ordered.** An `append` with a stale `seq` is rejected with `error:stale-seq` and the
   client recovers via the returned `state`.
4. **Crash-rehydration.** Kill `G`'s owner node mid-session; within ≤15 s a new `append`/`sub` re-places
   `G` on the surviving node, which rehydrates the full `log` from `game:state:{G}`; clients `resync`
   cleanly with no lost entries.
5. **Reconnect.** A client drops its socket, reconnects to *any* gateway, `hello`+`resync{haveSeq}` →
   receives exactly the missed tail.
6. **Health.** Both apps expose `/healthz`; killing/relaunching either doesn't corrupt `G`'s log.

Passing all six means the **architecture** (transport + directory + single-writer + routing + recovery)
is proven on a trivial state machine. **M1 then swaps `EchoGrain` for a chess `RoundGrain`** (chessops
position, legality, game-end) with the directory/mailbox/snapshot/lease machinery unchanged — that's the
whole point of doing M0 first.

## 6. Out of scope for M0 (explicit)
Clocks (M2), rules/legality (M1), ratings/Mongo persistence (M1/M3), lobby/matchmaking (M4), premove/
offers/resign (M3), auth beyond a `hello` stub (M3 wires real session/OAuth), rate limiting & anti-cheat
capture (M5), regional gateways (post-M5).


---

## 7. Implementation (BUILT 2026-05-30)

Built in the v2 pnpm monorepo exactly as specced. Runs under global `tsx` (no build step);
deps installed via `corepack pnpm install`.

**Packages:** `packages/protocol` (envelope + codec + channels + consistent-hash ring),
`apps/game-engine` (redis, node-id, cluster/heartbeat, directory lease, mailbox, EchoGrain,
registry, snapshot, main), `apps/ws` (uWebSockets.js `SocketServer` adapter behind the D1 seam,
redis, router, main). All three `typecheck` clean.

**Run:** `cd v2 && bash scripts/run-m0.sh` — boots `e1`+`e2`+`gw1`, runs `scripts/m0-verify.mjs`,
tears down. Gateway on `:18080` (dev; `:8080` is taken on this box). Needs only local Redis.

**Verified (13 assertions over the 6 exit criteria):**
1. ordered echo through the authority to both clients, monotonic seq ✓
2. single-writer placement — owned by exactly one of e1/e2; concurrent `SET NX` loses ✓
3. stale/out-of-order append → `error:stale-seq` + recovery `state`; not broadcast ✓
4. **crash-rehydration** — SIGKILL the owner; after lease+node expiry the game re-places on the
   survivor, rehydrates the full log from `game:state`, seq continues uninterrupted ✓
5. reconnect to a fresh socket + `resync{haveSeq}` returns the exact missed tail ✓
6. gateway `/healthz` ✓

**Known M0-dev caveats (not bugs):** crash recovery waits the full ≤15s lease+heartbeat expiry by
design; `tsx` spawns a child node process that outlives a parent kill, so the harness also clears by
port on cleanup. **M1 is now BUILT** (2026-05-30): `EchoGrain` → chess `RoundGrain` (chess.js), Mongo
persistence of finished games, 14/14 acceptance incl. a full game to checkmate through a mid-game
owner crash — directory/mailbox/lease/snapshot machinery untouched, as designed. Run `bash
v2/scripts/run-m1.sh`.
