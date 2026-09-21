#!/usr/bin/env bash
# Nightly top-up of the ChessGuru DB game library from Lichess broadcasts.
#
# Only games we do NOT already hold are inserted: the loader fingerprints each
# game by its MOVE LIST, so the same game re-broadcast by a second tournament,
# or seen again on a later run, is recognised and skipped. Finished games only
# — a game still being played is left for a later run, or it would be archived
# frozen mid-play.
#
# Runs from apps/api because chess.js and mongodb resolve there.
set -uo pipefail

API_DIR=/home/dreamworld/chessguru/v2/apps/api
SCRIPT=/home/dreamworld/chessguru/v2/scripts/load-broadcast-games.mjs
LOG=/home/dreamworld/logs/chessguru-broadcast-sync.log
LOCK=/tmp/chessguru-broadcast-sync.lock
TOURS="${1:-80}"

# One at a time. A run that overruns into the next night must not have a second
# copy fetching the same rounds beside it — Lichess rate-limits hard, and two
# copies would simply 429 each other.
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "$(date -u +%FT%TZ) skipped — previous run still going" >> "$LOG"
  exit 0
fi

{
  echo "──────── $(date -u +%FT%TZ)  syncing ${TOURS} recent tournaments"
  cd "$API_DIR" || { echo "cannot cd $API_DIR"; exit 1; }
  timeout 50m node "$SCRIPT" --tours="$TOURS"
  echo "exit=$? at $(date -u +%FT%TZ)"
} >> "$LOG" 2>&1

# Keep the log readable rather than unbounded.
if [ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt 4000 ]; then
  tail -n 1500 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi
