# Session log: v2 — public preview live at /v2/

**Date:** 2026-05-29

## What
Published the v2 web app as a public preview at **https://harinitharanjith.com/v2/**, without
touching the live site at `/`.

## How
- Code: `vite base:"/v2/"` + React Router `basename="/v2"` (so assets + routes live under /v2).
- Build: `corepack pnpm exec vite build` (4.28s, 285KB JS/93KB gz; ~2.4G RAM free — no OOM).
- Serve: copied `dist/` → **/var/www/chessguru-v2** (nginx-readable; /home/ubuntu isn't traversable
  by www-data). Repeatable via `v2/scripts/deploy-preview.sh`.
- nginx: added `location /v2/ { alias /var/www/chessguru-v2/; try_files $uri $uri/ /v2/index.html; }`
  to `/etc/nginx/sites-available/chessguru` (backed up first), `nginx -t` clean, reloaded.
- Same-origin `/api` + `/auth` hit the existing Express backend → no dev proxy needed in prod build.

## Verified
- `/v2/` 200 serving our index; `/v2/assets/*.js|css` 200 (correct content-types); `/v2/puzzles`
  (SPA deep route) 200 via fallback. Old site `/` and `/api/health` still 200.
- Browser @ https://harinitharanjith.com/v2/ : colourful UI renders a real puzzle (#0EWLS) on the
  shared board. ✅

## Notes
- nginx config + /var/www are system files (not in git) — deploy steps captured here + in the script.
- Dev server on :5173 stopped (static preview supersedes it).
- To redeploy after changes: `bash v2/scripts/deploy-preview.sh` (no nginx change needed).
