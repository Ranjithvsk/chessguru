# ChessGuru v2 — Deploy Playbook

_Written 2026-08-29 after the Fees MVP deploy. Reflects the exact steps that worked; update when the reality drifts._

Applies to the **NestJS API + Vite React web** in `v2/apps/{api,web}`. Not the v1 puzzle monolith at `/` — that's a different pipeline (see [01-infra.md](01-infra.md)).

---

## What's actually on prod

| | Value |
| --- | --- |
| Host | `vps-2c160fde` (France OVH, shared with DreamWorld) |
| Linux user for prod | `ubuntu` (all v2 pm2 procs) |
| pm2 process | `chessguru-v2-api` (NestJS, port **:4000**) |
| API script | `/home/ubuntu/chessguru/v2/apps/api/dist/main.js` |
| API cwd | `/home/ubuntu/chessguru/v2/apps/api` |
| Web served from | `/var/www/chessguru/` |
| Nginx routes | `/v2api/*` → `localhost:4000/*` · everything else → v1 SPA |
| Web client base | `VITE_API_BASE=/v2api` (set in `apps/web/.env.production`) |

---

## Two source clones — pick the right one

Two on-disk trees of the same repo. Know what's shared:

```
/home/dreamworld/chessguru/v2/     ← dev clone (source of truth for src)
/home/ubuntu/chessguru/v2/         ← deploy clone (builds + serves)

apps/api/src   → symlink from ubuntu to dreamworld
apps/web/src   → symlink from ubuntu to dreamworld

apps/api/dist            per-clone
apps/web/dist            per-clone
node_modules             per-clone
package.json             per-clone (needs manual sync via git)
nest-cli.json            per-clone
tsconfig.json            per-clone
pnpm-lock.yaml           per-clone
```

**Consequence:** editing `apps/*/src/**` in dreamworld is instantly visible from ubuntu. But `package.json`, `nest-cli.json`, `tsconfig.json` and `pnpm-lock.yaml` changes must be synced explicitly (see step 3 below).

---

## Pre-flight

```
# Dev clone, main branch, everything committed
cd /home/dreamworld/chessguru
git status --short          # empty for tracked files (symlink noise ok)
git log --oneline -5        # know what you're deploying

# Type-check the app(s) you touched (fees files ONLY — pre-existing
# errors in unrelated files are handled below)
cd v2/apps/api && npx tsc --noEmit 2>&1 | grep -E 'YOUR_MODULE|error' | head
cd v2/apps/web && npx tsc --noEmit 2>&1 | grep -E 'YOUR_PAGE|error' | head
```

Pre-existing errors that are OK to ignore:
- `apps/api`: **none** — the `declaration: false` in tsconfig neutralises all 43 TS2742 "type can't be named" errors.
- `apps/web`: TS18048 / TS2532 in `StudyChapterEdit.tsx`, `UsersManager.tsx`, `analytics/purchases/page.tsx`, `pos-pr.ts`. These pre-date Fees; vite build ignores them.

---

## The deploy — 6 steps

Every step is copy-pasteable.

### 1 · Merge to main + push

```
cd /home/dreamworld/chessguru
git checkout main
git pull --ff-only
git merge --no-ff feat/YOUR-BRANCH -m "Merge feat/YOUR-BRANCH → main (short summary)"
git push
```

### 2 · Fast-forward the ubuntu deploy clone

**Do NOT `git pull` on the ubuntu clone.** The `src/` symlinks make git see hundreds of "deleted" files and pull will fight you. Targeted checkout instead — pull *only* the non-symlinked config/dep files:

```
sudo -u ubuntu git -C /home/ubuntu/chessguru fetch origin main
sudo -u ubuntu git -C /home/ubuntu/chessguru checkout origin/main -- \
  v2/apps/api/nest-cli.json \
  v2/apps/api/package.json \
  v2/apps/api/tsconfig.json \
  v2/apps/web/package.json \
  v2/apps/web/tsconfig.json \
  v2/apps/web/index.html \
  v2/pnpm-lock.yaml
```

