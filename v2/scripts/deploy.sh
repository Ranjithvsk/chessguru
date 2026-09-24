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

# Bundle janitor. Hashed assets are immutable, so the only question is how long a
# tab that is ALREADY OPEN can still fetch the chunks its index referenced.
#
# This used to keep "the newest 10" of five named families. Two problems, both of
# which cost real lessons. Ten is a COUNT, and this repo ships many times a day —
# on 2026-09-23/24 it shipped 68 times in three days, so ten deploys of the entry
# chunk was under half a day of grace. And only five families were listed at all:
# AppRest, MyChallenges, InstagramStudio, Messages and FeesBatches were never
# pruned, so they grew without bound while the ones that mattered were culled
# fastest. A student mid-class whose lazy import 404s gets a page that has stopped
# working; 71 of those were logged in 21 days across 11 accounts and every domain.
#
# So retain by AGE, cover every family, and never cull this deploy's own files:
#   * anything modified within KEEP_DAYS stays, however many deploys have passed
#   * the newest KEEP_MIN of each family stays regardless, so a family that is
#     rebuilt rarely is never emptied
#   * nothing from the CURRENT build is eligible, which is what makes a long gap
#     between deploys safe: without it, a fortnight of quiet would put every live
#     asset past the cutoff at once
# Never touches vendor/ (opencv.js), index.html, or sw.js.
ASSETS=/var/www/chessguru/assets
KEEP_DAYS=14
KEEP_MIN=10
CUTOFF=$(date -d "$KEEP_DAYS days ago" +%s)
PROTECT_FROM=$(( $(stat -c %Y /var/www/chessguru/index.html) - 600 ))

pruned_total=0
while IFS='|' read -r fam ext; do
  [ -n "$fam" ] || continue
  victims=$(sudo find "$ASSETS" -maxdepth 1 -type f -name "${fam}-*.${ext}" -printf '%T@ %p\n' 2>/dev/null \
            | sort -rn \
            | awk -v min="$KEEP_MIN" -v cut="$CUTOFF" -v prot="$PROTECT_FROM" \
                  'NR>min && $1+0 < cut && $1+0 < prot {print $2}')
  if [ -n "$victims" ]; then
    n=$(echo "$victims" | wc -l)
    echo "  pruning ${fam}-*.${ext}: $n older than ${KEEP_DAYS}d"
    echo "$victims" | sudo xargs -r rm -f
    pruned_total=$(( pruned_total + n ))
  fi
done < <(sudo find "$ASSETS" -maxdepth 1 -type f \( -name '*.js' -o -name '*.css' \) -printf '%f\n' 2>/dev/null \
         | sed -E 's/-[A-Za-z0-9_]{6,}\.(js|css)$/|\1/' | sort -u)
echo "  janitor: removed ${pruned_total} asset(s) older than ${KEEP_DAYS} days"

echo "Published: /var/www/chessguru (nginx serves / from here; -v2 symlink follows)"
