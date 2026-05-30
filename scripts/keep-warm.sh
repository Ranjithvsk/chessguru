#!/usr/bin/env bash
# Keep the chess server + puzzle path resident in RAM so it never cold-starts
# from swap on an idle box. Pinged by cron every 2 min.
curl -fsS --max-time 10 http://127.0.0.1:3000/api/health >/dev/null 2>&1
curl -fsS --max-time 10 "http://127.0.0.1:3000/api/puzzles/random?theme=mix&rating=1500&difficulty=normal" >/dev/null 2>&1
date '+%F %T' > /home/ubuntu/chessguru/scripts/.keep-warm.last 2>/dev/null
