# 2026-09-04 — Dream Meet: coach demoted to student, and a missing mic blocking the whole class

Three owner reports, two root causes.

1. "when i click academy dream meet, Could not join room cmtmip9b3fwhc.
   NotFoundError · Requested device not found · code=8"
2. "when coach starts a class in dream meet and closes the tab, he cant join again as coach"
3. "when coach joins by clicking banner in his account, he joins as a student"

(2) and (3) are the same bug. (1) is separate.

## Root causes

**A. Any media-device error killed the whole room — `apps/web/src/pages/ClassV2.tsx`**

`LiveKitRoom`'s `onError` funnelled *every* error into `setErrMsg`, and the render
does `if (errMsg) return <error screen/>` — which unmounts `LiveKitRoom` entirely.

`NotFoundError / code=8` is a `getUserMedia` DOMException: no camera or microphone
on the machine. The coach joins with `audio={role === "coach"}` (mic on by default
since 2026-09-03), so on a desktop with no mic the very first thing that happens is
a device error — and the coach was locked out of his own class over a missing mic.
The existing comment claimed this was "the same soft-fail path"; it was not.

Fix: classify by `e.name`. `NotFoundError`, `NotAllowedError`, `NotReadableError`,
`OverconstrainedError` and `AbortError` now set a dismissible `mediaWarn` pill and
the class stays connected — the ControlBar can retry the device later. Everything
else is still fatal.

**B. The live-class banners always joined as a student**

`class-ws` only promotes a socket to coach when the hello frame asks for it —
every promotion path (token match, fresh claim, and the async
creator/academy-elder DB re-auth) is gated on `intendedRole === "coach"`.
`intendedRole` comes straight from the URL `?role=`.

Both live banners hardcoded `?role=student`:
- `apps/web/src/components/LiveClassBanner.tsx` (join link + the OS notification click)
- `apps/web/src/pages/Dashboard.tsx` (`StudentLiveClassCard`)

So a coach who closed his tab and came back through the banner asked the server for
student, got student, and none of the 2026-08-27 / 2026-09-03 coach-recovery
hardening ever ran. The server side was fine; the client never claimed the role.

Fix: link with `role = mine ? "coach" : "student"`. `GET /api/class/schedule`
already returned `mine`; `GET /api/class/live-now` (which serves ad-hoc "Start now"
rooms) did not, so it now returns `mine: coachUserId === session.userId` to match.

## Files
- `v2/apps/web/src/pages/ClassV2.tsx`
- `v2/apps/web/src/components/LiveClassBanner.tsx`
- `v2/apps/web/src/pages/Dashboard.tsx`
- `v2/apps/api/src/class/class-live.controller.ts`

## Verification
- API `tsc --noEmit` clean.
- Web `tsc --noEmit` back to its 101-error baseline (no new errors).

## Open items
- Not yet exercised against a real coach account on a mic-less machine.
- `CoachPublic.tsx:752` still links `role=student` — correct there (public page,
  visitors are students), but worth revisiting if coaches ever use that surface.

## Follow-up — End class from the dashboard

Owner: "yes add the end class button in dashboard also, for coach".

`LiveClassBanner` returns `null` on `/dashboard`, so the End-class button it
renders (`{live.mine && <EndClassButton/>}`) was unreachable there — the
dashboard shows `StudentLiveClassCard` instead, which had no way to end a class.

- `EndClassButton` is now exported from `LiveClassBanner.tsx` and reused rather
  than duplicated; it also invalidates `student-live-now` so the dashboard card
  disappears immediately after ending.
- `StudentLiveClassCard` renders it behind the same `c.mine` gate. The card is a
  `<Link>`, so the button sits in a wrapper that `preventDefault()`s — otherwise
  confirming the dialog would navigate into the room being ended.

Permission is unchanged and still server-side: `POST /api/class/:id/end` requires
session role coach/academy_owner AND `doc.coachUserId === session.userId`. `mine`
only controls visibility.

Verification: web `tsc --noEmit` at its 101-error baseline, 7/7 vitest tests pass,
deployed bundle `AppRest-0xE0Q99L.js` contains `a.mine&&...EndClassButton`.
