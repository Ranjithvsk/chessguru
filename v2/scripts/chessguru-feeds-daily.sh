#!/usr/bin/env bash
# Daily refresh of every upstream feed ChessGuru DB depends on.
#
#   openings  lichess-org/chess-openings — only re-names the 1.09M games when
#             the book actually changed, so a no-op day costs one HTTP request
#   dumps     database.lichess.org monthly broadcast archives — the complete
#             record, which is what makes "don't miss any games" true rather
#             than merely likely. The hourly API crawler covers the current
#             month; these fill in everything behind it.
#
# Each step is independent: one failing must not stop the next.
set -uo pipefail
API_DIR=/home/dreamworld/chessguru/v2/apps/api
SCRIPTS=/home/dreamworld/chessguru/v2/scripts
LOG=/home/dreamworld/logs/chessguru-feeds.log
LOCK=/tmp/chessguru-feeds-daily.lock

exec 9>"$LOCK"
if ! flock -n 9; then
  echo "$(date -u +%FT%TZ) skipped — previous run still going" >> "$LOG"
  exit 0
fi

run() {
  local label="$1"; shift
  echo "──── $(date -u +%FT%TZ)  $label"
  timeout 170m "$@" 2>&1
  echo "     $label exit=$?"
}

{
  cd "$API_DIR" || exit 1
  run "openings" node "$SCRIPTS/sync-openings.mjs"
  run "broadcast dumps" node "$SCRIPTS/sync-broadcast-dumps.mjs" --months=2
} >> "$LOG" 2>&1

if [ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt 4000 ]; then
  tail -n 1500 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi
