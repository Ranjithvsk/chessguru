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
