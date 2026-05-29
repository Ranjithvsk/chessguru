#!/usr/bin/env bash
# Generic pm2 HTTP watchdog.  Usage: watchdog.sh <pm2-name> <health-url>
# Healthy   -> refresh heartbeat, exit.
# Unhealthy -> pm2 restart <name>, log incident + recovery, optional webhook alert.
export PATH=/usr/bin:/usr/local/bin:/bin:$PATH
NAME="$1"; URL="$2"
if [ -z "$NAME" ] || [ -z "$URL" ]; then echo "usage: watchdog.sh <pm2-name> <health-url>" >&2; exit 2; fi
DIR=/home/ubuntu/chessguru/v2
LOG="$DIR/logs/watchdog-$NAME.log"
OK="$DIR/logs/watchdog-$NAME.lastok"
HOOKFILE="$DIR/logs/alert-webhook.url"
TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

body=$(curl -fsS --max-time 8 "$URL" 2>/dev/null)
if echo "$body" | grep -q '"status":"ok"'; then
  echo "$TS OK $body" > "$OK"; exit 0
fi
echo "$TS DOWN (body='${body:-<none>}') — restarting $NAME" >> "$LOG"
pm2 restart "$NAME" >> "$LOG" 2>&1
sleep 5
body2=$(curl -fsS --max-time 8 "$URL" 2>/dev/null)
if echo "$body2" | grep -q '"status":"ok"'; then
  echo "$TS RECOVERED after restart" >> "$LOG"; msg="$NAME was DOWN, auto-restarted, RECOVERED at $TS"
else
  echo "$TS STILL DOWN after restart (body='${body2:-<none>}')" >> "$LOG"; msg="$NAME DOWN, FAILED to recover at $TS — needs attention"
fi
if [ -f "$HOOKFILE" ]; then
  hook=$(cat "$HOOKFILE")
  curl -fsS --max-time 8 -X POST -H 'Content-Type: application/json' -d "{\"text\":\"$msg\"}" "$hook" >/dev/null 2>&1 || true
fi
