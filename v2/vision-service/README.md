# vision-service — vendored copy of the Ultra AI microservice

**These files RUN from `/opt/chessguru-vision/`, not from here.** That directory is
not a git repository and never has been, so until 2026-09-09 the ~46 KB Python
service behind every board scan existed only as a file on one disk, with ad-hoc
`.bak` copies beside it. This folder is the tracked copy.

| File | Deployed to | Runs as |
|---|---|---|
| `service.py` | `/opt/chessguru-vision/service.py` | systemd `chessguru-ultra-vision.service`, uvicorn on 127.0.0.1:5100 |
| `gen_realboard_composites.py` | `/opt/chessguru-vision/` and Vinayaka `C:\` | training-data generation, run by hand or by the nightly job |

## Keeping them in sync

There is no automatic sync. After editing either file:

```bash
sudo cp v2/vision-service/service.py /opt/chessguru-vision/service.py
sudo systemctl restart chessguru-ultra-vision.service
until curl -s http://127.0.0.1:5100/health | grep -q ok; do :; done
```

Restarting this service does **not** touch the NestJS API, so it cannot drop a
live class. The API proxies to it and spreads its JSON response verbatim, which
is why new response fields reach the web client with no API change at all.

Before copying anything back the other way, diff first — the deployed file is
the source of truth for what is actually serving.
