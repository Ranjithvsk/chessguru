#!/usr/bin/env bash
# Play acceptance (identity / abort / claim / reconnect) against a PRIVATE cluster:
# its own redis-server on :6390 (pub/sub channels are global per instance, so the
# production lobby must not be able to hear these seeks), its own Mongo database,
# gateway on :18090. Safe to run while the production play services are up.
#   bash scripts/run-play-test.sh
set -u
cd "$(dirname "$0")/.."   # → v2/
ROOT="$(pwd)"
LOG="$ROOT/logs"; mkdir -p "$LOG"
PIDS=()
REDIS_PORT=6390
export REDIS_URL="redis://127.0.0.1:${REDIS_PORT}"
export MONGO_URI="mongodb://127.0.0.1:27017/chessguru_playtest"
export GW="ws://127.0.0.1:18090/ws"

cleanup() {
  echo "[play-test] cleanup"
  for p in "${PIDS[@]:-}"; do kill -9 "$p" 2>/dev/null || true; done
  fuser -k 18090/tcp 9191/tcp 2>/dev/null || true
  # tsx forks a node child that outlives its parent. An orphaned lobby has no port
  # to kill by, reconnects to the NEXT run's redis and processes every seek a second
  # time — which pairs a seeker with itself. Only this user's processes: production
  # runs the same scripts as `ubuntu`.
  pkill -9 -u "$(id -un)" -f 'apps/(lobby|ws|game-engine)/src/main.ts' 2>/dev/null || true
  redis-cli -p "$REDIS_PORT" shutdown nosave >/dev/null 2>&1 || true
}
# Refuse to start on top of leftovers from an earlier run for the same reason.
if pgrep -u "$(id -un)" -f 'apps/(lobby|ws|game-engine)/src/main.ts' >/dev/null; then
  echo "[play-test] killing leftover play processes from an earlier run"
  pkill -9 -u "$(id -un)" -f 'apps/(lobby|ws|game-engine)/src/main.ts' || true
  sleep 0.5
fi
trap cleanup EXIT

redis-server --port "$REDIS_PORT" --save "" --appendonly no --daemonize no >"$LOG/redis-test.log" 2>&1 & PIDS+=($!)
for i in $(seq 1 20); do redis-cli -p "$REDIS_PORT" ping >/dev/null 2>&1 && break; sleep 0.25; done
redis-cli -p "$REDIS_PORT" flushall >/dev/null
mongosh --quiet --eval 'db.dropDatabase()' chessguru_playtest >/dev/null 2>&1 || true

echo "[play-test] starting t1 + lobby + gw-test(:18090) on redis :$REDIS_PORT"
NODE_ID=t1 ENGINE_PORT=9191 tsx "$ROOT/apps/game-engine/src/main.ts" >"$LOG/t1.log" 2>&1 & PIDS+=($!)
tsx "$ROOT/apps/lobby/src/main.ts"                                     >"$LOG/lobby-test.log" 2>&1 & PIDS+=($!)
WS_PORT=18090 GW_ID=gwt tsx "$ROOT/apps/ws/src/main.ts"                >"$LOG/gw-test.log" 2>&1 & PIDS+=($!)

for i in $(seq 1 40); do
  curl -fsS http://127.0.0.1:18090/healthz >/dev/null 2>&1 && curl -fsS http://127.0.0.1:9191/healthz >/dev/null 2>&1 && break
  sleep 0.5
done
sleep 1

echo "[play-test] running verifier"
node "$ROOT/scripts/play-verify.mjs"; rc=$?

if [ "$rc" != "0" ]; then
  echo "----- redis seek state -----"
  redis-cli -p "$REDIS_PORT" --scan --pattern 'seek:*' | while read -r k; do echo "$k => $(redis-cli -p "$REDIS_PORT" type "$k")"; done
  redis-cli -p "$REDIS_PORT" hgetall seek:meta | paste - - | cut -c1-300
  redis-cli -p "$REDIS_PORT" hgetall seek:byuser | paste - -
  for f in t1 lobby-test gw-test; do echo "----- $f.log -----"; grep -a -v '^\s*$' "$LOG/$f.log" | grep -av ECONNREFUSED | tail -n 30; done
fi
exit $rc
