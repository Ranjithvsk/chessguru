#!/usr/bin/env bash
# Build the ChessGuru web app and publish to /var/www/chessguru.
# nginx serves / from /var/www/chessguru (2026-08-15: /v2/ URL prefix retired,
# and /var/www/chessguru-v2 is now a symlink to /var/www/chessguru — so a
# single build + copy covers both).
#
# 2026-08-27: switched from wipe+cp to rsync-without-delete so a user who
# already loaded the old index.html can still fetch the old hashed asset
# filenames until they navigate/refresh. The wipe+cp pattern was giving
# every in-flight user a broken shell during the ~200-ms deploy window
# (owner report: "after deploy gunachess.com not loading properly").
# Old bundles are pruned by a lightweight janitor (keeps 10 newest of each
# family) at the end of every deploy so /var/www doesn't grow unbounded.
set -euo pipefail
cd "$(dirname "$0")/.."                 # -> v2/

# Stamp the service-worker cache version per deploy — a fixed VERSION left
# returning devices on stale precached assets across deploys
# (sign-in looked dead, 2026-07-08).
STAMP="cg-$(date +%Y%m%d%H%M%S)"
sed -i "s/^const VERSION = \".*\";/const VERSION = \"${STAMP}\";/" apps/web/public/sw.js
echo "sw.js VERSION -> ${STAMP}"

# Single build at base=/ — was building twice (once for /v2/ prefix, once
# for /) but /v2 is retired and chessguru-v2 is a symlink to chessguru
# anyway, so the /v2/-prefix build was overwritten by the / build.
corepack pnpm --filter @chessguru/web exec vite build --base=/
sudo mkdir -p /var/www/chessguru/assets

# rsync new files IN (no --delete). Old files (index.html, hashed bundles,
# other assets) stay in place so a user mid-load of the previous index.html
# can still fetch the previously-hashed JS/CSS. The new index.html points
# at the newly-hashed bundle; subsequent loads get the new shell.
sudo rsync -a --chmod=D755,F644 apps/web/dist/. /var/www/chessguru/
echo "rsync'd new dist → /var/www/chessguru (old assets preserved)"

# Bundle janitor: keep the 10 most-recently-modified hashed assets of each
# family (index-XXX.js, index-XXX.css, chessground-XXX.js/.css, kpkWorker-XXX.js).
# Anything older than the newest 10 in each family gets removed. Never
# touches vendor/ (opencv.js), index.html, or sw.js.
prune_family() {
  local pattern="$1"
  # -mindepth 2 so we only look at /assets/*, never top-level
  # Sort by mtime desc, keep 10 newest, delete the rest.
  local files
  files=$(sudo find /var/www/chessguru/assets -maxdepth 1 -type f -name "$pattern" -printf '%T@ %p\n' 2>/dev/null | sort -rn | awk 'NR>10 {print $2}')
  if [ -n "$files" ]; then
    echo "  pruning $pattern:" $(echo "$files" | wc -l) "old"
    echo "$files" | sudo xargs -r rm -f
  fi
}
prune_family 'index-*.js'
prune_family 'index-*.css'
prune_family 'chessground.cburnett-*.js'
prune_family 'chessground.cburnett-*.css'
prune_family 'kpkWorker-*.js'

echo "Published: /var/www/chessguru (nginx serves / from here; -v2 symlink follows)"
