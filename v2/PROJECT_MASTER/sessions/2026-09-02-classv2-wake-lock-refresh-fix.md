# Dream Meet — iOS screen-off after refresh

Owner report (2026-09-02): students on iPhone report the screen going off
during class **after they refresh the page**. On the initial join it stays
on correctly — only refresh triggers the issue.

## What

Diagnosed the wake-lock hook (`apps/web/src/hooks/useScreenWakeLock.ts`)
and added a small "Tap to keep screen on" rescue overlay in ClassV2 that
appears when the screen-on machinery has silently failed.

## Why

iOS Safari requires a user-gesture-scoped **transient activation** for two
things the hook depends on:

1. `navigator.wakeLock.request("screen")` — throws `NotAllowedError`
   without transient activation.
2. Muted-video `<video>.play()` autoplay — silently rejects the returned
   promise without transient activation.

On the **initial** join, the student's tap on the "Join now" link IS a
user gesture; the next page's `useScreenWakeLock` mounts inside the
transient activation window, both API calls succeed, and the screen stays
on for the whole class.

On **refresh** (pull-to-refresh, browser reload, cmd-R), the new page load
has zero transient activation. Both the wake lock request and the
autoplay silently fail. The existing `onFirstGesture` listener on
`document` waits for the next touch, but a student watching + listening
to the coach often doesn't tap anything for minutes — long enough for
iOS's auto-lock timer (30s–2min per user setting) to fire.

## How

Two changes:

- **`hooks/useScreenWakeLock.ts`** — hook now returns
  `{ needsUserGesture: boolean }`. State machine:
  - On mount, if `performance.getEntriesByType("navigation")[0].type ===
    "reload"`, flip `needsUserGesture` to `true` immediately.
  - Otherwise wait 1.2 s and check whether the silent video is playing
    (`videoEl.readyState > 2 && !paused`) or the wake lock was granted;
    if neither, flip `needsUserGesture` to `true`.
  - On any subsequent `touchstart` / `pointerdown`, wait 150 ms then
    re-check both signals and clear `needsUserGesture` if either armed
    successfully. (The existing `onFirstGesture` singleton still handles
    starting the video; we just track whether it succeeded.)

- **`pages/ClassV2.tsx`** — destructures `needsUserGesture` from the
  hook and renders a fixed-position amber pill button at top-center of
  the class shell when `true`. The click on the button IS the required
  user gesture; the state clears itself once the video starts.

## Files

- `apps/web/src/hooks/useScreenWakeLock.ts` — expose state, add reload
  detection + arm-timer + touch-clear listener.
- `apps/web/src/pages/ClassV2.tsx` — destructure new state, render the
  rescue overlay conditionally.

## Verification

- Vite build succeeded (`pnpm --filter @chessguru/web exec vite build`).
- Deployed via `scripts/deploy.sh` to `/var/www/chessguru`.
- Shipped bundle at `chessguru.cc/assets/AppRest-BWBmoH28.js` contains
  the `needsUserGesture` symbol (grep-verified).
- Manual iPhone check pending: join → refresh → confirm amber pill
  appears → tap → confirm screen stays on for the rest of the class.

## Open items

- Voice/attachments, groups, parent messaging, push, read receipts, and
  in-meet chat pane are all queued as sequential work (option (c) chosen
  by owner). Next session starts with **push notifications** for the
  chat.
