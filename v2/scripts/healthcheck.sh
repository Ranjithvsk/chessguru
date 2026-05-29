#!/usr/bin/env bash
# Watchdog for the ChessGuru v2 NestJS API (:4000). Run by cron every minute.
# Healthy  -> refresh the last-ok heartbeat and exit.
# Unhealthy-> restart the pm2 process, log the incident, and (optionally) POST a webhook alert.
export PATH=/usr/bin:/usr/local/bin:/bin:$PATH
DIR=/home/ubuntu/chessguru/v2
LOG="$DIR/logs/healthcheck.log"          # incidents only (small)
OK="$DIR/logs/healthcheck.lastok"        # latest healthy heartbeat (overwritten)
HOOKFILE="$DIR/logs/alert-webhook.url"   # optional: put a Slack/Discord/webhook URL here to get alerts
TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

body=$(curl -fsS --max-time 8 http://localhost:4000/api/health 2>/dev/null)
if echo "$body" | grep -q '"status":"ok"'; then
  echo "$TS OK $body" > "$OK"
  exit 0
fi

echo "$TS DOWN (body='${body:-<none>}') — restarting chessguru-v2-api" >> "$LOG"
pm2 restart chessguru-v2-api >> "$LOG" 2>&1
sleep 5
body2=$(curl -fsS --max-time 8 http://localhost:4000/api/health 2>/dev/null)
if echo "$body2" | grep -q '"status":"ok"'; then
  echo "$TS RECOVERED after restart" >> "$LOG"
  msg="ChessGuru API was DOWN, auto-restarted, RECOVERED at $TS"
else
  echo "$TS STILL DOWN after restart (body='${body2:-<none>}')" >> "$LOG"
  msg="ChessGuru API DOWN and FAILED to recover at $TS — needs attention"
fi
# optional alert
if [ -f "$HOOKFILE" ]; then
  url=$(cat "$HOOKFILE")
  curl -fsS --max-time 8 -X POST -H 'Content-Type: application/json' -d "{\"text\":\"$msg\"}" "$url" >/dev/null 2>&1 || true
fi
