# Messages — Web Push notifications (Feature 1 of 6-part deferred list)

Owner picked option (c) — go through the deferred messaging features 1→6
sequentially over multiple sessions. Feature 1 = push notifications.

## What

Every 1:1 direct message now fires a Web Push notification to the
recipient. Reuses the VAPID + `web-push` infrastructure that was already
built for streak reminders + going-live class alerts.

- Push send from `MessagesController.send()` — fire-and-forget so a slow
  vendor never blocks the API response.
- Notification body carries the sender's display name + message preview.
- Tap → focuses an existing app tab and deep-links to
  `/messages/<senderId>`. If no tab is open, opens a new window at the
  same URL.
- Same-thread notifications collapse via `tag: msg:<threadId>` so a
  chatty conversation doesn't stack N banners.

## Why

Without push, the chat is dead the moment a user closes the tab or locks
their phone. The whole point of "message someone in your academy" is
that they see it. Poll-every-8s (which the app already does) works only
while the tab is open — no help when the recipient is offline / on
another app / on the lock screen.

## How

Four files, one commit (`6c29bc9`):

- **`apps/api/src/messages/messages.controller.ts`** — imported
  `PushService`, added it to the constructor, added a fire-and-forget
  block at the end of `send()` that resolves the sender's name and
  calls `push.sendToUser(toUserId, { title, body, url, tag })`. URL is
  `/messages/<senderId>` so the recipient lands directly in the
  conversation.

- **`apps/web/public/sw.js`** — retired the 2026-08-17 kill-switch and
  replaced it with a push-only SW. Deliberately keeps ZERO fetch handler
  and ZERO caches (the reasons the kill-switch existed in the first
  place). Handles `push` (renders the notification from the payload
  contract) and `notificationclick` (focuses an open tab + posts
  `cg:navigate`, else opens a new window).

- **`apps/web/src/main.tsx`** — listens for `{type:"cg:navigate", url}`
  messages from the SW. Translates them into
  `history.pushState + popstate` so BrowserRouter picks up the deep
  link without a full page reload.

- **`apps/web/src/pages/Messages.tsx`** — added `PushOptInBanner`
  component at the top. Shows only when: browser supports push, user
  hasn't already subscribed, permission isn't denied, and the user
  hasn't dismissed the banner in the last 14 days. One click enables
  push (delegates to the existing `lib/push.ts` helpers).

## Files touched

- `apps/api/src/messages/messages.controller.ts` (+29)
- `apps/web/public/sw.js` (rewritten, +99 −20)
- `apps/web/src/main.tsx` (+13)
- `apps/web/src/pages/Messages.tsx` (+67)

## What I did NOT touch (already existed for Play push)

- `apps/api/src/push/push.service.ts` — VAPID setup + `sendToUser()`
- `apps/api/src/push/push.controller.ts` — subscribe / unsubscribe / test
- `apps/api/src/app.module.ts` — `PushService` already in providers
- `apps/web/src/lib/push.ts` — browser-side enable/disable/status helpers
- `apps/web/src/pages/Dashboard.tsx` — global push toggle + test button

## Verification

- API rebuilt via `pnpm --filter @chessguru/api build`; dist has 3
  hits for `PushService`/`sendToUser`.
- `chessguru-v2-api` restarted clean at 06:08 UTC — Nest boot log shows
  no DI errors, "successfully started" line present.
- Web rebuilt + published to `/var/www/chessguru` via
  `scripts/deploy.sh`. SW version stamp `cg-20260902061930`.
- `curl https://chessguru.cc/sw.js` returns the new push-only SW body
  (PUSH-ONLY comment + notificationclick handler both grep-hits).
- Manual end-to-end on iPhone + Android pending: open Messages → tap
  "Enable notifications" → have a coach send a DM → confirm banner
  appears on the recipient's phone with the sender's name + text
  preview → tap it → confirm the app opens on the correct thread.

## Migration note (SW)

Browsers still holding the kill-switch SW will run its `activate` event
once (which unregisters). Their NEXT natural page load fetches the new
push-only SW and registers it fresh. Users who had a push subscription
against the OLD SW need to re-opt-in — the endpoint dies on unregister.
The `PushOptInBanner` will nudge them the next time they open Messages.

## Open items / next sessions

Per the (c)-plan sequence:
- **Feature 2**: Parent messaging (parent user type + access rules +
  invite/link flow)
- **Feature 3**: Group chats + broadcasts
- **Feature 4**: Read receipts + typing indicators
- **Feature 5**: Attachments (files + images; voice deferred)
- **Feature 6**: Dream Meet in-class chat pane