⚠ `apps/web/index.html` is NOT under `src/` and NOT symlinked — same trap as
package.json. Any change to the boot-safety-net script / meta tags / tenant-
brand hydrator will silently NOT deploy unless this checkout runs. Discovered
2026-08-30 when a fix to the safety-net timeout appeared in the source but
kept building the old `TIMEOUT_MS = 6000` on ubuntu.

Add any other tracked non-symlinked file your change touched (e.g. a new `scripts/*` file).

Session notes under `v2/PROJECT_MASTER/sessions/*.md` don't need checkout — they're documentation, not runtime.

### 3 · Install new deps (only if package.json changed)

```
sudo -u ubuntu bash -lc 'cd /home/ubuntu/chessguru && corepack use pnpm@9.12.0 && corepack pnpm --filter @chessguru/api install'
# and/or:
sudo -u ubuntu bash -lc 'cd /home/ubuntu/chessguru && corepack pnpm --filter @chessguru/web install'
```

The `corepack use pnpm@9.12.0` is important once per fresh shell — corepack now defaults to pnpm@11 which crashes on our Node 20.20.2 with `ERR_UNKNOWN_BUILTIN_MODULE`. The root package.json pins 9.12.0.

### 4 · Build the API

```
sudo -u ubuntu bash -lc 'cd /home/ubuntu/chessguru && corepack pnpm --filter @chessguru/api build'
```

- `nest build` wipes `apps/api/dist/` at start (`deleteOutDir: true`). If tsc fails, dist is now partial → **do not restart pm2 or it will crash-loop**. Fix the compile errors first.
- Verify outputs:

```
ls -la /home/ubuntu/chessguru/v2/apps/api/dist/main.js \
       /home/ubuntu/chessguru/v2/apps/api/dist/fees/fees.controller.js \
       /home/ubuntu/chessguru/v2/apps/api/dist/fees/fonts/DejaVuSans.ttf
```

Missing font → the `assets` entry in `nest-cli.json` got lost. See [Known landmines](#known-landmines).

### 5 · Build the web

```
sudo -u ubuntu bash -lc 'cd /home/ubuntu/chessguru/v2/apps/web && npx vite build'
```

**Not** `pnpm --filter @chessguru/web build` — the scripted build runs `tsc -b && vite build` first, and the pre-existing web TS errors fail the pre-check. Direct `vite build` type-strips via esbuild and works fine.

Verify your feature's strings landed:

```
grep -oE 'YOUR_UNIQUE_UI_STRING' /home/ubuntu/chessguru/v2/apps/web/dist/assets/index-*.js
```

### 6 · Deploy web to nginx doc-root + restart API

```
# Web (sudo needed — /var/www/chessguru has mixed ownership including root-owned subtrees)
sudo rsync -a --no-perms --no-owner --no-group \
  /home/ubuntu/chessguru/v2/apps/web/dist/index.html \
  /var/www/chessguru/

sudo rsync -a --no-perms --no-owner --no-group \
  /home/ubuntu/chessguru/v2/apps/web/dist/assets/ \
  /var/www/chessguru/assets/

# API
sudo -u ubuntu pm2 restart chessguru-v2-api --update-env
```

**Never `--delete` at `/var/www/chessguru/` root.** Subdirs (`openings/`, `vendor/`, `models/`, `feature-shots/`) hold large generated/vendored assets owned by root; `--delete` triggers permission errors and risks losing them. Stale hashed `assets/index-<hash>.js` files accumulate (~100–200 MB); prune quarterly with a targeted `find -mtime`.

---

## Smoke tests (mandatory)

```
# 1. Fresh bundle is being served
BUNDLE=$(curl -sS https://chessguru.cc/ | grep -oE 'index-[A-Za-z0-9]+\.js' | head -1)
NEWEST=$(ls -t /home/ubuntu/chessguru/v2/apps/web/dist/assets/index-*.js | head -1 | xargs basename)
[[ "$BUNDLE" == "$NEWEST" ]] && echo "OK web bundle" || echo "FAIL: $BUNDLE != $NEWEST"

# 2. API is up + your new route returns 401 (route wired, guard firing)
curl -sS -o /dev/null -w '%{http_code}\n' https://chessguru.cc/v2api/api/YOUR/NEW/ROUTE
# → 401 (or 4xx) = wired · 5xx = broken · 404 = route not registered

# 3. Nest booted clean
sudo -u ubuntu pm2 logs chessguru-v2-api --nostream --lines 30 | tail -30
# Expect: "NestApplication successfully started" + "ChessGuru v2 API on :4000"
# Any red / unhandled promise rejection = STOP + investigate

# 4. Your UI string in the served bundle
curl -sS "https://chessguru.cc/assets/$BUNDLE" | grep -c 'YOUR UNIQUE STRING'
# expect ≥ 1
```

Fail any of these → **rollback** (next section).

---

## Session note (required per repo working rules)

Write to `v2/PROJECT_MASTER/sessions/YYYY-MM-DD-<topic>.md`:
- what shipped (commit SHA → prod)
- verification (URLs + HTTP codes from the smoke tests)
- anything unusual you had to work around

---

## Rollback

```
# Revert the merge commit + re-deploy
cd /home/dreamworld/chessguru
git checkout main
git revert -m 1 <MERGE_SHA> -e   # -m 1 = keep first-parent (main) side
git push

# Then re-run steps 2, 4, 5, 6 on the ubuntu clone.
```

Slower but safer than surgery on ubuntu's dist. If the API crash-loops during the swap, `sudo -u ubuntu pm2 restart chessguru-v2-api` after the revert-build finishes brings it back.

---

## Known landmines

| Landmine | Recovery |
| --- | --- |
| **`git pull` on ubuntu clone** trips over 300+ "deleted" symlinked files | Use targeted `git checkout origin/main -- <paths>` (step 2). |
| **`corepack pnpm` = pnpm@11 by default** → crashes with `ERR_UNKNOWN_BUILTIN_MODULE` on Node 20.20.2 | `corepack use pnpm@9.12.0` once per shell. Repo pins 9.12.0 in root `package.json`. |
| **`nest build` deletes `dist/` at start** — failed build = corrupted dist | Fix compile errors before restarting pm2. `pm2 restart` will crash-loop otherwise. |
| **`declaration: true` in api tsconfig** ⇒ 43 pre-existing TS2742 errors | Repo now has `declaration: false` (`v2/apps/api/tsconfig.json`, with a comment). Do not flip back. |
| **PDF endpoints throw `Bundled DejaVu Sans not found`** | The `assets` entry in `nest-cli.json` got dropped. Restore: `{ "include": "fees/fonts/*.ttf", "outDir": "dist" }` under `compilerOptions.assets`, rebuild. |
| **Web scripted build fails on `tsc -b`** (pre-existing errors) | Use `npx vite build` directly. Longer term: fix the null-guard errors in StudyChapterEdit / UsersManager / analytics-purchases / pos-pr. |
| **`/var/www/chessguru` mixed ownership** — rsync as ubuntu partially fails | Use `sudo rsync ... --no-perms --no-owner --no-group ...`. Never `--delete` at root of that tree. |
| **Client hits `/api/fees/*` instead of `/v2api/api/fees/*`** | `apps/web/.env.production` sets `VITE_API_BASE=/v2api`. If a new fetch skips the helper and hardcodes `/api/…`, it hits the v1 SPA. Fix by routing through the `req()` helper in `lib/fees-api.ts` (or the equivalent for other modules). |
| **New nginx route needed** | `/etc/nginx/sites-enabled/chessguru` — add a `location` under the chessguru.cc server block that proxies to `localhost:4000/…`, `sudo nginx -t`, `sudo systemctl reload nginx`. |

---

## Not covered here (yet)

- Canary flow — there's no v2 canary process yet (equivalent of `dw-pos-canary`). If v2 deploys start biting, spin up `chessguru-v2-api-canary` on :4010 + `canary.chessguru.cc` and follow the DreamWorld canary pattern from `scripts-deploy/deploy-next-app.sh`.
- Db migrations — Mongo is schema-flexible so most changes are lazy. When we ship a change that requires a migration (rename, backfill), add a `v2/apps/api/src/migrations/` script and document it in the session note.
- Rollout to a subset of academies — currently every deploy hits every tenant. Feature-flag gating (GrowthBook per the world-class plan) is future work.
- v1 (puzzle monolith) deploys — separate pipeline, see [01-infra.md](01-infra.md). `pm2 restart chessguru`.
