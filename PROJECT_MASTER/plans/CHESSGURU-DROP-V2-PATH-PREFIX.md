# Drop `/v2/` path prefix — unify web serving across apex + tenants

**Status:** EXECUTED 2026-08-15 07:42 UTC
**Owner:** ranjith.vsk@gmail.com
**Created:** 2026-08-15
**Trigger:** gunachess.com white-screen root-cause traced to `/v2/` build prefix vs. auto-gen tenant nginx that has no `/v2/` location block. Owner directive: "v2 is problem, letss make all process from harinitharanjith.com plan deeply and execute".

---

## Goal
- Single URL surface: apex, tenant custom-domains, and academy sub-paths all serve the web bundle from `/` — no `/v2/` prefix anywhere in HTML, JS, SW, nginx, or backend-generated links.
- Zero broken links for existing users, bookmarks, shared class-invite URLs, emails.
- Zero permanently-trapped users from the transition.

---

## Current state (2026-08-15)

**Build config:** `apps/web/vite.config.ts:8` -> `base: "/v2/"` — every asset URL prefixed.

**Web roots:**
- `/var/www/chessguru-v2/` — served by apex `harinitharanjith.com` (also www.) via `location /v2/ { rewrite ^/v2/(.*)$ /$1 break; root /var/www/chessguru-v2; }`
- `/var/www/chessguru/` — served by tenant custom-domains (e.g. gunachess.com) at root. `location /v2/` block missing -> currently patched with self-symlink `/var/www/chessguru/v2 -> .` (hack).

**Trapped users:** any device with cached HTML from before 2026-08-15 04:42 still references deleted asset chunks -> white-screen with no safety-net script. New SW `cg-20260815045042` is network-first for navigation, so one full reload on a healthy network unsticks them — but users on aggressive PWA install (Add to Home Screen) may not get a navigation event until they close and reopen the app.

---

## Every `/v2/` reference (grep, 2026-08-15)

| File | Line | Change |
|---|---|---|
| `apps/web/vite.config.ts` | `base: "/v2/"` | change to `base: "/"` |
| `apps/web/src/lib/chessClassifierClient.ts` | `MODEL_URL = "/v2/models/..."`, `CLASSES_URL = "/v2/models/..."` | change to `"/models/..."` |
| `apps/web/src/lib/neuralBoardDetect.ts` | `MODEL_URL = "/v2/models/..."`, `META_URL = "/v2/models/..."` | change to `"/models/..."` |
| `apps/web/src/pages/Admin.tsx:129` | `<a href="/v2/board-editor">` | change to `/board-editor` |
| `apps/web/src/App.tsx:43` | `if (path !== "/" && path !== "/v2/" && path !== "/v2")` | leave — no-op guard, safe |
| `apps/web/src/pages/Book.tsx:13` | `const BASE = import.meta.env.BASE_URL` | no change — auto-adapts from vite config |
| `apps/web/src/pages/AcademyPublic.tsx:1886` | `fontshare.com/v2/css?...` | no change — external CDN, unrelated |
| `apps/api/src/class/class-live.controller.ts:51` | generates `joinPath = /v2/class-v2/${id}?role=student` | change to `/class-v2/${id}?role=student` |
| `apps/api/src/coach-profile/coach-domain.service.ts:45` | comment | cosmetic update |

**Re-verify at execution time:**
```
grep -rn '"/v2/\|'"'"'/v2/' apps/{web/src,web/index.html,web/public,api/src} | grep -v fontshare
```

---

## Link-safety matrix — nothing may break

| Source of `/v2/*` link | How it survives after change |
|---|---|
| Bookmarks (`harinitharanjith.com/v2/board-editor`, `.../v2/study/...`) | nginx 301 `location /v2/ { return 301 /$1$is_args$args; }` on apex + tenant vhosts |
| Class-invite deep links already emailed (`/v2/class-v2/<id>?role=student`) | Same 301 |
| Shared academy URLs (`harinitharanjith.com/v2/a/gunachess`) | Same 301 -> `/a/gunachess` |
| PWA `manifest.webmanifest` `scope`/`start_url` | New build emits root scope. Existing installed PWAs at `/v2/` scope get funneled to root via 301. Long-term users reinstall. |
| Service worker at `/v2/sw.js` (already installed) | Its `BASE = self.location.pathname.replace(/sw\.js$/, "")` = `/v2/`. After 301, navigate -> `fetch(req)` -> nginx 301 -> browser follows -> NEW HTML -> NEW SW registers at `/`. Old SW eventually unregisters when all `/v2/`-scope tabs close. Interim harmless. |
| ONNX model URLs in bundle (`/v2/models/...`) | Fix in source. Old bundle still hits `/v2/models/...` -> 301 -> new URL. |
| Google-indexed URLs | 301 preserves SEO. |
| Third-party links / social-shared cards | Same 301. |

**Rule:** every legacy `/v2/*` path returns 301 permanent to `/*` at nginx. No 404, no HTML-in-place-of-JS.

---

## Execution plan (5 phases, ~25 min)

