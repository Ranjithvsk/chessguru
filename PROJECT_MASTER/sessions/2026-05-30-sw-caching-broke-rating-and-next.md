# Session 2026-05-30 — root cause: PWA service worker cached /v2api (broke rating + next puzzle)

**Symptoms:** logged-in rating showed 1500 on other devices; "next puzzle not loading" / same puzzle
repeated; theme/first felt stuck.

**Investigation chain:**
- userperfs has ranjith_vsk puzzle.r=1239 (intact). `myRating` reads it correctly when `session.userId` set.
- Browser: `/v2api/auth/me` → loggedIn:true but `/v2api/api/me/rating` → loggedIn:false (same cookie).
- `:4000` direct: BOTH routes work. Fresh curl via nginx: BOTH work. So app+nginx are fine.
- Browser: a cache-BUSTED url (`?_=ts`) returned the correct result, identical url returned stale —
  even with `cache:"no-store"`/`cache:"reload"`. → not HTTP cache → **the service worker**.

**Root cause:** the PWA `sw.js` (added earlier) cache-firsts same-origin GETs, skipping only `/api` and
`/auth`. The API is under **`/v2api`**, which the skip didn't match → the SW served STALE cached
`/v2api/...` responses (ignoring Cache-Control). `me/rating` cached as logged-out → 1500;
`puzzles/random` cached → same puzzle on "next".

**Fixes:**
1. `apps/web/public/sw.js` — rewrote: never handle `/(v2api|api|auth|ws)` (always network); cache-first
   ONLY for static assets (`.js/.css/.svg/...`); `BASE` derived from the SW URL (correct for `/` and
   `/v2/` deploys); **VERSION cg-v1 → cg-v2** (new SW skipWaiting+claim purges old caches). Redeployed.
2. `apps/api/src/main.ts` — added `Cache-Control: no-store` on all API responses (defense-in-depth so
   browser HTTP cache never holds dynamic/auth responses) + renamed session cookie `connect.sid → cgsid`
   (avoid any collision with the v1 app's cookie on this domain) + explicit `path:/`, `sameSite:lax`.
   Rebuilt + `pm2 restart chessguru-v2-api`.

**Verified (browser, after cg-v2 activated):** puzzles/random → 3 different ids; me/rating → loggedIn:true.

**Owner note:** existing devices must load the site once so the new SW (cg-v2) installs + purges the bad
cache (a normal reload does it; hard-refresh if needed). Re-login after the cookie rename. Then the
rating follows the account and "next" works.

**Files:** `v2/apps/web/public/sw.js`, `v2/apps/api/src/main.ts`.
