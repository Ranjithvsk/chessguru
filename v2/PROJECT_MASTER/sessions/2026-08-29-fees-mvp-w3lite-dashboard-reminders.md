# 2026-08-29 · Fees MVP — W3-lite: dashboard + WhatsApp reminders

## What
Rewrote `/fees` from the placeholder tile-grid to a real dashboard, and added
click-to-chat WhatsApp reminders wired to a per-day anti-spam log. No Meta
Cloud API dependency — reminders open the owner's own WhatsApp in a new tab
with a pre-filled message.

**Scope deliberately trimmed vs plan §W3:** no Razorpay yet (needs Guna's
merchant keys + webhook signature setup), no email templates yet (SMTP not
wired). Both come in W4 once Guna's used this + we have their PG account.

## Files
### Backend (apps/api/src/fees/)
- `fees.types.ts` — new: `ReminderLogDoc`, `ReminderChannel`, `ReminderTemplate`,
  `DashboardResponse`, `LogReminderInput`, `ReminderTextResponse`. Also renamed
  the collection const `reminders` value from `fees_reminder_log` → `fees_reminders`
  (aligns with the shorter naming used across the module).
- `fees.service.ts`:
  - `dashboard(session)` — 8 parallel aggregates: month-collected (via
    payment_allocations ⨝ payments matched on capturedAt≥monthStart),
    overdue count+balance, expected-next-7d, active-enrollment count,
    recent-10-payments enriched with guardian names + invoice numbers,
    top-5-defaulters grouped by guardianUserId enriched with student
    names, 30-day collection-by-day bucketed on IST calendar day, and
    the last-reminder timestamp.
  - `reminderTextForInvoice(session, invoiceId, channel)` — composes the
    exact WhatsApp text based on invoice status (FEE_DUE vs FEE_OVERDUE
    template), builds the `wa.me/91<digits>?text=…` deep link, returns
    guardian name/phone for the caller. Same helper the client uses so
    server-recorded template matches what the owner actually sent.
  - `logReminder(session, input)` — insert with unique index on
    (academyId, invoiceId, channel, sentOn) — sentOn is IST-day string,
    so a same-day double-click returns `alreadyToday: true` instead of
    creating a second row. Partial index so PAYMENT_ACK / non-invoice
    reminders don't collide.
  - Two helpers: `istDayStamp(d)` + `startOfIstMonth(now)` — anchor
    every date-bucket to IST since parents live in India and month
    boundaries matter for month-collected reporting.
- `fees.controller.ts` — new routes:
  - `GET /api/fees/dashboard`
  - `GET /api/fees/invoices/:id/reminder-text?channel=WHATSAPP|SMS|EMAIL`
  - `POST /api/fees/reminders`

### Frontend (apps/web/src/)
- `lib/fees-api.ts` — new types + `feesApi.dashboard()`, `.reminderText()`,
  `.logReminder()`.
- `pages/Fees.tsx` — rewritten. Big brand-tinted hero card with
  `font-display` ₹ headline + 30-day inline-SVG sparkline (no chart lib —
  ~20 lines, brand-gradient area fill), 2 stat cards (Overdue = gold,
  Expected next 7d = accent), Top 5 defaulters card with count-badge
  (red > 15d, gold > 5d, brand ≤ 5d) and 🔔 Remind button that opens
  `wa.me/…` in a new tab + fires `logReminder` in parallel, Recent
  payments feed with method emoji + guardian name + relative-time +
  📄 receipt-PDF link per row. Auto-refetches every 60s (React Query
  `refetchInterval`).
- `pages/FeesInvoices.tsx` — added `RemindOnWhatsApp` component in the
  invoice drawer next to Download PDF. Fetches the composed text lazily
  on click (`feesApi.reminderText`), opens `wa.me/…`, logs in parallel,
  handles "no phone on file" case with a red banner.

## Design decisions
- **IST-day anchor for anti-spam + month-collected.** Owner in Bengaluru,
  parents in India — using UTC breaks month-boundary intuition
  ("September collected" needs Sept 1 IST → Sept 30 IST). Every
  aggregate bucket uses the same `istDayStamp` helper so numbers match.
- **wa.me built client-side by default, server also has the helper.**
  Two reasons: (1) instant open with no waiting on server RTT when
  clicking from the dashboard's defaulter row (guardian phone is
  already in the payload), (2) the drawer button asks the server so
  the text matches the exact FEE_DUE vs FEE_OVERDUE template the
  server would log. Both paths POST `/reminders` to log the click.
- **Anti-spam via unique index, not app-layer check.** Owner
  double-clicking on a fussy laptop is common. Unique
  `(academyId, invoiceId, channel, sentOn)` in Mongo catches it at the
  DB layer; service returns `alreadyToday: true` on E11000 so the UI
  can be gentle about it. Partial index scoped to `invoiceId: exists`
  so guardian-level reminders (no invoice — see dashboard defaulter
  rows for the guardian roll-up) don't collide with their per-invoice
  siblings.
- **No chart lib for the sparkline.** ~20 lines of inline SVG with
  gradient stops + a path. Keeps the parent PWA weight budget from
  M3 realistic once we ship it.
- **Dashboard refetch interval 60s.** Realtime SSE (per world-class
  §12) waits for after PG integration — the polling covers the demo
  need without WS wiring.

## Verification
- `tsc --noEmit` on both apps: clean on all fees files. Only
  pre-existing StudyChapterEdit / analytics-purchases errors remain
  (unrelated).
- Static preview at `/tmp/fees-preview/dashboard.html` → `dashboard.png`.
  Composition: hero (₹84,300 headline, sparkline, active-enrolment
  count), 2 stat cards, defaulters (4 examples with different overdue
  severities), recent payments (3 rows across 3 methods).

## Deploy notes
Same 6-step playbook (PROJECT_MASTER/knowledge/17-v2-deploy-playbook.md).
Should be a fast turnaround — no new API deps, no new nginx routes,
no new pm2 processes. Merge → sync ubuntu clone (only tsconfig-adjacent
files, plus this new session note reference) → API build →
`vite build` for web → sudo rsync → pm2 restart.

## Open items for W4
- Razorpay PG integration (needs Guna's key + secret). Order-create +
  webhook signature verify + FIFO alloc into existing allocations pipe.
- Email reminder template + SMTP wire-up (dw-otp already runs a
  self-hosted mail server; reuse via `sendSelfHosted`).
- Reminder cron (nightly, cadence [-3, 0, +3, +7] from dueOn) with
  channel fallback (WhatsApp → email → SMS if opt-in flags exist).
- SSE stream for the "somebody just paid" toast on the dashboard.