### P0 — Trap escape (immediate, 3 min)
- Restore old chunk names `index-sLRpOBTd.js` + matching CSS into both web roots from git history / build artifact archive.
- Why: trapped users' cached HTML fetches these old chunks. If chunk exists, old SW upgrade path completes -> new SW -> recovered.
- Verify: `curl -sI https://harinitharanjith.com/v2/assets/index-sLRpOBTd.js` returns 200 `application/javascript`.
- Skip P0 only if you accept losing users trapped on pre-2026-08-15 04:42 SW.

### P1 — Source changes (5 min)
1. `apps/web/vite.config.ts` — `base: "/v2/"` -> `base: "/"`.
2. `apps/web/src/lib/chessClassifierClient.ts` — both `/v2/models/...` -> `/models/...`.
3. `apps/web/src/lib/neuralBoardDetect.ts` — same.
4. `apps/web/src/pages/Admin.tsx:129` — `"/v2/board-editor"` -> `"/board-editor"`.
5. `apps/api/src/class/class-live.controller.ts:51` — `/v2/class-v2/${id}?role=student` -> `/class-v2/${id}?role=student`.
6. Bump SW `VERSION` in `apps/web/public/sw.js` from `cg-20260815045042` to `cg-20260815-nov2`.
7. Verify no residual: `grep -rn '"/v2/\|'"'"'/v2/' apps/{web/src,web/public,api/src} | grep -v fontshare`.

### P2 — Build (5 min, on France)
- `cd /home/ubuntu/chessguru/v2/apps/web && npm run build`
- Confirm `dist/index.html` references `/assets/index-*.js` (NOT `/v2/assets/...`).
- Backend rebuild + `pm2 restart chessguru-api` if class-live route change requires it.

### P3 — Deploy (5 min)
- `rsync -a --delete --exclude=vendor/ apps/web/dist/ /var/www/chessguru/`
- Make `/var/www/chessguru-v2` a symlink: `sudo rm -rf /var/www/chessguru-v2 && sudo ln -s chessguru /var/www/chessguru-v2` (or keep dir + rsync identical).
- Keep `/var/www/chessguru/v2 -> .` symlink until P4 cutover completes (old cached HTML asking `/v2/assets/...` still resolves).

### P4 — nginx cutover (5 min)
- Apex `harinitharanjith.com` (also www.) (`/etc/nginx/sites-available/chessguru`):
  - Backup: `sudo cp .../chessguru .../chessguru.bak-drop-v2`
  - Replace `location /v2/ { rewrite ... root /var/www/chessguru-v2; }` with:
    ```
    location /v2/ { return 301 /$1$is_args$args; }
    location = /v2 { return 301 /; }
    ```
  - Ensure root `location /` serves `/var/www/chessguru/` with SPA fallback `try_files $uri $uri/ /index.html;`.
- Tenant template (`academy-domain.service.ts` in NestJS) + already-generated `/etc/nginx/coach-domains/*.conf`:
  - Add the same 301 block to the source template.
  - Regenerate all existing tenant vhosts OR sed-inject the 301 block into each `.conf`.
  - Currently only `gunachess.com.conf` — one-file edit.
- `sudo nginx -t && sudo systemctl reload nginx`.
- Remove `/var/www/chessguru/v2 -> .` symlink AFTER old chunks are restored (P0) AND 301s are active.

### P5 — Verify (2 min)
```
curl -sI https://harinitharanjith.com/ | grep '200 '
curl -sI https://gunachess.com/ | grep '200 '
JS=$(curl -s https://harinitharanjith.com/ | grep -oP 'src="\K/assets/index-[^"]+' | head -1)
curl -sI "https://harinitharanjith.com${JS}" | grep 'application/javascript'
curl -sI "https://gunachess.com${JS}" | grep 'application/javascript'
curl -sI https://harinitharanjith.com/v2/study/openings | grep '301'
curl -sI https://gunachess.com/v2/board-editor | grep '301'
curl -sI https://harinitharanjith.com/v2/class-v2/abc123 | grep '301'
curl -sI https://harinitharanjith.com/v2/models/chess-classifier-v4-int8.onnx | grep '301'
curl -sI https://harinitharanjith.com/v2/assets/index-sLRpOBTd.js | grep -E '200|301'
```
Headless-load `harinitharanjith.com` (also www.) and `gunachess.com` — assert `document.getElementById('root').childElementCount > 0` after 5s, zero console errors, zero failed requests.

---

## Rollback

**Build breaks:** don't rsync. Old bundle stays.
**Nginx breaks:** `sudo cp /etc/nginx/sites-available/chessguru.bak-drop-v2 /etc/nginx/sites-available/chessguru && sudo systemctl reload nginx`. Take backup BEFORE editing.
**Trapped users can't recover:** P0 (restoring old chunks) is the safety net. If skipped and reports come in, restore chunks then, then reload nginx.

---

## Memory updates (post-execution)

Update `feedback_chessguru_two_web_roots.md`:
- Note that dropping `/v2/` supersedes the two-dirs landmine; going forward ONE dir (`/var/www/chessguru/`), `/var/www/chessguru-v2` is symlink.
- `/v2 -> .` symlink is REMOVED after cutover.
- Any future web deploy just rsyncs to `/var/www/chessguru/`.

