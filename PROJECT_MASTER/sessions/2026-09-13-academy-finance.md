# 2026-09-13 — Academy finance / accounting module

**What:** `/academy/finance` (nav: Academy → 📒 Accounts) + `GET/POST/PUT/DELETE /api/academy/finance/*`.
A per-academy cash ledger: income and expenses with categories (expense: rent, coach_salary,
utilities, materials, marketing, software, travel, maintenance, misc; income: fees_manual, camp,
tournament, merchandise, other). Coach-salary entries pick a coach from the academy roster.
Monthly P&L that ALSO counts fees collected online (sum of CAPTURED `fees_payments` in the month),
with income/expense breakdown-by-category bars and a profit/loss card. Owner-only, tenant-scoped
by session.academyId (same guard shape as fees/academy).

**Why:** owner brief — academies need accounting, expense manager, coach salary payment and rent
tracking inside their own academy alongside the existing fees collection.

**Files:** `apps/api/src/finance/finance.service.ts`, `finance.controller.ts`, `app.module.ts`;
`apps/web/src/pages/AcademyFinance.tsx`, `AppRest.tsx` (route), `components/Navbar.tsx` (Accounts),
`lib/api.ts` (helpers + a new `put()`). Mongo collection `academyLedger` (indexes academyId+date,
academyId+direction+category). Amounts in integer paise.

**Verification:** api + web tsc clean for the new files; nest build as ubuntu; pm2 restart of
chessguru-v2-api with 0 live classes; `/api/academy/finance/summary` = 403 anon (owner gate);
web deployed.

**Scope note:** cash ledger, not double-entry. Income auto-pull is fees-online only; other income
is entered by hand. Future: recurring-entry auto-post, coach payslip PDF, per-coach payout report.
