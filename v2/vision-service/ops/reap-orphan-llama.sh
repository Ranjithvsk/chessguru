#!/usr/bin/env bash
# Safety net for stranded OCR model servers (owner 2026-09-22, TKT-255).
#
# The real fix is the PR_SET_PDEATHSIG wrapper that dream_ocr.py hands to Surya, so
# a llama-server dies with the process that spawned it. This catches what that
# cannot: a server started by a code path that does not go through dream_ocr, or
# one already orphaned before the wrapper existed. An orphan is unmistakable —
# llama-server whose parent is init (ppid 1) — because a live one is always a child
# of the python process using it. Only kills orphans older than GRACE minutes so a
# server mid-handover is never touched.
GRACE_MIN=${GRACE_MIN:-10}
LOG=/var/log/reap-orphan-llama.log
now=$(date +%s)
killed=0
for pid in $(pgrep -x llama-server 2>/dev/null); do
  [ -d "/proc/$pid" ] || continue
  ppid=$(awk '/^PPid:/{print $2}' "/proc/$pid/status" 2>/dev/null)
  [ "$ppid" = "1" ] || continue                      # has a live parent — in use
  started=$(stat -c %Y "/proc/$pid" 2>/dev/null || echo "$now")
  age_min=$(( (now - started) / 60 ))
  [ "$age_min" -ge "$GRACE_MIN" ] || continue
  rss_mb=$(( $(awk '/^VmRSS:/{print $2}' "/proc/$pid/status" 2>/dev/null || echo 0) / 1024 ))
  if kill -9 "$pid" 2>/dev/null; then
    echo "[$(date -u +%FT%TZ)] reaped orphan llama-server pid=$pid age=${age_min}m rss=${rss_mb}MB" >>"$LOG"
    killed=$((killed+1))
  fi
done
[ "$killed" -gt 0 ] && echo "[$(date -u +%FT%TZ)] reaped $killed orphan(s)" >>"$LOG"
exit 0
