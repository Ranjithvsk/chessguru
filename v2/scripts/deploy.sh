#!/usr/bin/env bash
# Build the v2 web app and publish to BOTH the root site (/) and the /v2 path.
# (nginx: / -> /var/www/chessguru ; /v2/ -> /var/www/chessguru-v2 ; /v2api -> NestJS :4000)
set -euo pipefail
cd "$(dirname "$0")/.."                 # -> v2/
# /v2 build (base /v2/ from vite.config)
corepack pnpm --filter @chessguru/web exec vite build
sudo rm -rf /var/www/chessguru-v2/* && sudo cp -r apps/web/dist/. /var/www/chessguru-v2/
# root build (base /)
corepack pnpm --filter @chessguru/web exec vite build --base=/
sudo mkdir -p /var/www/chessguru && sudo rm -rf /var/www/chessguru/* && sudo cp -r apps/web/dist/. /var/www/chessguru/
sudo chmod -R a+rX /var/www/chessguru /var/www/chessguru-v2
echo "Published: / (root) and /v2"
