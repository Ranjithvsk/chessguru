# Session log: v2 — generic watchdog (API + engine-runner)

**Date:** 2026-05-29

## What
Generalized the uptime watchdog and applied it to the engine runner too.

- `v2/scripts/watchdog.sh <pm2-name> <health-url>` — generic: curls the health URL; if not
  `{"status":"ok"}` → `pm2 restart <name>`, logs incident + RECOVERED/STILL-DOWN, optional webhook
  alert (`v2/logs/alert-webhook.url`). Per-service heartbeat/log files
  (`watchdog-<name>.lastok` / `.log`). Replaces the old single-purpose `healthcheck.sh` (removed).
- **cron (user ubuntu), every minute:**
  - `watchdog.sh chessguru-v2-api http://localhost:4000/api/health`
  - `watchdog.sh engine-runner http://localhost:3002/health`

## Verified
Both run clean on healthy services (exit 0); heartbeats written:
- api → `{"status":"ok","service":"chessguru-v2-api","db":"connected"}`
- engine-runner → `{"status":"ok","running":false}`
Cron updated (kept update_status.sh). Earlier: API cron confirmed firing on the minute.

## Notes
- engine-runner only restarts if /health fails (a hung/down process) — won't interrupt a healthy
  in-progress tournament.
- Add a webhook URL to `v2/logs/alert-webhook.url` for push alerts (applies to both watchdogs).
