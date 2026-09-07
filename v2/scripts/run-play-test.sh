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
  redis-cli -p "$REDIS_PORT" shutdown nosave >/dev/null 2>&1 || true
}
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
  for f in t1 lobby-test gw-test; do echo "----- $f.log -----"; tail -n 30 "$LOG/$f.log"; done
fi
exit $rc
