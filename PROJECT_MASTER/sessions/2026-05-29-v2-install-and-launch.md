# Session log: v2 — careful install + launch (verified)

**Date:** 2026-05-29

## What
Installed the web app deps and launched the dev server — verified the new colourful UI renders a
real puzzle on the shared board.

## How (careful, shared prod VPS)
- `corepack pnpm install --filter "@chessguru/web..."` (web + types only; skipped NestJS deps).
- Memory watched throughout: ~2.4 GiB RAM free + 6.2 GiB swap; install took **8.8s**, 230 pkgs,
  no memory pressure (RAM free actually rose). corepack used (pnpm not globally installed).
- `corepack pnpm --filter @chessguru/web dev` → Vite on **127.0.0.1:5173** (proxies /api,/auth → :3000).

## Verified (Playwright @1280)
- HTTP 200; React app mounts; **shared board renders a real puzzle** (#0JYrj, via existing API).
- Colourful design confirmed (brand gradient, cards, gold hint button, good contrast).
- Console clean except favicon 404 + React Router v7 future-flag warnings (harmless).

## Notes
- Dev server is bound to localhost only (not publicly reachable). Next: expose a public preview —
  build static (`vite build`, base `/v2/`) + nginx `location /v2/` on harinitharanjith.com, since
  same-origin `/api` already hits the existing backend (no dev proxy needed in the static build).
- To stop the dev server: `pkill -f "vite"` (as ubuntu) — or it'll be replaced by the static build.
