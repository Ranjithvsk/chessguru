# 2026-09-18 — "Turn on class alerts" prompt for students

**Why.** Coach Raagul opened an ad-hoc Dream Meet room at 20:02 IST, invited one student
(audience "individuals" → Neehal Prashant), got "Invited 1 • notified 0", and ended the class at
20:03. The invite is delivered as Web Push, and `pushSubscriptions` was EMPTY for the whole
system: `LiveClassBanner` asked for notification *permission* on page load (no user gesture, so
Chrome shows it quietly or not at all, and permission alone subscribes nothing) and the only
subscribe control was the Dashboard toggle nobody had found. So "Start & notify" could never reach
a student whose app was closed. Owner: "do 2" (one-time prompt at login).

**What.**
- `apps/web/src/components/ClassAlertsPrompt.tsx` (new): students only; once per device
  (`localStorage cg_class_alerts_prompt_v1` = on | later | ios-seen); hidden when push is
  unsupported, blocked, already on, inside `/class*`, or on login/signup. "Turn on class alerts"
  runs `lib/push.enable()` from the tap (permission → PushManager.subscribe → POST
  /api/me/push/subscribe), capped at 20 s so a missing service worker can't spin forever; success
  shows a 5 s confirmation, "Not now" answers it for good on that device. iPhone Safari tab gets
  the two-step "Add to Home Screen" explanation (web push there only works installed; the
  installed app has its own storage so the real prompt appears fresh).
- `App.tsx`: mounted above `LiveClassBanner`.
- `LiveClassBanner.tsx`: removed the page-load `Notification.requestPermission()`.

**Verification.** tsc: 0 errors in the touched files (91 pre-existing elsewhere). Deployed with
`v2/scripts/deploy.sh` → `/var/www/chessguru`, bundle `index-BFi70b8W.js` carries the prompt,
sw VERSION cg-20260918160650. Live flow needs a real device; the Dashboard "Send test" button
confirms a subscription end to end.

**Open.** Coach-side: when "notified 0", offer a WhatsApp share of the join link; parents on
WhatsApp as an invite channel; Raagul's 5 students sit in no batch (all 5 Guna batches are
`gunachess`'s) — "my students" is the pick that reaches them.
