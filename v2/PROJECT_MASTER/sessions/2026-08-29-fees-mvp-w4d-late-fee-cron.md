# 2026-08-29 · Fees MVP — W4d: late-fee auto-cron

## What
Owner sets a late-fee amount + grace days on the plan. Once an hour the cron
finds SENT/PARTIAL/OVERDUE invoices past `dueOn + graceDays` where the fee
hasn't been applied yet and atomically:
- appends a `{kind: "LATE", name: "Late fee", amountPaise}` line to the
  existing invoice
- `$inc` totalPaise
- flips status → `OVERDUE`
- sets `lateFeeAppliedAt` so it fires exactly once per invoice

## Files
### Backend (apps/api/src/fees/)
- `fees.types.ts` — added `lateFeeAmountPaise?: number` to `FeePlanDoc`,
  `UpsertPlanInput`, `PlanResponse`. Added `lateFeeAppliedAt?: Date` to
  `InvoiceDoc`.
- `fees.service.ts` — `upsertPlan` validates + persists
  `lateFeeAmountPaise` (integer paise, 0 = disabled, cap = ₹1,00,000 per
  `MAX_AMOUNT_PAISE`). `shapePlan` includes it in the response.
- `fees.late-fee-cron.service.ts` NEW — `setInterval(60m)` starting 45s
  after boot. Reads every plan with `lateFeeAmountPaise > 0`, finds
  candidate invoices, applies atomically. `updateOne` filter uses
  `lateFeeAppliedAt: {$exists: false}` in BOTH query AND filter so
  concurrent ticks race safely (future multi-pod).
- `fees.module.ts` — registers `FeesLateFeeCron` as a provider.

### Frontend (apps/web/src/)
- `lib/fees-api.ts` — `PlanResponse` + `UpsertPlanInput` get the new field.
- `pages/FeesProgramDetail.tsx` — Plan panel gets a "Late fee amount (₹)"
  input next to "Late-fee grace (days)". Helper text switches from
  "Leave blank to disable auto late-fee" → "Auto-added after N days past
  due." Value is parsed from rupees → paise the same way head amounts
  are (parseRupeesInput-ish).

## Design decisions
- **Append line to existing invoice, don't create a new one.** One billing
  period stays one document — matches accountant mental model + keeps
  monthly reports clean. Downside: the original invoice PDF says one
  total; a later re-download shows a different total. Fine for MVP since
  the parent tap-Pay flow uses the LIVE balance not the frozen PDF.
- **Atomic `$push` + `$inc` + `$set` in ONE `updateOne`.** Never see an
  invoice where the line is appended but the total isn't updated.
- **`lateFeeAppliedAt: {$exists: false}` in both query AND filter.** Two
  ticks racing on the same invoice → only one wins. First-writer semantics
  via MongoDB's document-level lock.
- **Hourly cadence, not daily.** Idempotency makes cadence choice pretty
  arbitrary — every 60m keeps latency low (an invoice going overdue at
  10:15 gets the fee by ~11:15) without stress on the DB.
- **Reuse `MAX_AMOUNT_PAISE` cap.** A typo of "500000" (₹5,000) vs
  "50000000" (₹5,00,000) matters when we're auto-charging parents
  overnight — cap at ₹1,00,000 like every other head amount.
- **Status flip to OVERDUE at apply time.** Even if the row was still
  SENT (parent hadn't logged in yet), applying the fee is a strong signal
  the invoice is officially late. Keeps status truthful for reports.

## Verification
- `tsc --noEmit` clean on both apps for the fees files.
- Cron will log `[fees-late-fee] applied late fee to N invoice(s)` when it
  fires. Silent when no candidates.

## Open items (later slices)
- **UI signal on invoice list row** when late fee has been applied — a
  small "+ ₹X late fee" chip so the owner can see WHY the total went up.
  Currently visible via the line in the drawer only.
- **Late fee reversal** if the owner waives — right now waiving doesn't
  unwind the appended line. Correct behaviour for MVP (waive means "we
  forgive the whole invoice, don't collect"). If we wanted "remove just
  the late fee," that's a V2 admin action.
- **Percent late fee** — currently flat only. Percent-of-balance would
  need `lateFeeMode: "FLAT" | "PCT"` + `lateFeePct`. Deferred until a
  tenant asks.
