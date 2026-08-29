# 2026-08-29 · Fees MVP — W4b: Razorpay + parent portal

## What
Parents can now pay online. Magic-link portal at `chessguru.cc/pay/<token>?g=<guardianId>&a=<academyId>` → guardian sees invoices → taps Pay → Razorpay Checkout opens → on capture the webhook records the payment, FIFO-allocates across invoices, and emails a receipt PDF link. No parent signup / no password. Test-mode keys work today; flip to live keys when Guna gets her Razorpay merchant account.

## Files
### Backend (apps/api/src/fees/)
- `fees.pg.ts` NEW — thin Razorpay wrapper. No SDK — fetch + node:crypto.
  - `readRazorpayCredentials()` reads envs at call time (pm2 restart with rotated keys picks up without a rebuild).
  - `createOrder({amountPaise, receipt, notes})` — POST /v1/orders with Basic auth.
  - `verifyWebhookSignature(rawBody, header)` — sha256 HMAC over the exact bytes RZP signed, constant-time compare.
  - `verifyPaymentHandshake({orderId, paymentId, signature})` — client-side handshake verifier for optimistic UI (not strictly needed with the webhook, but nice-to-have).
  - `portalToken(academyId, guardianUserId)` — deterministic HMAC(PORTAL_TOKEN_SALT, "academyId:guardianUserId") sliced to 40 hex. Stable across restarts; rotating the salt invalidates every link.
  - `verifyPortalToken(token, academyId, guardianUserId)` + `portalUrl()`.
- `fees.portal.service.ts` NEW — public portal logic:
  - `portalView(token, a, g)` — verify → return guardian info + academy branding + invoice list (last 50, sorted by due) + `razorpayAvailable` flag.
  - `createCheckoutOrder(token, a, g, invoiceIds)` — verify → sum balances → RZP order with `notes: {academyId, guardianUserId, invoiceIds}` so the webhook can look up which invoices to settle.
  - `handleWebhook(rawBody, sig)` — verify sig → only act on `payment.captured` → idempotent insert (`pgPaymentId` unique) → FIFO allocate across invoices from notes → flip invoice status → fire-and-forget receipt email.
  - `recentPaymentsForGuardian(token, a, g)` — payment history for the portal.
  - `sendReceiptEmail()` — auto after every webhook capture, links to the receipt-PDF endpoint.
  - `buildReceiptNo(academyId)` — duplicated from FeesService intentionally so the portal service doesn't take an admin-side dep. Both hit the same `fees_counters` row via `$inc`, so numbering stays monotonic across manual + PG payments.
- `fees.portal.controller.ts` NEW — two controllers:
  - `FeesPortalController` at `/api/fees/portal/*` — public routes (no session).
  - `FeesWebhookController` at `/api/fees/webhook/*` — separate so the raw-body middleware only wraps this path; reads `req.rawBody` (populated by main.ts) for signature verification.
- `fees.module.ts` — registers both controllers + `FeesPortalService`.

### API bootstrap
- `apps/api/src/main.ts` — added `express.json({verify: (req,_,buf) => { req.rawBody = buf }})` scoped to `/api/fees/webhook/razorpay` **before** the global JSON parser. The verify hook fires before parse, so `req.body` (parsed JSON) and `req.rawBody` (exact bytes) are both available. Signature verification needs the raw bytes RZP signed, not `JSON.stringify(parsed)` roundtripped.

### Frontend (apps/web/src/)
- `lib/fees-api.ts` — new `PortalResponse`, `CheckoutOrderResponse` types + `portalApi.{view,checkout,payments}` helpers.
- `pages/parent/PayHome.tsx` NEW — mobile-first public page. Warm indigo greeting card, invoice cards (red overdue / amber due / grey paid line-through), sticky bottom bar with selected sum + gradient Pay button. Auto-selects unpaid invoices on load. Lazy-loads `checkout.razorpay.com/v1/checkout.js` only when the parent taps Pay (200 KB script skipped for history-check visits). On checkout success shows a Success card + refetches after 3.5s to let the webhook flip balances.
- `main.tsx` — mounted `pay/:token` route OUTSIDE the App-chrome layout (matches how CoachPublic / AcademyPublic are mounted). Renamed my import to `ParentPayPage` to avoid clash with the existing `ParentPortalPage` at `/parent`.

