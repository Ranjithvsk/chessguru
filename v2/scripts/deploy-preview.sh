#!/usr/bin/env bash
# Build the v2 web app and publish it to the public preview at https://harinitharanjith.com/v2/
# (nginx already routes /v2/ -> /var/www/chessguru-v2 ; same-origin /api hits the existing backend)
set -euo pipefail
cd "$(dirname "$0")/.."                 # -> v2/
corepack pnpm --filter @chessguru/web exec vite build
sudo mkdir -p /var/www/chessguru-v2
sudo rm -rf /var/www/chessguru-v2/*
sudo cp -r apps/web/dist/. /var/www/chessguru-v2/
sudo chmod -R a+rX /var/www/chessguru-v2
echo "Published to /var/www/chessguru-v2 — live at https://harinitharanjith.com/v2/"
