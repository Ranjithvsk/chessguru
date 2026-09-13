# WhatsApp Business Platform — academy outreach setup (2026-09-13)

The integration is built and deployed. It stays OFF until the WABA credentials are in the API
`.env`. One-to-one WhatsApp (the wa.me button on each lead) works today with nothing configured.

## What only you can do (in Meta's dashboards)
1. **Meta Business account + verification** — business.facebook.com → Business Settings. Verify the
   business (needs company documents). Unverified accounts can message very few numbers.
2. **WhatsApp Business Account (WABA) + sender number** — Meta for Developers
   (developers.facebook.com) → create an App (type Business) → add the **WhatsApp** product. Add a
   phone number that is NOT on any normal WhatsApp/WhatsApp Business app. Note the **Phone Number ID**
   and the **WhatsApp Business Account ID**.
3. **Permanent token** — Business Settings → Users → System users → add a system user → generate a
   token with `whatsapp_business_messaging` + `whatsapp_business_management`. Copy it (shown once).
4. **App secret** — App → Settings → Basic → App secret.
5. **Verify token** — invent any random string (e.g. a UUID); you paste the same value in step 7.

## Intended sender number
The owner intends to use **+91 8248353593** as the WhatsApp sender. Note: this is NOT any of the
env values — Meta assigns a numeric **Phone Number ID** once the number is registered on the WABA,
and that ID goes in `WA_PHONE_NUMBER_ID`. The number must NOT already be active on a normal
WhatsApp or WhatsApp Business app (delete that account first, or use a fresh number), or Meta
refuses to register it for the Cloud API.

## What to put in the API .env, then restart
`WA_PHONE_NUMBER_ID`, `WA_BUSINESS_ACCOUNT_ID`, `WA_ACCESS_TOKEN`, `WA_APP_SECRET`, `WA_VERIFY_TOKEN`
(WA_GRAPH_VERSION defaults to v21.0). Then:
`sudo -u ubuntu bash -lc 'cd /home/ubuntu/chessguru/v2 && corepack pnpm --filter @chessguru/api exec nest build' && sudo -u ubuntu pm2 restart chessguru-v2-api`

## Webhook (so replies + delivery come back)
In the App → WhatsApp → Configuration → Webhook, set:
- Callback URL: `https://chessguru.cc/v2api/api/whatsapp/webhook`
- Verify token: the same `WA_VERIFY_TOKEN`
- Subscribe to the `messages` field.
The GET handshake is served automatically; POSTs are signature-checked with the app secret.

## Templates
Three are defined in code (`apps/api/src/whatsapp/wa-templates.ts`): `academy_intro_v1` and
`academy_demo_followup_v1` (MARKETING) and `academy_trial_ready_v1` (UTILITY). Once the token is in,
open /admin/leads and click **Submit templates for approval** (or POST /api/admin/whatsapp/templates/sync).
Meta reviews each (minutes to a few hours); status shows on the page. Edit wording BEFORE submitting —
an approved template's text is frozen, so change the `_vN` suffix to revise.

## How sending works / is gated
- Marketing templates only send to a lead with **opt-in recorded** (hard gate in the send route).
- Sends and replies are logged to the `whatsappMessages` collection and to the lead's follow-up log.
- A reply opens a 24-hour window and a `STOP` reply auto-withdraws opt-in.

## Recommended way to actually reach out (owner brief)
1. **First touch = a phone call or a one-to-one WhatsApp from your own number.** It is allowed,
   personal, and converts better than a template blast. Use the call/WhatsApp buttons on each lead.
2. On that first contact, ask permission to send details on WhatsApp → tick **Opt in** (records
   consent + date).
3. Only then use `academy_intro_v1`/`academy_demo_followup_v1` for the opted-in ones, and
   `academy_trial_ready_v1` when you spin up their trial.
4. Keep volume low and steady at the start (new numbers have a daily send tier that grows with good
   quality); watch the quality rating in WhatsApp Manager. Never import-and-blast — that gets the
   number flagged and breaks the DPDP consent expectation.
