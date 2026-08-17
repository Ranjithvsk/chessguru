#!/usr/bin/env bash
# Build the v2 web app and publish to BOTH the root site (/) and the /v2 path.
# (nginx: / -> /var/www/chessguru ; /v2/ -> /var/www/chessguru-v2 ; /v2api -> NestJS :4000)
set -euo pipefail
cd "$(dirname "$0")/.."                 # -> v2/
# Stamp the service-worker cache version per deploy — a fixed VERSION left returning
# devices on stale precached assets across deploys (sign-in looked dead, 2026-07-08).
STAMP="cg-$(date +%Y%m%d%H%M%S)"
sed -i "s/^const VERSION = \".*\";/const VERSION = \"${STAMP}\";/" apps/web/public/sw.js
echo "sw.js VERSION -> ${STAMP}"
# Wipe pattern preserves /vendor/ (10 MB opencv.js) even when public/ doesn't
# carry it. Without this, "manual warp failed" silently on 08-17 because the
# wipe removed vendor/ and the vite copy no longer had it either — user was
# executing HTML-as-JS from the SPA-fallback.
wipe_except_vendor() {
  local dir="$1"
  sudo find "$dir" -mindepth 1 -maxdepth 1 -not -name vendor -exec rm -rf {} +
}
# /v2 build (base /v2/ from vite.config)
corepack pnpm --filter @chessguru/web exec vite build
sudo mkdir -p /var/www/chessguru-v2 && wipe_except_vendor /var/www/chessguru-v2
sudo cp -r apps/web/dist/. /var/www/chessguru-v2/
# root build (base /)
corepack pnpm --filter @chessguru/web exec vite build --base=/
sudo mkdir -p /var/www/chessguru && wipe_except_vendor /var/www/chessguru
sudo cp -r apps/web/dist/. /var/www/chessguru/
sudo chmod -R a+rX /var/www/chessguru /var/www/chessguru-v2
echo "Published: / (root) and /v2"
