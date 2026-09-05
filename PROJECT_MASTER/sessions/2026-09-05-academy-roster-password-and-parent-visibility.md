# 2026-09-05 — Academy roster: password result + linked-parent visibility

## What the owner reported
1. "still can't see change password for students" (follow-on to TKT-127).
2. "for harinitharanjith parent details is added right? but when I click parent
   in academy student card, I can't see."
3. "students in first line in academy, when clicked 3 dots, the password is
   over flown, make it scrollable."
4. "when reassign coach is clicked in student roaster, it closes immidietly."
5. "parent name in white text, not clearly visible."

All five were real. None was a permissions problem.

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

### 📜 Menu ran off the top of the screen on first-row cards (round 2)
Dropping `overflow-hidden` was not enough. The menu is unconditionally
`absolute bottom-full` — it *always* opens upward. Cards in the **first row** of
the grid have almost no room above them, so the menu was positioned above the
viewport entirely: measured menu top **−150px**, 🔑 Password (its first item) at
**y = −141px**. Nothing was clipping it; it was simply off-screen.

### 🔀 Reassign coach "closes immediately" (round 2)
Same `MenuBtnWrap` root cause as the password bug, different symptom. The wrapper
`onClick` fires on the tap that opens the native `<select>`, which unmounts the
`<select>` before it can present its option list — so it looks like the control
closes the instant you touch it.

### 🎨 Parent name invisible in light mode (round 3)
`index.css:170` has
`html.light [class*="bg-purple-"] .text-white { color: #fff; }`. The
"Already linked" block sits on `bg-purple-500/15` — a ~5%-opacity tint that is
near-white on the light theme — and the parent name was `text-white`, so the rule
forced it to pure white on near-white. The test tenant renders in **light mode**,
which is how this surfaced. `text-purple-100` has a light mapping (`#7e22ce`) and
is safe on both themes; `text-emerald-100` (`#047857`) likewise for the
credentials box.

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

### Round 2 + 3 (commit `d720466`) — all in `AcademyDashboard.tsx`
- `StudentOverflowMenu` measures free space above/below the ⋯ button at open
  time and picks the side with more room (`bottom-full` vs `top-full`), then caps
  `maxHeight` to that space (clamped 180–360px) with
  `overflow-y-auto overscroll-contain`. So it can never run off either edge, and
  scrolls when it doesn't fit.
- `MenuBtnWrap` gained `keepOpen`, which suppresses the close-on-click wrapper.
  `AssignCoachDropdown` uses it and closes the menu itself via a new `onDone`
  callback once the reassignment lands.
- Parent name `text-white` → `text-purple-100`.

## Verification
- API + web built clean; no new `tsc` errors in the touched files.
- Simulated the new resolution against the live roster: 86 students,
  1 parent link, `harinitharanjith -> Ranjith / 9841937366`.
- New strings present in the served bundle (`AppRest-lpnUWben.js`, 200 on both
  chessguru.cc and gunachess.com); sw.js stamped `cg-20260905083605`.
- `/academy` boots with 0 console errors.
- Menu geometry measured in-browser on a seeded academy at 393×760:
  BEFORE (old geometry forced back on) menu top **−150px**, 🔑 Password at
  **y = −141px**; AFTER `dir: "down"`, 🔑 Password at **y = 179px**, menu bottom
  442 in a 760px viewport.
- Round 2/3 bundle `AppRest-CgXwVUDo.js` served with `overscroll-contain` (2×),
  `text-purple-100` (7×), `Already linked` (1×); sw.js `cg-20260905085055`.

## TKT-127 close-out (2026-09-05)
- Screenshots on `platform.support_ticket` seq 127, in order:
  `[0]` COMPLAINT RECEIVED (owner's original), `[1]` BEFORE FIX,
  `[2]` AFTER FIX — both ours, marker-annotated (red hatched off-screen zone +
  arrow on the BEFORE; green menu outline + red box + "change password here"
  arrow on the AFTER).
- `admin_notes` captions every index and carries both shas.
- Reply sent as child ticket **TKT-130**; parent set **RESOLVED**.
- ⚠️ TKT-127 has `tenant_id = NULL` and `contact = NULL`, so `notifyReply` and
  `notifyResolution` both bailed early — **no email went to Guna**. He'll see the
  reply in the in-app Help & feedback thread only. ChessGuru tickets need a
  `tenant_id` at creation if email notice is wanted.

## Open items
- Only 1 of Guna's 86 students has a parent linked — the roster's "no parent"
  filter is now the obvious way to work through the rest.
- Coaches still cannot reach `/students` (`StudentsManager.tsx` is gated to
  `academy_owner`). With the ⋯ menu no longer clipped and the password modal
  working, `/academy` is a working path for them — but if coaches should have
  the full-roster page too, that gate needs revisiting.
- Not visually confirmed end-to-end as a logged-in owner (no Guna credentials);
  verified at the data, bundle and boot level.