## Design decisions
- **No razorpay npm SDK.** Two REST calls + one HMAC verify — fetch + node:crypto do it. Fewer deps to bump / audit / worry about supply-chain on.
- **notes on the order carry the whole context.** `notes: {academyId, guardianUserId, invoiceIds}` — the webhook has everything it needs to allocate without a lookup table. `notes.invoiceIds` is comma-separated (RZP caps values at 256 chars — 20 ObjectIds fit fine).
- **Idempotent webhook via `pgPaymentId` unique index.** RZP retries on 5xx or timeout; our second insert throws E11000 → we return `{ok, note: "duplicate"}` and RZP stops.
- **Client success is optimistic; webhook is authoritative.** The Checkout modal's `handler` callback flips the UI to "Payment received" the moment the parent's browser gets the response. If the webhook is slow / the parent closes the tab / their connection drops mid-flight, the webhook still runs server-side and the receipt still lands. Refetch on the success page waits 3.5s so the webhook has a moment to record before the balances update.
- **Auto-emailed receipt on capture.** Fire-and-forget — if email fails we swallow (the parent already has the payment on their bank statement + the receipt PDF is downloadable from the portal history).
- **Portal magic-link, not signup.** HMAC(PORTAL_TOKEN_SALT, academy+guardian) → deterministic + stateless. Anyone with the URL can pay for those students; that's the whole point. Salt rotation would invalidate every issued link (deferred).
- **Same receipt-no counter as manual payments.** Both admin cash entry and PG webhook hit `fees_counters` `receipt` via `$inc`, so a full month's ledger is a single monotonic sequence regardless of channel.

## Configuration required in prod env
Set these three envs before parents can actually pay. Until then the portal renders the "Online payment isn't set up yet" nudge in the sticky bar:
```
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxxx        # or rzp_live_ once Guna KYCs
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
RAZORPAY_WEBHOOK_SECRET=<set-once-in-RZP-dashboard-Webhooks>
PORTAL_TOKEN_SALT=<any-32-byte-random-hex>     # portal link HMAC salt
CHESSGURU_PUBLIC_ORIGIN=https://chessguru.cc   # already set for W4a
```
The RZP dashboard webhook URL to configure:
`https://chessguru.cc/v2api/api/fees/webhook/razorpay`
Events to subscribe: `payment.captured` (must), `payment.failed` (optional — logged only).

## Verification
- `tsc --noEmit` clean on both apps for the fees files.
- Static portal preview at `/tmp/fees-preview/portal.html` → `portal.png`.
- Post-deploy smoke:
  ```
  # Public routes exist (returns 403 without valid token/params):
  curl -sS -o /dev/null -w '%{http_code}\n' https://chessguru.cc/v2api/api/fees/portal/deadbeef?g=x&a=y
  # 403 = wired · 404 = route missing
  # Webhook path preserves raw body:
  curl -sS -X POST https://chessguru.cc/v2api/api/fees/webhook/razorpay -H "X-Razorpay-Signature: bad" -d '{}'
  # 403 "Bad signature." = wired · 500 = middleware missing
  ```

## Open items (W4c)
- Owner action "📱 Send portal link" on defaulter rows — sends the URL over WhatsApp click-to-chat (uses existing template pipeline).
- Include the portal URL in the auto-reminder cron's email body (currently links to the admin invoice page, which parents can't access).
- Payment settlement view for the owner — Razorpay-side settlement report reconciliation.
- Portal link rotation UI (regenerate salt per guardian on request).
