# 2026-09-13 — ChessGuru platform billing (Razorpay) after the 30-day trial

Owner: "is there payment integration after trial?" → none existed (sign-up only stamped plan=trial/trialEndsAt; nothing enforced it). Owner sent the chessguru.cc Razorpay live key + secret and asked for "subscription option" and "webhook also".

## Pricing (owner)
≤50 students ₹1,000/mo · ≤100 ₹1,500/mo · +₹500/mo per extra 50 · coaches unlimited · >500 = quotation (WhatsApp +91 82483 53593). `monthlyPricePaise(students)` in `billing.service.ts` is the single source; the sign-up page mirrors it.

## Server — `apps/api/src/billing/`
- `BillingService` (providers in app.module; AcademyModule uses the plain `billingSummaryFor(conn, id)` helper — injecting the service there crashed boot with "Nest can't resolve dependencies", ~3 min API outage 05:50 IST).
- State machine `computeBilling`: trialing → active (paidUntil>now) → grace (7 days after the period ends) → locked. `manual` = academies set active by hand without dates (guna-chess-academy).
- `GET /api/academy/billing` (owner+coach) · `POST /order {months 1|3|6|12}` → Razorpay order (fees.pg `createOrder`, env keys) · `POST /confirm {orderId,paymentId,signature}` → HMAC handshake + GET /v1/payments/:id must be captured for that order → `extend()` (from max(now, paidUntil, trialEndsAt)) → receipt mail.
- Subscriptions: `POST /subscribe` → lazily creates a Razorpay plan per amount (`billingPlans`) + subscription (total_count 120, first month charged at auth) → Checkout with `subscription_id` → `POST /subscribe/confirm` (HMAC `paymentId|subscriptionId`, subscription must be authenticated/active) → `applySubscriptionCharge` (idempotent per payment id, +1 month). `POST /subscribe/cancel` = cancel_at_cycle_end. Records in `academySubscriptions`; academy gets `subscriptionId`, `autoRenew`.
- Webhook `POST /api/billing/webhook/razorpay` (raw body kept in main.ts like the fees webhook; `RAZORPAY_WEBHOOK_SECRET` env): subscription.charged → +1 month (dedup by payment id); subscription.cancelled/halted/paused/completed → autoRenew=false; payment.captured with notes.kind=platform-subscription → marks a one-time order paid if Checkout's confirm never arrived.
- Reminders: `tick()` every 6 h — 7 days / 1 day before, on expiry (grace), at lock; one per academy/kind/day (`billingReminders`); email only if the owner user has an email (none of the 3 owners do today → log line only).
- Enforcement: `assertNotLocked()` exists (402) but is NOT yet called from academy routes — today the lock is the dashboard wall + banner (owner) and the hero box. Wire it into owner-only mutations when the owner wants a hard lock.
- Superadmin: `GET /api/admin/academies/:id/billing`, `POST /api/admin/academies/:id/billing/mark-paid {months|paidUntil, amountPaise?, note?}` for bank/UPI.
- Env (Mumbai? no — France box, ubuntu clone `.env`, chmod 600): `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` (generated, `openssl rand -hex 24`). Never commit.
- Payments ledger: `academyPayments` {academyId, at, amountPaise, months, method razorpay|razorpay-subscription|manual, status created|paid|manual, razorpayOrderId/PaymentId, paidUntil, note}.

## Web
- `pages/AcademyBilling.tsx` at `/academy/billing`: state chip, students / price / paid-until / days-left, "Pay once" (months picker) and "Subscribe" (auto-renew, stop button) via checkout.js, payments table, bank/UPI WhatsApp box, quotation notice >500.
- `AcademyDashboard.tsx`: hero box shows Free trial / Subscription / Payment due / Paused and links to Billing; grace banner; paused wall (owner).

## Razorpay dashboard setup (owner)
Webhook URL `https://chessguru.cc/v2api/api/billing/webhook/razorpay`, secret = RAZORPAY_WEBHOOK_SECRET from the API .env, events: payment.captured, subscription.authenticated, subscription.activated, subscription.charged, subscription.cancelled, subscription.halted, subscription.paused, subscription.resumed, subscription.completed.

## Not verified end-to-end
No real payment was made. Order creation and the subscription flow run against the live account and need one real ₹ test (owner) — refund from the Razorpay dashboard afterwards.

## Yearly = 2 months free (owner, later 2026-09-13)
`amountForMonths(monthly, months)` in billing.service: 12 months are charged as 10 (`YEAR_MONTHS_CHARGED`). Status carries `yearlyPricePaise`; Billing page shows "1 year · 2 free" with the struck-through 12× price; sign-up cards and FAQ mention ₹10,000 / ₹15,000 per year. Monthly auto-renew is unchanged.

## Yearly auto-renew (owner)
`POST /subscribe {period: "monthly"|"yearly"}`: yearly plan = `amountForMonths(monthly, 12)` (10 months), Razorpay plan period "yearly", total_count 10; `academySubscriptions.monthsPerCharge` = 12 so every `subscription.charged` extends a year. Billing page: Monthly / Yearly toggle on the Subscribe card.
