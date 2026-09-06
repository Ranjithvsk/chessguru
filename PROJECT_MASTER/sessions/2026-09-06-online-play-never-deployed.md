# 2026-09-06 — Play sat on "Waiting for a match" forever: the backend was never deployed

## What
Owner report: started a game in Play, nobody ever matched, UI stuck on
"Waiting for a match…". Not an empty lobby — **online play had no working
backend in production at all.**

## Why — two independent faults, either one fatal

**1. The shipped bundle dialled the user's own laptop.**
`apps/web/src/hooks/usePlay.ts` read:
```ts
const WS_URL = (import.meta.env.VITE_WS_URL) ?? "ws://localhost:18080/ws";
```
`VITE_WS_URL` was set nowhere in the repo, so the dev fallback got baked into
production. The literal `ws://localhost:18080/ws` was present in the live
`/var/www/chessguru/assets/AppRest-*.js`. Every visitor's browser tried to open
a socket to *its own machine* on port 18080.

**2. The services weren't running.**
`apps/ws`, `apps/lobby` and `apps/game-engine` existed in the tree and were
verified as M0–M5, but were never added to pm2 — ubuntu's pm2 ran only
`chessguru`, `chessguru-v2-api`, `book-engine`, `engine-runner` and the study
jobs. No ecosystem file referenced them. Redis had zero `seek:pool:*` keys.

The failure was silent because `usePlay.ts:211` sets `status = "seeking"`
unconditionally after calling `client.seek()` — a dead socket never surfaces.

## Fix

- **`v2/ecosystem.play.config.cjs`** (new) — `play-engine` (NODE_ID=e1,
  ENGINE_PORT=9101), `play-lobby`, `play-gateway` (WS_PORT=18080, GW_ID=gw1).
  Started under **ubuntu's** pm2, `pm2 save`d; `pm2-ubuntu` is enabled so they
  come back on boot.
  - Gateway is on **18080, not the app's default 8080** — 8080 is already held
    by an unrelated node process.
  - pm2 must run tsx as an **`interpreter`**, not as `script`. `.bin/tsx` is a
    `#!/bin/sh` wrapper; pm2 `require()`d it as CommonJS and every service
    crash-looped with `SyntaxError: missing ) after argument list`.
- **nginx `/etc/nginx/sites-enabled/chessguru`** — added `location = /ws`
  proxying to `127.0.0.1:18080` with upgrade headers, in **both** server blocks
  that serve `/var/www/chessguru` (chessguru.cc and admin.chessguru.cc).
  **Exact match** (`= /ws`) so it cannot shadow the existing `/ws-engine`.
  Backup at `/etc/nginx/chessguru.bak-20260906` — deliberately *outside*
  `sites-enabled`, since nginx loads every file in that directory.
- **`v2/apps/web/src/hooks/usePlay.ts`** — WS URL now derives from
  `location.host` when `VITE_WS_URL` is unset. The SPA is served from
  chessguru.cc, www and admin (and harinitharanjith.com 301s in), so a baked-in
  absolute URL would fix one host and break the rest.

## Verification
- Gateway `/healthz` → `ok`; `:18080` and `:9101` listening; all three services
  `online` with `restarts=0`.
- New bundle `AppRest-D3DoaV3Q.js` contains **no** `localhost:18080`.
- End-to-end through the **public** URL `wss://chessguru.cc/ws`: two clients
  each got `hello-ok → seek-ack → matched`, same game id, opposite colours.

## Landmines found
- `.env.development` is covered by `v2/.gitignore` (`.env.*`) and therefore
  **not in the repo**. Dev needs it recreated by hand, or `pnpm dev` will try
  same-origin against the Vite port:
  `apps/web/.env.development` → `VITE_WS_URL=ws://localhost:18080/ws`
- The `/home/ubuntu/chessguru` clone's git remote has a **GitHub PAT embedded in
  plaintext** in its origin URL, and the working tree has 376 dirty files. The
  build/deploy source is the `/home/dreamworld/chessguru` clone; the services
  run from the ubuntu one. Their `apps/lobby` and `usePlay.ts` were byte
  identical today, but nothing enforces that.
- `chessguru-v2-api` shows 176 restarts. Not investigated.

## Open
- Test game `g-485b1658-cee` (rated:false) left in `live_games` by the e2e
  check — delete when convenient.
- Only one engine node (`e1`) is running; M5 verified a 2-node cluster. Fine for
  academy load, revisit if concurrency grows.
- Nothing surfaces a failed socket to the user. A seek that never connects still
  reads as "Waiting for a match…" — worth a timeout + error state.
