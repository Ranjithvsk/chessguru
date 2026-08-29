# 2026-08-29 · Fees MVP — W4e: per-tenant Settings UI (self-serve)

## What
Owners can now configure Razorpay keys + business identity + receipt prefix
themselves at `/fees/settings`. Ranjith no longer has to shell into the box
and edit `.env` to onboard a new academy. Also flipped the webhook URL to
be per-tenant so each academy uses their OWN webhook secret from their OWN
Razorpay account.

## Files
### Backend (apps/api/src/fees/)
- `fees.types.ts` — NEW `FeeSettingsDoc`, `FeeSettingsResponse`,
  `UpdateFeeSettingsInput`. Every field optional. Secrets never echoed in
  the response — only `*Set: boolean` flags.
- `fees.service.ts`:
  - NEW `settings()` collection accessor; `ensureIndices` adds unique
    index on `academyId`.
  - NEW `readSettings(academyId)` — best-effort lookup used by the
    portal + cron paths.
  - NEW `getSettings(session)` — admin read.
  - NEW `updateSettings(session, patch)` — validated upsert. Each field
    trimmed, uppercased where relevant (GSTIN, PAN, receipt prefix),
    length-capped, format-checked (GSTIN 15-char alphanumeric, PAN
    ABCDE1234F pattern, bank-last-4 = 4 digits, receipt prefix
    `[A-Z0-9]{2,12}`). `null` clears via `$unset`. `undefined` leaves
    untouched.
  - NEW `webhookUrlFor(academyId)` helper — server-computed URL for the
    Razorpay dashboard config, echoed in every settings response so the
    owner can copy-paste directly.
  - `receiptPrefixFor` — now checks `fees_settings.receiptPrefix` first,
    slug-derived fallback.
- `fees.pg.ts`:
  - `createOrder({..., creds?})` — creds now overridable per call. Env is
    only the fallback for single-tenant / dev.
  - `verifyWebhookSignature(rawBody, header, secret?)` — secret now
    passed in from the tenant lookup.
- `fees.portal.service.ts`:
  - NEW `credsForTenant(academyId)` — DB (`fees_settings`) first, env
    fallback. Returns null if nothing configured.
  - `portalView` — `razorpayAvailable` flag now per-tenant.
  - `createCheckoutOrder` — uses `credsForTenant` + passes to
    `rzpCreateOrder`.
  - `handleWebhook(rawBody, sig, academyIdFromUrl)` — verifies signature
    with the tenant's secret. Cross-checks `notes.academyId` against
    URL param; mismatch = ignore.
- `fees.portal.controller.ts`:
  - `POST /api/fees/webhook/razorpay/:academyId` — URL now carries the
    tenant identifier. Each tenant configures their OWN URL in their
    OWN Razorpay dashboard.
- `fees.controller.ts`:
  - NEW `GET /api/fees/settings` + `PATCH /api/fees/settings`.
- `apps/api/src/main.ts` — raw-body middleware path unchanged
  (`/api/fees/webhook/razorpay` matches everything nested under it,
  incl. `.../razorpay/:academyId`).

### Frontend (apps/web/src/)
- `lib/fees-api.ts` — `FeeSettingsResponse`, `UpdateFeeSettingsInput`
  types + `feesApi.{getSettings, updateSettings}`.
- `pages/FeesSettings.tsx` NEW — 3-section form:
  - **Payments** — Razorpay Key ID / Key Secret / Webhook Secret.
    Secrets rendered as password inputs; already-set state shows
    "Currently: •••••• (leave blank to keep, type new to replace)"
    with a small Clear button. Below the secrets, a copy-to-clipboard
    box shows the exact webhook URL to paste into the Razorpay
    dashboard.
  - **Business identity** — Legal name / GSTIN / PAN.
  - **Receipts** — Receipt prefix (2–12 uppercase) + bank account last 4.
  Sticky Save button at the bottom. Toast on success. Empty-field vs
  null-clear semantics explained inline. Full width < 3xl to feel
  more like a real settings page and less like a modal.
- `main.tsx` — mounted `/fees/settings` route.
- `pages/Fees.tsx` — added a small ⚙️ button in the dashboard header
  next to Programs / Invoices.

## Design decisions
- **Server never echoes secrets.** Owner sees `••••••` + "type new to
  replace" + explicit Clear button. No accidental copy-paste leak.
- **Empty string ≠ null.** For secrets, blank = "keep whatever server
  has." For non-secrets, blank = "clear this value." Documented inline
  next to secret fields.
- **Per-tenant webhook URL** — `.../webhook/razorpay/:academyId`. Each
  tenant configures their own dashboard with their own secret. Multi-
  tenant safe from day one — no shared-secret compromise vector.
- **Env fallback** — single-tenant deploys or dev boxes can still set
  RAZORPAY_* in .env; the DB-first lookup falls through cleanly.
- **Format checks server-side.** GSTIN, PAN, bank-last-4, receipt-prefix
  all regex-validated on the server so no bad values ever hit the DB.
- **Copy-to-clipboard for the webhook URL.** Removes an obvious typo
  vector; owner clicks Copy → pastes into Razorpay dashboard → done.
- **Plaintext secrets in Mongo for MVP.** Same trust boundary as .env
  (physical VM = both compromised). Envelope-encryption with per-tenant
  KMS is world-class §Security territory.

## Verification
- `tsc --noEmit` clean on both apps for all fees files.
- Post-deploy smoke:
  ```
  curl -sS -o /dev/null -w '%{http_code}\n' https://chessguru.cc/v2api/api/fees/settings
  # → 401 (auth) — route wired
  curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
    -H "X-Razorpay-Signature: bad" \
    https://chessguru.cc/v2api/api/fees/webhook/razorpay/guna
  # → 403 (either "No RZP secret configured for this academy" or "Bad signature")
  ```

## Owner runbook for enabling real payments
1. Go to Razorpay dashboard → Settings → API Keys → Generate Test Key
   (or Live once KYC completes). Copy the Key ID + Key Secret.
2. In Razorpay dashboard → Webhooks → Add. Paste the URL from
   `chessguru.cc/fees/settings` (shown after login). Subscribe to
   `payment.captured`. Copy the webhook secret.
3. Come back to `chessguru.cc/fees/settings`, paste all three values,
   Save.
4. Test-pay ₹1 through the parent portal. Confirm the payment lands +
   receipt email arrives.

## Open items (later)
- **Envelope encryption on secrets.** Per-tenant KMS wrap. World-class
  §Security.
- **Test-payment button on the Settings page** — one-click "try a test
  transaction now" that opens a mock invoice + walks the owner through
  the flow. Would eliminate the manual runbook step 4.
- **Auto-detect test vs live keys** — key starts `rzp_test_` → show a
  "Test mode" banner; `rzp_live_` → "Live mode."
- **Cadence config in settings** — currently hardcoded reminder cadence
  `[-3, 0, +3, +7]`. Move to `fees_settings.reminderCadence`.
- **Opt-out flags for email / WhatsApp / SMS** per-guardian.
