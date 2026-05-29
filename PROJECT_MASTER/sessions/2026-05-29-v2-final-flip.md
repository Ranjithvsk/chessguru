# Session log: v2 — FINAL FLIP (new app now serves harinitharanjith.com root)

**Date:** 2026-05-29

## What
`https://harinitharanjith.com/` now serves the rebuilt v2 app (React + NestJS + Mongo). The old
Express app keeps running on :3000 (pm2 `chessguru`) as an instant rollback — just not routed at /.

## Changes
- `main.tsx`: router basename now derived from `import.meta.env.BASE_URL` → one source builds both
  `/v2` (base /v2/) and root (base /). 
- Built two bundles: `vite build` → /var/www/chessguru-v2 (/v2); `vite build --base=/` →
  /var/www/chessguru (root). `v2/scripts/deploy.sh` does both.
- nginx (chessguru site): `location /` switched from `proxy_pass :3000` → static SPA from
  `/var/www/chessguru` (`try_files $uri $uri/ /index.html`); removed the old `= /engine-battle`
  proxy (SPA handles it). Kept `/v2api`→:4000, `/ws-engine`+`/api/engine-runner`→:3002, `/v2/`.
  Config backed up; `nginx -t` clean; reloaded.

## Verified
- https://harinitharanjith.com/ → new app (board renders, "Factory" nav); API calls hit
  /v2api → NestJS (themes, puzzles/random, auth/me, me/rating) 200. Deep routes (/blindfold,
  /admin) 200 via SPA fallback. /v2api/api/health ok. Old app still 200 on :3000.

## ROLLBACK (if needed)
Restore the backup and reload — instant, old app is still running:
```
sudo cp /etc/nginx/sites-available/chessguru.bak-flip-<TS> /etc/nginx/sites-available/chessguru
sudo nginx -t && sudo systemctl reload nginx
```
(Backups are in /etc/nginx/sites-available/chessguru.bak-flip-*.)

## Status
v2 rebuild COMPLETE and LIVE at the root domain. The original `/v2` path still works too.
Remaining polish (non-blocking): BullMQ engine pipeline, richer pool/path selection port.
