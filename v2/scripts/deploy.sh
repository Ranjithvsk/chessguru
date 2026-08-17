#!/usr/bin/env bash
# Build the ChessGuru web app and publish to /var/www/chessguru.
# nginx serves / from /var/www/chessguru (2026-08-15: /v2/ URL prefix retired,
# and /var/www/chessguru-v2 is now a symlink to /var/www/chessguru — so a
# single build + copy covers both).
set -euo pipefail
cd "$(dirname "$0")/.."                 # -> v2/

# Stamp the service-worker cache version per deploy — a fixed VERSION left
# returning devices on stale precached assets across deploys
# (sign-in looked dead, 2026-07-08).
STAMP="cg-$(date +%Y%m%d%H%M%S)"
sed -i "s/^const VERSION = \".*\";/const VERSION = \"${STAMP}\";/" apps/web/public/sw.js
echo "sw.js VERSION -> ${STAMP}"

# Wipe pattern preserves /vendor/ (10 MB opencv.js) even when public/ doesn't
# carry it. Without this, "manual warp failed" silently on 2026-08-17 because
# the wipe removed vendor/ and the vite copy no longer had it either —
# user was executing HTML-as-JS from the SPA-fallback.
wipe_except_vendor() {
  local dir="$1"
  sudo find "$dir" -mindepth 1 -maxdepth 1 -not -name vendor -exec rm -rf {} +
}

# Single build at base=/ — was building twice (once for /v2/ prefix, once
# for /) but /v2 is retired and chessguru-v2 is a symlink to chessguru
# anyway, so the /v2/-prefix build was overwritten by the / build.
corepack pnpm --filter @chessguru/web exec vite build --base=/
sudo mkdir -p /var/www/chessguru
wipe_except_vendor /var/www/chessguru
sudo cp -r apps/web/dist/. /var/www/chessguru/
sudo chmod -R a+rX /var/www/chessguru
echo "Published: /var/www/chessguru (nginx serves / from here; -v2 symlink follows)"