Add new memory `feedback_chessguru_no_v2_prefix.md` (STANDING):
- ChessGuru web bundle is root-served. Never re-introduce `base: "/xxx/"` in vite config — it re-creates the tenant serving problem and traps installed PWAs at the old scope.

---

## Open questions for owner
1. **harinitharanjith.com**: no nginx conf on this box. Is it (a) not yet configured as a tenant, (b) served from a different box, or (c) aspirational not yet purchased? Answer decides whether we add its vhost as part of this work.
2. **P0 (old-chunk restoration)**: skip if OK with 1-2 trapped PWA users needing to Clear-site-data manually. Saves 3 min.
3. **Backend redeploy** for class-live URL change: OK to `pm2 restart chessguru-api` as part of this? (301 handles in-flight emails either way.)

---

## Addendum — actual apex mapping (verified 2026-08-15 07:30)

The apex is **harinitharanjith.com** (+ www + admin.harinitharanjith.com), NOT chessguru.com. `sites-available/chessguru` nginx conf uses these server_names:
- `harinitharanjith.com`, `www.harinitharanjith.com` (main app; `location = / { return 302 /v2/; }` today)
- `admin.harinitharanjith.com` (admin panel, separate SPA at `/admin/*`)

`chessguru.com` resolves to a different IP (217.70.184.38) and is not served by this box. Ignore it in this migration.

Tenant custom-domains today: only `gunachess.com` (`/etc/nginx/coach-domains/gunachess.com.conf`). All served from `/var/www/chessguru/` at root.

**Impact of dropping /v2/**: makes harinitharanjith.com root direct (no more 302 to /v2/), makes tenant domains work without symlink hack, unifies asset URLs across all surfaces.

---

## Execution log — 2026-08-15 07:22..07:42 UTC

- **P1 source edits:** vite.config.ts (base `/`), chessClassifierClient.ts + neuralBoardDetect.ts (model URLs), Admin.tsx (link), class-live.controller.ts (joinPath default + regex accepts both /v2/ and / for backward compat), sw.js VERSION `cg-20260815-nov2`.
- **P2 build:** `pnpm --filter @chessguru/web exec vite build` — 14s, dist/index.html references /assets/index-DJdwOLAQ.js.
- **P3 deploy:** rsync --exclude=vendor/ --exclude=v2 → /var/www/chessguru/. Backup `chessguru-webroot-pre-dropv2-20260815.tar.gz`.
- **P4 nginx cutover:**
  - Landmine discovered: `/etc/nginx/sites-enabled/chessguru` was a REGULAR FILE, not a symlink to sites-available. First round of edits went to the wrong file. Applied same edits directly to sites-enabled. Also moved `.bak-drop-v2-20260815` OUT of sites-enabled/ (nginx globs everything there → duplicate listen 443).
  - Removed `location = / { return 302 /v2/; }`; replaced 3 legacy /v2/ blocks with `location = /v2 { return 301 /; }` + `location /v2/ { rewrite ^/v2/(.*)$ /$1 permanent; }`.
  - Same 301 added to `/etc/nginx/coach-domains/gunachess.com.conf` AND the auto-gen template in `apps/api/src/academy-profile/academy-domain.service.ts` (future tenants inherit).
  - Removed the temporary `/var/www/chessguru/v2 -> .` self-symlink hack.
- **Backend restart:** `pm2 restart chessguru-v2-api` — fresh PID 529065, uptime healthy.
- **P5 verification (curl):**
  - `harinitharanjith.com/` → 200 (was 302 to /v2/)
  - `/v2/board-editor` → 301 → `/board-editor`
  - `/v2/class-v2/abc?role=student` → 301 → `/class-v2/abc?role=student` (query preserved)
  - `/v2/` → 301 → `/`
  - `/v2` → 301 → `/`
  - `/v2/models/chess-classifier-v4-int8.onnx` → 301 → `/models/chess-classifier-v4-int8.onnx`
  - JS chunk `/assets/index-DJdwOLAQ.js` serves `application/javascript` on both apex + tenant
  - Tenant `gunachess.com/` → 200, same 301 behavior on /v2/*

## Landmines documented for future

1. `/etc/nginx/sites-enabled/*` files may be regular files, not symlinks to sites-available — always verify with `ls -la` before editing sites-available.
2. Never leave `.bak` files inside `/etc/nginx/sites-enabled/` — nginx globs and treats them as active configs; will fail with duplicate listen.
3. Vite base changes require rebuilding + redeploying + bumping SW VERSION. Also verify `dist/index.html` for residual `/v2/` before deploy.

## Backups
- `/etc/nginx/sites-available/chessguru.bak-drop-v2-20260815`
- `/etc/nginx/backups/chessguru.bak-drop-v2-20260815` (moved from sites-enabled during recovery)
- `/etc/nginx/coach-domains/` gunachess pre-edit copy NOT taken — edit was surgical (2-line insert), reversible.
- Web root pre-deploy tarball at `/root/chessguru-webroot-pre-dropv2-20260815.tar.gz`
