#!/usr/bin/env bash
# Boot the M4 cluster (2 engine nodes + lobby + 1 gateway), run the verifier,
# tear everything down. Run from v2/:  bash scripts/run-m4.sh
set -u
cd "$(dirname "$0")/.."   # → v2/
ROOT="$(pwd)"
LOG="$ROOT/logs"; mkdir -p "$LOG"
PIDS=()

cleanup() {
  echo "[run-m4] cleanup"
  for p in "${PIDS[@]:-}"; do kill -9 "$p" 2>/dev/null || true; done
  fuser -k 18080/tcp 9101/tcp 9102/tcp 2>/dev/null || true
  pkill -9 -f "apps/lobby/src/main.ts" 2>/dev/null || true
}
trap cleanup EXIT

redis-cli ping >/dev/null 2>&1 || { echo "[run-m4] redis not reachable"; exit 1; }
mongosh --quiet --eval 'db.runCommand({ping:1}).ok' chessguru >/dev/null 2>&1 || { echo "[run-m4] mongo not reachable"; exit 1; }

echo "[run-m4] starting engine e1, e2 + lobby + gateway gw1"
NODE_ID=e1 ENGINE_PORT=9101 tsx "$ROOT/apps/game-engine/src/main.ts" >"$LOG/e1.log" 2>&1 & PIDS+=($!)
NODE_ID=e2 ENGINE_PORT=9102 tsx "$ROOT/apps/game-engine/src/main.ts" >"$LOG/e2.log" 2>&1 & PIDS+=($!)
tsx "$ROOT/apps/lobby/src/main.ts"                                    >"$LOG/lobby.log" 2>&1 & PIDS+=($!)
WS_PORT=18080 GW_ID=gw1      tsx "$ROOT/apps/ws/src/main.ts"          >"$LOG/gw1.log" 2>&1 & PIDS+=($!)

for i in $(seq 1 40); do
  curl -fsS http://127.0.0.1:18080/healthz >/dev/null 2>&1 && break
  sleep 0.5
done
sleep 1

echo "[run-m4] running verifier"
WS_URL=ws://127.0.0.1:18080/ws node "$ROOT/scripts/m4-verify.mjs"; rc=$?

if [ "$rc" != "0" ]; then
  for f in e1 e2 lobby gw1; do echo "----- $f.log -----"; tail -n 25 "$LOG/$f.log"; done
fi
exit $rc
