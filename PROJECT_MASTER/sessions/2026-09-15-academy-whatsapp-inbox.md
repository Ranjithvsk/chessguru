# 2026-09-15 — Academy WhatsApp inbox

## What

An academy can now see, in its own screen, every WhatsApp message it has sent to a parent and
everything the parent replies — laid out like WhatsApp itself, with the parent's name and their
child's name rather than a bare phone number.

- `GET  /api/academy/whatsapp/threads`   — conversations, newest first, with the resolved contact
- `GET  /api/academy/whatsapp/messages`  — the messages behind them
- `POST /api/academy/whatsapp/send`      — send one service template to one of the academy's contacts
- `/academy/whatsapp` in the web app, linked from the Academy group in the nav

## Why

Messages leave from the single shared ChessGuru number, so the academy stamp cannot live on the
sending identity — it lives on the row. `sendTemplate` takes an `owner` ({academyId, byUserId})
and stamps every outbound row with it; an inbound reply threads to whichever academy last
messaged that number. Reads are scoped from `req.session.academyId`, never from the request body,
so a send can only ever be attributed to the academy that made it and a read can only ever
return that academy's own rows.

## Decisions

- **Academies may send UTILITY templates only.** MARKETING templates are ChessGuru's own outreach
  to prospective academies and are refused on this route.
- **`academy_notice_v1`** (UTILITY, APPROVED 2026-09-15) is the template an academy sends: parent
  name, academy name, and the academy's own words. Before it existed the only registered UTILITY
  template was `academy_trial_ready_v1`, which Meta REJECTED — so academies had nothing sendable.
- **`hello_world`** is registered deliberately as Meta's own connectivity test, so the path can be
  proved end to end without waiting on template review.
- **Numbers resolve on their last 10 digits.** `users.mobile` is hand-entered and appears as
  "9841937366", "+91 98419 37366" and "098419-37366" alike. That costs a scan of the academy's
  users who have a mobile rather than an indexed `$in`; academies hold hundreds of people, so it
  stays cheap. Revisit if an academy ever has thousands of contacts.
- **Template bodies are rendered server-side.** We store a template's NAME and merge values, not
  its text; `renderBody` rebuilds what the parent actually saw, so the inbox shows the message
  instead of «Template "academy_notice_v1" · Ranjith · Guna Chess Academy».
- **Webhook signature verification now fails CLOSED.** It previously returned `true` when
  `WA_APP_SECRET` was unset, which left a public unsigned-POST hole.

## Files

- `v2/apps/api/src/whatsapp/whatsapp.service.ts` — owner stamping, inbound threading,
  `contactsForAcademy`, `threadsForAcademy`, `messagesForAcademy`, `renderBody`, fail-closed signature
- `v2/apps/api/src/whatsapp/whatsapp.controller.ts` — `requireAcademy` guard + the three routes
- `v2/apps/api/src/whatsapp/wa-templates.ts` — `academy_notice_v1`, `hello_world`
- `v2/apps/web/src/pages/AcademyWhatsApp.tsx` — the inbox
- `v2/apps/web/src/AppRest.tsx`, `v2/apps/web/src/components/Navbar.tsx` — route + nav entry

## Verification

- Sent `hello_world` and then `academy_notice_v1` to +91 98419 37366 through the real guarded
  route as Guna Chess Academy; both returned a `wamid` and both arrived.
- Rows carry `academyId: guna-chess-academy`, `byUserId: ranjith_vsk`, `phoneNumberId`, `wabaId`.
- Thread resolves to `{name: "Ranjith", role: "parent", students: ["Harinitharanjith"]}`.
- **Isolation:** the same account viewing as `chess-guru` gets `threads: []`.
- Rendered in a browser at `https://chessguru.cc/academy/whatsapp`.

## Open items

- **`WA_APP_SECRET` is still empty.** The webhook therefore refuses every inbound POST by design,
  so delivery receipts never advance past `sent` and replies never arrive. Read it from the Meta
  app's Settings → Basic → Show and put it in the API .env on France.
- `academy_benefits_v1` / `_v2` are APPROVED at Meta but are NOT in `wa-templates.ts`, so the
  outreach flow cannot use them yet.
- The academy screen is read-only plus a send API — there is no compose box in the UI yet.
