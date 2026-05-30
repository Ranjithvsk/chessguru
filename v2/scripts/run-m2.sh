#!/usr/bin/env bash
# Boot the M1 cluster (2 engine nodes + 1 gateway), run the chess verifier,
# tear everything down. Run from v2/:  bash scripts/run-m2.sh
set -u
cd "$(dirname "$0")/.."   # → v2/
ROOT="$(pwd)"
LOG="$ROOT/logs"; mkdir -p "$LOG"
PIDS=()

cleanup() {
  echo "[run-m2] cleanup"
  for p in "${PIDS[@]:-}"; do kill -9 "$p" 2>/dev/null || true; done
  # tsx spawns child node procs that outlive the parent — also clear by port
  fuser -k 18080/tcp 9101/tcp 9102/tcp 2>/dev/null || true
}
trap cleanup EXIT

redis-cli ping >/dev/null 2>&1 || { echo "[run-m2] redis not reachable"; exit 1; }
mongosh --quiet --eval 'db.runCommand({ping:1}).ok' chessguru >/dev/null 2>&1 || { echo "[run-m2] mongo not reachable"; exit 1; }

echo "[run-m2] starting engine e1, e2 + gateway gw1"
NODE_ID=e1 ENGINE_PORT=9101 tsx "$ROOT/apps/game-engine/src/main.ts" >"$LOG/e1.log" 2>&1 & PIDS+=($!)
NODE_ID=e2 ENGINE_PORT=9102 tsx "$ROOT/apps/game-engine/src/main.ts" >"$LOG/e2.log" 2>&1 & PIDS+=($!)
WS_PORT=18080 GW_ID=gw1      tsx "$ROOT/apps/ws/src/main.ts"          >"$LOG/gw1.log" 2>&1 & PIDS+=($!)

for i in $(seq 1 40); do
  curl -fsS http://127.0.0.1:18080/healthz >/dev/null 2>&1 && break
  sleep 0.5
done
sleep 1  # let engines register in the ring

echo "[run-m2] running verifier"
WS_URL=ws://127.0.0.1:18080/ws WS_HTTP=http://127.0.0.1:18080 node "$ROOT/scripts/m2-verify.mjs"; rc=$?

if [ "$rc" != "0" ]; then
  echo "----- e1.log -----"; tail -n 30 "$LOG/e1.log"
  echo "----- e2.log -----"; tail -n 30 "$LOG/e2.log"
  echo "----- gw1.log -----"; tail -n 30 "$LOG/gw1.log"
fi
exit $rc
