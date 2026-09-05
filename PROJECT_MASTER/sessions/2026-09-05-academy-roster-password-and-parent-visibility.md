# 2026-09-05 — Academy roster: password result + linked-parent visibility

## What the owner reported
1. "still can't see change password for students" (follow-on to TKT-127).
2. "for harinitharanjith parent details is added right? but when I click parent
   in academy student card, I can't see."

Both were real. Neither was a permissions problem.

## Root causes

### 🔑 Password — result was unmounted before it could render
`StudentOverflowMenu` wraps every item in `MenuBtnWrap`, whose `onClick` calls
`setOpen(false)`. That unmounts the whole menu — including `ResetPasswordButton`,
which held the returned `{username, password}` in **local** state. `prompt()` ran,
the POST succeeded, the server set the password, and then the component holding
the credentials was destroyed. Nothing ever appeared.

This is the identical bug that was fixed for the parent button on 2026-09-01
("when I clicked parent nothing happened") by hoisting state to module level.
`ResetPasswordButton` was missed in that pass.

### 👪 Parent — the modal is add-only and never showed existing links
`listStudents` projected `parentIds` but never resolved them, so the client only
had bare ids. `LinkParentModal` therefore always rendered a blank "Link parent"
form. `harinitharanjith` has `parentIds: ["ranjith"]` (Ranjith, 9841937366) — the
data was there the whole time, there was just no surface showing it.

### Secondary: card clipped its own menu
`StudentCard`'s root carried `overflow-hidden` while the ⋯ menu is
`absolute bottom-full` inside it, so a tall (owner, 7-item) menu could be clipped
at the top — where 🔑 Password happens to sit. Introduced by 9a15e52 (2026-08-30,
roster → card grid).

## Changes
- `apps/api/src/academy/academy.service.ts` — `listStudents` resolves `parentIds`
  into a `parents: [{_id, username, name, mobile, email}]` array (one extra
  indexed `find` for the whole roster).
- `apps/web/src/pages/AcademyDashboard.tsx`
  - `ResetPasswordButton` → module-level `openPasswordModal` host +
    `SetPasswordModal`; replaces `prompt()` with a real form and shows the
    resulting credentials with a Copy button. Survives the menu closing.
  - `LinkParentModal` shows an "Already linked (n)" block with name + tappable
    WhatsApp mobile + email, and flags parents with no contact on file.
  - `👪 Parent` button shows a count; the card chip shows the parent's name
    instead of only a negative "no parent" chip.
  - Dropped `overflow-hidden` from the card root.

## Verification
- API + web built clean; no new `tsc` errors in the touched files.
- Simulated the new resolution against the live roster: 86 students,
  1 parent link, `harinitharanjith -> Ranjith / 9841937366`.
- New strings present in the served bundle (`AppRest-lpnUWben.js`, 200 on both
  chessguru.cc and gunachess.com); sw.js stamped `cg-20260905083605`.
- `/academy` boots with 0 console errors.

## Open items
- Only 1 of Guna's 86 students has a parent linked — the roster's "no parent"
  filter is now the obvious way to work through the rest.
- Coaches still cannot reach `/students` (`StudentsManager.tsx` is gated to
  `academy_owner`). With the ⋯ menu no longer clipped and the password modal
  working, `/academy` is a working path for them — but if coaches should have
  the full-roster page too, that gate needs revisiting.
- Not visually confirmed end-to-end as a logged-in owner (no Guna credentials);
  verified at the data, bundle and boot level.
