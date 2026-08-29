# 2026-08-29 · Fees MVP — W4c: portal URL threaded into every reminder

## What
Every reminder — manual 🔔 button, dashboard defaulter row, auto-email
cron — now carries the parent-portal magic link. Parent taps the link →
lands on `/pay/<token>` → picks invoices → pays via Razorpay Checkout.
Three taps from WhatsApp to paid.

## Files
### Backend (apps/api/src/fees/)
- `fees.service.ts`:
  - `reminderTextForInvoice` — appended a `\nPay here: <portalUrl>`
    line to both FEE_DUE and FEE_OVERDUE templates. Server-composed,
    so the URL never leaves the API surface.
  - NEW `reminderTextForGuardian(guardianUserId, channel)` — sums open
    balances across all this guardian's invoices ("total outstanding
    is ₹1,742 across 2 invoices (oldest due 11 Sep)"). Same
    Pay-here line. Used by the dashboard's per-defaulter row.
  - NEW `safePortalUrl()` helper — best-effort call into
    `fees.pg.portalUrl()`, silently returns `""` if
    `PORTAL_TOKEN_SALT` is unset (dev / half-configured prod).
    Templates then omit the Pay line gracefully instead of crashing
    the whole reminder path.
- `fees.controller.ts` — NEW `GET /api/fees/guardian/:userId/reminder-text`
  route (auth'd, admin only). Symmetric with the invoice-level
  `/api/fees/invoices/:id/reminder-text`.
- `fees.reminder-cron.service.ts`:
  - Imports `portalUrl` from `fees.pg`.
  - NEW `payLinkFor(inv)` — prefers guardian portal URL, falls back to
    admin `/fees/invoices?id=…` if the salt env is missing.
  - HTML CTA button relabelled from "View invoice" to **"Pay now →"**
    (parents get the payment page, not an admin page they can't access).
  - Plain-text template "View / pay" → "Pay in 30 seconds:" for the
    same reason.

### Frontend (apps/web/src/)
- `lib/fees-api.ts` — NEW `feesApi.reminderTextGuardian(guardianUserId, channel)`.
- `pages/Fees.tsx` — `RemindLink` (dashboard defaulter rows) rewritten.
  Instead of hard-coding the WhatsApp text client-side, it now fetches
  the server-composed text on click via `reminderTextGuardian` → opens
  the returned `waLink` → logs in parallel. Benefits:
    - Server owns the portal URL (secret never travels).
    - Same text everyone sends every time — consistent tone.
    - Copy changes ship without a web deploy.
  Error surface: shows a tiny "No phone on file" or fetch error under
  the button if compose fails.

## Design decisions
- **Server composes ALL reminder text.** Client is a dumb button. Copy
  changes only need an API deploy. Also prevents mistakes like a
  client hard-coding stale text after the template changed.
- **`safePortalUrl()` degrades gracefully.** If `PORTAL_TOKEN_SALT`
  isn't set (dev boxes / accidentally-cleared env), the reminder text
  omits the Pay line but still sends. Better than blowing up the whole
  reminder flow because one env var was missing.
- **Guardian-level reminder != N invoice reminders.** A parent with
  Aarav + Rhea outstanding gets ONE message summing both, not two.
  Fewer WhatsApp pings, less annoyance, one Pay link covers both.
- **Same portal URL for cron email + WhatsApp button + manual invoice
  drawer.** One flow to test, one link parents recognise.

## Verification
- `tsc --noEmit` clean on both apps for the fees files.
- Post-deploy smoke:
  ```
  curl -sS -o /dev/null -w '%{http_code}\n' \
    https://chessguru.cc/v2api/api/fees/guardian/deadbeef/reminder-text
  # → 401 (auth guard) — route wired
  ```

## Open items (not this slice — noted for later)
- **Portal link rotation UI** — right now the token is deterministic
  from a fixed salt. Owner-triggered "invalidate + regenerate" is a
  V2 admin action (rotate a per-guardian salt column in `users`).
- **Send digest email** — one weekend "you have 12 unpaid parents"
  summary to the owner. Rides on the existing cron scaffolding.
- **Portal-link admin surface** — a "Copy pay link" button on each
  defaulter row for owners who want to paste the link into a personal
  WhatsApp DM instead of using the auto-composed reminder.
