# 2026-08-28 · Fees MVP — W2b: invoices + manual payments

## What
Third slice on `feat/fees-mvp-w1`. Owner can now generate invoices from a
plan+enrollments set, browse the full ledger, and mark cash / bank / UPI-QR
payments manually. Waive + cancel actions land in the same drawer.

**PDF generation deferred to W2c** — the invoice model + math + numbering
are all in place; W2c just adds a `GET /invoices/:id/pdf` endpoint plus a
puppeteer HTML template (bounded ~1 day of work).

## Files
### Backend
- `apps/api/src/fees/fees.types.ts` — added `InvoiceDoc`, `InvoiceLine`
  (frozen snapshot), `PaymentDoc`, `PaymentAllocationDoc`, `FeeCounterDoc`
  (atomic seq), `GenerateInvoicesInput`, `InvoiceResponse`, `PaymentResponse`,
  `RecordManualPaymentInput`, `WaiveInvoiceInput`, status enums, validation
  limits.
- `apps/api/src/fees/fees.service.ts` — added:
    - `fyStamp(d)` → India fiscal-year label ("2026-27").
    - `nextInvoiceSeq` / `nextReceiptSeq` → atomic per-academy counters
      via `findOneAndUpdate($inc)` with FY rollover reset.
    - `receiptPrefixFor(academyId)` → academy slug in caps, alnum only.
    - `periodsForPlan(plan, upTo)` → month-walker for MONTHLY (handles
      Feb / short-month day-cap), single row for ONE_OFF.
    - `computeInvoiceMath(lines, enr)` → paise-integer subtotal / discount
      (% + flat, mutually additive but capped at subtotal) / GST split /
      total.
    - `generateInvoices(session, {planId, upToDate?})` → idempotent via
      unique(academyId, enrollmentId, periodStart); returns
      `{created, skipped}`. Skips out-of-window enrollments per period.
    - `listInvoices(filters)` + `getInvoice(id)` with batched
      program/student/guardian name enrichment.
    - `recordManualPayment(input)` → CASH/BANK/UPI, FIFO across
      selected invoices, receipt-no generated, updates each invoice's
      `paidPaise` + `status` (PAID vs PARTIAL) atomically per row,
      returns any leftover for UI warning.
    - `waiveInvoice(id, {reason})` + `cancelInvoice(id)` (cancel refuses
      if payments exist — waive path required instead).
    - `ensureIndices` extended with unique(academyId, enrollmentId,
      periodStart) on invoices, unique(academyId, kind) on counters.
- `apps/api/src/fees/fees.controller.ts` — new routes:
    - `POST /api/fees/invoices/generate`
    - `GET /api/fees/invoices` (filters: status, planId, programId,
      guardianUserId, overdueOnly)
    - `GET /api/fees/invoices/:id`
    - `POST /api/fees/invoices/:id/waive`, `.../cancel`
    - `POST /api/fees/payments/manual`

### Frontend
- `apps/web/src/lib/fees-api.ts` — extended with typed InvoiceResponse,
  PaymentResponse, RecordManualPaymentInput and every W2b endpoint.
  Added `INVOICE_STATUS_META` (per-status ring + dot colour classes)
  reused across list + drawer + pill.
- `apps/web/src/pages/FeesInvoices.tsx` — table + tab bar (All / Open /
  Overdue / Paid / Waived / Cancelled) + 3 KPI stat chips + tap-a-row
  right-hand drawer with lines + totals + payments list + prominent
  gradient "Mark cash / bank payment" CTA + Waive / Cancel secondary
  buttons + RecordPaymentModal (method picker, ₹-prefixed input, quick
  "Full balance" link, captured-on date, optional note).
- `apps/web/src/pages/FeesProgramDetail.tsx` — added `GenerateInvoicesButton`
  next to Enrol students. Shows a toast on success/skip; on success navigates
  to `/fees/invoices?programId=…`.
- `apps/web/src/pages/Fees.tsx` — Invoices tile flipped from "coming soon"
  → "live".
- `apps/web/src/main.tsx` — `/fees/invoices` route.

## Design decisions worth remembering
- **Invoice lines are frozen at generation time.** `InvoiceLine` copies
  `name / amountPaise / kind / gstPct` from the head. Later renames of the
  head don't retroactively rewrite historical invoices — an accountant
  would revolt otherwise.
- **Invoice numbers are per-academy, per-FY, atomic.** Counter row in
  `fees_counters` with unique(academyId, kind), `findOneAndUpdate($inc)`
  under upsert, FY rollover triggers a `$set: {seq: 0, fyStamp: <new>}`
  via a separate pre-condition update. Format:
  `{ACADEMY-PREFIX}/{FY-STAMP}/{6-DIGIT-SEQ}`.
- **FIFO payment allocation** by `dueOn ASC` across selected invoices.
  Leftover surfaces in the response as `leftoverPaise` — UI can show a
  "₹200 unallocated" warning in a follow-up slice (deferred to Wallet UI
  in M3).
- **Skip-not-fail on unique-index race** during invoice generation. A
  parallel double-click generates only once, second insert catches
  E11000 and counts as skipped instead of failing the batch.
- **Manual method whitelist** enforced server-side: only CASH / BANK / UPI.
  CARD / WALLET / OFFSET are reserved for the gateway-driven flows landing
  in W4+.
- **CANCEL refuses when payments exist.** Owner must waive instead — the
  audit trail cost of "cancelling a paid invoice and then untangling the
  payment allocations" isn't worth the convenience.

## Verification
- `npx tsc --noEmit` clean on both apps for the fees files.
- Static preview at `/tmp/fees-preview/invoices.html` → `invoices.png`.

## Open items
- **W2c (small):** puppeteer PDF for invoice + receipt. Tenant-branded
  header pulled from existing AcademyBranding. Add
  `GET /api/fees/invoices/:id/pdf` + `GET /api/fees/payments/:id/receipt.pdf`.
  Add "Download PDF" button in the drawer.
- **W3:** notifications (WhatsApp click-to-chat first) — the invoice list
  already exposes `guardianPhone`; the reminder button just needs a
  `wa.me/91…?text=<encoded>` builder plus a `reminder_log` insert.
- **Superadmin-level rollups later.** Every invoice/payment write already
  carries academyId + userId for audit — no code change to enable
  cross-tenant reporting.

## Deployment
Still not deployed; branch continues to accumulate slices. Ready for one
merge + `pm2 restart chessguru` (or the v2 process, whichever runs the
NestJS API) when Guna's ready to preview.
