# ADR-0001: `server3.js` is the only live entrypoint; routes load inside the connect callback

**Status:** Accepted · **Date:** 2026-04 (documented 2026-05-29)

## Context
The repo accumulated `server.js`, `server2.js`, then `server3.js`. Older versions and `.bak`
files were left behind. Separately, route handlers need `req.session`, which depends on
`express-session` + `MongoStore` being mounted first.

## Decision
- `server3.js` is the **single live entrypoint** (PM2 `chessguru`, nginx → :3000). Older
  `server*.js` versions are dead and have been archived (they no longer exist in the working tree).
- `require("./routes")` is called **inside** the `mongoose.connect().then()` callback, *after*
  the session middleware is mounted.

## Consequences
- Do **not** move `require("./routes")` to the top of the file — it breaks sessions.
- Boot sequence: helmet → cors → json → mongoose.connect → (session+store) → static + page routes
  → auth routes → `/api` (rate-limited) → `/blindfold` → `/*splat` catch-all → listen.
