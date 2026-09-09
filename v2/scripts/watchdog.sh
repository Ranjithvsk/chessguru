#!/usr/bin/env bash
# Generic pm2 HTTP watchdog.  Usage: watchdog.sh <pm2-name> <health-url>
# Healthy   -> refresh heartbeat, exit.
# Unhealthy -> CONFIRM, then pm2 restart <name>, log incident + recovery,
#              optional webhook alert.
#
# 2026-09-09: restarts are now confirmed before acting.
#
# The old version restarted on a SINGLE failed poll with an 8s timeout. Node
# serves this API on one thread, so any request that pinned the event loop for
# more than 8s looked exactly like a dead process. That is what happened at
# 14:27:01Z on 2026-09-09: a coach's board scan hit the old in-process
# classifier (64 sequential model forwards, ~31s), the health route could not
# answer, and this script restarted a perfectly healthy API mid-request. It
# killed the scan (the coach got a 502) and dropped every live class WebSocket
# with it. Fourteen such restarts had accumulated since 2026-08-15.
#
# The distinction that fixes it: a socket that REFUSES the connection means
# nothing is listening, which is unambiguous — confirm once, restart fast. A
# socket that ACCEPTS but answers slowly means the process is alive and busy,
# which needs patience, not a kill. We only restart a busy process once it has
# been unresponsive across several probes spanning ~40s.
#
# Tunables (env): WATCHDOG_TIMEOUT, WATCHDOG_BUSY_RETRIES,
#                 WATCHDOG_REFUSED_RETRIES, WATCHDOG_RETRY_GAP
export PATH=/usr/bin:/usr/local/bin:/bin:$PATH
NAME="$1"; URL="$2"
if [ -z "$NAME" ] || [ -z "$URL" ]; then echo "usage: watchdog.sh <pm2-name> <health-url>" >&2; exit 2; fi
DIR=/home/ubuntu/chessguru/v2
LOG="$DIR/logs/watchdog-$NAME.log"
OK="$DIR/logs/watchdog-$NAME.lastok"
HOOKFILE="$DIR/logs/alert-webhook.url"
LOCK="$DIR/logs/watchdog-$NAME.lock"

TIMEOUT=${WATCHDOG_TIMEOUT:-10}
BUSY_RETRIES=${WATCHDOG_BUSY_RETRIES:-3}
REFUSED_RETRIES=${WATCHDOG_REFUSED_RETRIES:-2}
RETRY_GAP=${WATCHDOG_RETRY_GAP:-12}

# Confirming takes longer than a cron minute, so stop overlapping runs from
# each restarting the same app. A run that finds the lock held just exits.
exec 9>"$LOCK" 2>/dev/null || exit 0
flock -n 9 || exit 0

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

# Sets PROBE_BODY. Returns 0 = healthy, 1 = busy/erroring, 2 = nothing listening.
probe() {
  PROBE_BODY=$(curl -fsS --max-time "$TIMEOUT" "$URL" 2>/dev/null)
  local rc=$?
  if [ $rc -eq 0 ] && echo "$PROBE_BODY" | grep -q '"status":"ok"'; then return 0; fi
  # curl 7 = couldn't connect. Nothing is bound to the port; the app is down.
  if [ $rc -eq 7 ]; then return 2; fi
  return 1
}

probe
case $? in
  0) echo "$(ts) OK $PROBE_BODY" > "$OK"; exit 0 ;;
  2) KIND=refused; TRIES=$REFUSED_RETRIES; GAP=3 ;;
  *) KIND=busy;    TRIES=$BUSY_RETRIES;    GAP=$RETRY_GAP ;;
esac

# Confirm before restarting. A single bad probe is not evidence of death.
i=1
while [ "$i" -le "$TRIES" ]; do
  sleep "$GAP"
  probe
  rc=$?
  if [ $rc -eq 0 ]; then
    echo "$(ts) TRANSIENT ($KIND) — answered again after $i confirm probe(s); NOT restarting" >> "$LOG"
    echo "$(ts) OK $PROBE_BODY" > "$OK"
    exit 0
  fi
  [ $rc -eq 2 ] && KIND=refused
  i=$((i + 1))
done

WINDOW=$((GAP * TRIES))
echo "$(ts) DOWN ($KIND: $((TRIES + 1)) consecutive failed probes over ~${WINDOW}s, body='${PROBE_BODY:-<none>}') — restarting $NAME" >> "$LOG"
pm2 restart "$NAME" >> "$LOG" 2>&1
sleep 5
body2=$(curl -fsS --max-time "$TIMEOUT" "$URL" 2>/dev/null)
if echo "$body2" | grep -q '"status":"ok"'; then
  echo "$(ts) RECOVERED after restart" >> "$LOG"; msg="$NAME was DOWN ($KIND), auto-restarted, RECOVERED at $(ts)"
else
  echo "$(ts) STILL DOWN after restart (body='${body2:-<none>}')" >> "$LOG"; msg="$NAME DOWN, FAILED to recover at $(ts) — needs attention"
fi
if [ -f "$HOOKFILE" ]; then
  hook=$(cat "$HOOKFILE")
  curl -fsS --max-time 8 -X POST -H 'Content-Type: application/json' -d "{\"text\":\"$msg\"}" "$hook" >/dev/null 2>&1 || true
fi
