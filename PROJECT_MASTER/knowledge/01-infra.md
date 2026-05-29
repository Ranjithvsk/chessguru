# ChessGuru — Infrastructure

_Current as of 2026-05-29. Verified against the running host._

## Where it runs (CURRENT)

ChessGuru is **co-located on the Dream World Plants OVH VPS**, under a separate Linux user.

| | Value |
|---|---|
| Host | `vps-2c160fde` (OVH, shared with Dream World Plants) |
| RAM | 7.6 GiB total (shared box — see DreamWorld "OVH build OOM" note: builds can OOM) |
| Linux user | `ubuntu` (DreamWorld runs as `dreamworld` — fully separate) |
| App dir | `/home/ubuntu/chessguru` (`drwxr-x---` on `/home/ubuntu` → needs sudo to read from other users) |
| Web app | Node/Express on **:3000** (`server3.js`) |
| Engine API/WS | **:3002** (engine-runner REST + WebSocket) |

> **History:** the original `PROJECT_MASTER.md` describes a GCP `e2-small` at `34.143.245.57`
> and a *planned* migration to an OVH Kimsufi **KS-5 (32GB)**. Reality: the app was instead
> co-located on the existing DreamWorld OVH box above. Treat all GCP/KS-5 details as superseded.

## Domain / DNS / SSL

| | Value |
|---|---|
| Domain | `harinitharanjith.com` (+ `www`) |
| Registrar / DNS | Cloudflare (grey-cloud / not proxied — required for Certbot HTTP-01) |
| SSL | Let's Encrypt via Certbot, `/etc/letsencrypt/live/harinitharanjith.com/` |
| Cert expiry | **2026-07-29** (auto-renews) |

## nginx

Dedicated site, separate from DreamWorld: `/etc/nginx/sites-available/chessguru` (symlinked into `sites-enabled`).

| Location | Proxy → |
|---|---|
| `/` (and catch-all) | `localhost:3000` (web, with WebSocket upgrade) |
| `/engine-battle` | `localhost:3000` |
| `/ws-engine` | `localhost:3002` (WebSocket, 3600s read timeout) |
| `/api/engine-runner` | `localhost:3002` |

`client_max_body_size 10M`. Static-asset cache disabled on `/` (no-store headers).

## Stack

| Tool | Version |
|---|---|
| Node.js | 20.20.2 |
| MongoDB | 7 (service `mongod`, **active**, `mongodb://localhost:27017/chessguru`) |
| Redis | active (opportunistic cache only — app must work without it) |
| Express | 5.x |
| Mongoose | 9.x |
| PM2 | manages the 3 processes below |

## PM2 processes (user `ubuntu`)

| id | name | role | state |
|---|---|---|---|
| 0 | `chessguru` | web/API on :3000 (`server3.js`) | online |
| 2 | `engine-runner` | engine-vs-engine games + :3002 API/WS | online |
| 1 | `engine-updater` | refreshes `engines.json` registry | **stopped** (run on demand) |

```bash
# Always operate as the ubuntu user:
sudo -u ubuntu pm2 status
sudo -u ubuntu pm2 restart chessguru
sudo -u ubuntu pm2 logs chessguru --lines 50 --nostream
```

## Health / status

- `curl -s localhost:3000/api/health`
- `scripts/update_status.sh` runs on cron (~every 10 min) → writes `LIVE_STATUS.md` in the repo root
- Live status dashboard: `https://harinitharanjith.com/status` (also `/puzzle-status`)

## Secrets

- `/home/ubuntu/chessguru/.env` — currently holds `LICHESS_TOKEN` (gitignored).
- `SESSION_SECRET` is read from env with a hardcoded fallback in `server3.js` — **set a real
  `SESSION_SECRET` in `.env`** (the fallback is a known string).
