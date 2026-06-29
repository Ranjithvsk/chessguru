# 14 — Admin users panel (ChessGuru)

Owner ask 2026-06-29: an admin panel to see registered users + their activity.

- Served at **harinitharanjith.com/admin/users** (in-app route; subdomain admin.harinitharanjith.com
  deferred — it currently shares an nginx block with the DreamWorld admin).
- Admin allowlist: `apps/api/src/admin/admins.ts` — `ADMIN_USERS` (default `Ranjith_vsk`, env `CHESSGURU_ADMINS`).
  `/auth/me` now returns `admin: boolean`; the Navbar shows an "Admin" link only to admins.
- API (admin-gated, 403 otherwise): `GET /api/admin/users` (username, email, joined, puzzle + study
  ratings, solves, win%, last active) + `GET /api/admin/users/:username` (per-variant ratings + recent
  solves). In `admin.controller.ts` / `admin.service.ts`.
- Web: `pages/AdminUsers.tsx` (table + click-through detail), self-gated (Not-authorized for non-admins).
- NOTE: the existing factory-admin endpoints (`/api/status/*`, `/api/generated/*`) are still ungated —
  separate pre-existing security item; the NEW user endpoints ARE gated.

## 2026-06-29 — factory-admin endpoints secured
Closed the pre-existing gap: gated ALL factory/extractor routes to admin-only (was ungated / any-login):
`/api/status/overview|distribution`, `/api/generated/puzzles|stats`, `/api/admin/queue`, `/api/admin/extract`
(spawns a node extractor — was any-login), and approve/reject (was any-login). All now 403 unless the
session user is in ADMIN_USERS (engine.controller + admin.controller use isAdmin). Public endpoints
(/api/themes etc.) unchanged. Factory page (Admin.tsx) + its navbar link are now admin-only. Verified all
six endpoints return 403 unauthenticated; /api/themes still 200.

## 2026-06-29 — admin.harinitharanjith.com carved out (LIVE)
Dedicated subdomain for the ChessGuru admin (was sharing an nginx block with the DreamWorld admin).
- DNS: Cloudflare A `admin.harinitharanjith.com -> 213.32.21.226` (France, DNS-only/grey, matches apex).
- nginx (France `/etc/nginx/sites-enabled/{chessguru,dreamworldplants}`): removed admin.harinitharanjith.com
  from the DW shared block (kept admin.dreamworldplants.com/.in -> :3010 untouched); added a dedicated block
  in `chessguru` serving the same SPA (/var/www/chessguru) + /v2api -> :4000, with `location = / -> 302 /admin/users`.
  Reuses existing LE cert `admin.harinitharanjith.com` (valid to Aug 4 2026). Backups: *.bak-carve-* in sites-available.
- GOTCHA found: sites-enabled/dreamworldplants is a REAL FILE (not a symlink) -> edit the ENABLED copy, not
  sites-available, or nginx keeps the old server_name (caused a conflicting-server-name warning until fixed).
- It is a separate origin from harinitharanjith.com, so the admin logs in THERE (session cookie is per-host) -
  by design for a dedicated admin subdomain. Verified: / ->302 /admin/users, /admin/users 200 SPA, /login 200,
  /v2api/api/admin/users 403 unauth. Minor inert leftover: a dead `if ($host = admin.harinitharanjith.com)`
  certbot redirect remains in the DW block (harmless; server_name no longer matches it).

## 2026-06-29 — SSO cookie domain + admin-identity case fix
- SSO: session cookie now `domain=.harinitharanjith.com` (main.ts reads env COOKIE_DOMAIN; set in pm2 for
  chessguru-v2-api + pm2 save). One login shared across harinitharanjith.com + admin.harinitharanjith.com.
  Verified Set-Cookie carries Domain=.harinitharanjith.com. NOTE: cookie also reaches other *.harinitharanjith.com
  (shop/code/shell) — same owner, ignored there. Existing host-only sessions: re-login once if odd.
- BUG FIX (Not authorized / blank stats): session.userId is the user _id = username.toLowerCase()
  (register: _id: username.toLowerCase()). So (a) admins.ts now matches case-insensitively (Ranjith_vsk
  -> ranjith_vsk), and (b) admin.service listUsers/userDetail key perf+round lookups by _id, not the
  display-case username (was returning blank ratings/solves). Verified _id-keyed lookup yields real stats
  for all users; api-only fix (no web rebuild). Refresh the page; no re-login needed.
