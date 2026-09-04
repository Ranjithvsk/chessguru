# 2026-09-04 — Dream Meet visibility on /academy, nav cleanup, Guna trial badge

Three small owner asks in one pass.

## 1. "in academy Dream Meet, it is very small, make a module"

`AcademyDashboard.tsx` → `UpcomingClassesPanel`. Starting an unscheduled class
was an 11px pill (`px-2.5 py-1 text-[11px]`) with a 10px "Start now" label,
crammed into the "🎥 Coming up" header row next to the h2 — easy to miss on the
page's most-used action.

Now a full-width card below the heading: 56px emoji tile, "Start a class now"
title, "Dream Meet · video + shared board, nothing to schedule" subtitle, and a
solid "Start →" pill. Same `Link` target (`/class-v2/<adhocRoom>?role=coach`),
same stable per-mount ad-hoc room id — presentation only. The empty state
("No classes scheduled") renders the same card.

## 2. "in play, there is a dream meet, it is redundant right, remove it"

`Navbar.tsx` Play group listed both `/class` ("🎥 Live class") and
`/class-v2/demo` ("🚀 Dream Meet"). The second pointed at a hardcoded *demo*
room, not any real class, while `/class` is the actual hub. Removed the demo
entry. Play is now: Play · Engine battle · Live class.

## 3. "remove free trial notification in guna chess"

`AcademyHero` renders a "Free trial — N days left" badge whenever
`GET /api/academy/meta` returns `trialEndsAt`. Guna genuinely carried
`plan: "trial"`, `subscriptionStatus: "trialing"`, trial ending 2026-11-08.

Checked every reader first: `trialEndsAt` is written once at signup
(`auth.service.ts:234`) and read only for that badge (`academy.service.ts:181`).
Nothing gates access on it — no cron, no guard. So this is display-only state and
a data fix is safe.

    db.academies.updateOne({_id:"guna-chess-academy"},
      { $unset: { trialEndsAt:"", trialStartsAt:"" },
        $set:   { plan:"active", subscriptionStatus:"active" } })

Scoped to Guna; other academies still show their trial countdown.

**Undo** (original values):

    db.academies.updateOne({_id:"guna-chess-academy"}, { $set: {
      plan: "trial", subscriptionStatus: "trialing",
      trialStartsAt: ISODate("2026-08-10T14:22:21.624Z"),
      trialEndsAt:   ISODate("2026-11-08T14:22:21.624Z") } })

## Files
- `v2/apps/web/src/pages/AcademyDashboard.tsx`
- `v2/apps/web/src/components/Navbar.tsx`

## Verification
- Web `tsc --noEmit` at its 101-error baseline; 7/7 vitest tests pass.
- Deployed; `AppRest-DrUCUmxq.js` contains "Start a class now".
- Live drawer Play group now links only `/play`, `/engine-battle`, `/class`.
- `academies.findOne("guna-chess-academy")` → `plan: "active"`, no `trialEndsAt`.

## Open items
- The academy dashboard module was verified in the bundle + typecheck, not in a
  signed-in browser session.
