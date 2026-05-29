# Session log: v2 — NestJS API uptime watchdog

**Date:** 2026-05-29

## Why
After the flip, the live root site depends on the NestJS API (pm2 `chessguru-v2-api` :4000). pm2
restarts on crash, but not on a hang / unresponsive port. Added an HTTP health watchdog.

## What
- `v2/scripts/healthcheck.sh` — curls `http://localhost:4000/api/health`; if not `{"status":"ok"}`
  it `pm2 restart chessguru-v2-api`, logs the incident, re-checks, and logs RECOVERED / STILL DOWN.
  Healthy runs refresh a heartbeat file. Optional alert: drop a Slack/Discord/webhook URL into
  `v2/logs/alert-webhook.url` and it POSTs `{"text": …}` on incidents.
- **cron (user ubuntu): every minute** → `…/v2/scripts/healthcheck.sh`.
- Logs: `v2/logs/healthcheck.log` (incidents only) + `v2/logs/healthcheck.lastok` (latest OK).

## Verified
- Script syntax ok; manual run on the healthy API → exit 0, wrote heartbeat
  `… OK {"status":"ok",…,"db":"connected"}`. Cron entry installed (preserved the existing
  update_status.sh entry).

## Notes
- Self-healing: an unresponsive API recovers within ~1 min automatically.
- To get push/email alerts, add a webhook URL to `v2/logs/alert-webhook.url` (no channel wired yet).
- pm2 process list is `pm2 save`d (survives reboot).
