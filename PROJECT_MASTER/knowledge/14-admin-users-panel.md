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
