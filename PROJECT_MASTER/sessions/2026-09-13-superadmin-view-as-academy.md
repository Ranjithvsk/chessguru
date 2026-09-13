# 2026-09-13 — Superadmin "view as academy"

Owner: "in chessguru.cc superadmin, after login, I need option to choose academy; if I select an academy it should be like logged in as that academy's coach/owner and see all details."

- API: `POST /api/admin/view-as {academyId}` (admin only, `admins.ts` list) → `AdminAcademiesService.viewAs` stores `session.viewAs = {origAcademyId, origRole, academyId, name, since}` and sets `session.academyId` + `session.role = "academy_owner"`. `POST /api/admin/view-as/stop` restores. `/auth/me` returns `viewingAs {academyId, name}` (type in `packages/types`).
- Web `Navbar.tsx`: `ViewAsAcademy` select (admins only, lists `/api/admin/academies?slim=1`) → POST, clear the query cache, go to `/academy`; `ViewAsBanner` fuchsia strip on every page with Exit (→ `/admin`).
- The admin's own userId stays on the session, so puzzles/ratings/messages remain the admin's; everything keyed by session.academyId/role (academy dashboard, students, batches, fees, attendance, billing, leaderboard) is the chosen academy's, at owner level.
- Also today: per-academy `customMonthlyPricePaise` (Guna Chess Academy = ₹1,000/mo; `POST /api/admin/academies/:id/billing/price`), Billing page is Razorpay-only (bank/UPI box removed on the owner's request), menu entry "💳 Subscription".
