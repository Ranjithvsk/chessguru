# 2026-09-17 — TKT-247: class access, coach role, and duplicate students

One ticket ("Hi", plus a screenshot) unwound into six separate defects.

## The ticket

Student `haritha` on `gunachess.com/class-v2/cmu5hfhxyl1db?role=student`:

    Could not join room
    GET /api/livekit/token?room=cmu5hfhxyl1db&role=student → 404

**Cause: she has TWO accounts.** The login handle is derived from the display name —
`"Haritha"` → `haritha`, `"Haritha R"` → `harithar`. Today's class invited the
**Junior** batch, which lists `harithar`. She signed in as `haritha`, and the
eligibility gate correctly refused an account that is not on the invite list.

Nothing to do with that day's code: the LiveKit change only exempted the class's own
coach and never touched student gating (verified after: haritha refused, harithar
allowed, shohit allowed, abhinav refused).

## Root cause of the duplicates: there was no edit

`quickAddStudent` derives `_id`/`username` from the display name. There was **no
rename endpoint at all**, so a coach correcting a name had only Add — which mints a
new login and abandons the old one, still sitting on batches and class audiences. The
existing uniqueness loop cannot see this: the two handles genuinely differ.

A scan found **11 near-duplicate pairs**; the Junior batch was built almost entirely
from the *newer* duplicates (`pranavs`, `janvi-3`, `trilakshas`, `shrrikannish-2`,
`harithar`), so any student using their older login is locked out of every Junior class.

**Fixed both halves:**
- `POST /api/academy/students/:id/rename` — display name only. `_id`/`username` never
  change: batches, class-invite snapshots, attendance, rounds, Glicko, games, study
  progress and the password hash all key on the handle, and Mongo cannot rename an
  `_id` in place anyway.
- Near-duplicate guard in `quickAddStudent`: compares NAMES (exact, or one a prefix of
  the other within 2 chars and ≥5 long, so "Ram"/"Ramya" don't collide), returns
  `{duplicate:true, existing}` and the coach must pass `force:true` for a real second
  person.

## Coach locked out of their own room

`/class-v2/<room>` with no `?role=` defaults to `student`; the LiveKit token then ran
the student-eligibility check against the coach, who is never on their own roster →
404 → "Could not join room", board never mounted, no class socket. Fixed: the room's
coach (and an academy owner) is never treated as a student for their own room.

## Coach shown "class is ended" on a second device

Coach promotion is sometimes ASYNC — opening a second device while the first still
holds `room.coach` does not resolve synchronously, so at gate time the socket is still
labelled "student" and the audience gate ejected it with `not-invited`. The client
renders EVERY `onClassEnded` reason under the heading "Class ended".

- class-ws: the audience gate now exempts the room's coach **by identity**
  (`classSchedules.createdByUserId`, falling back to the announcement's `coachUserId`).
- ClassV2: the panel is reason-aware — 🔒 "Can't join this class" vs 🏁 "Class ended".
- ClassV2: the role now comes from `GET /api/class/:id/my-role`, not from `?role=` in
  the URL, so a coach on any device/link is a coach. Verified: gunachess `{coach:true}`,
  students `false`.

## "Find the best move got stuck"

All three challenges ended at exactly start+duration — by timer, never by the coach.
Answers were sent only to `room.coach`, ONE socket; a coach on a second device joins as
an *extra* coach and `room.coach` still points at the first. So the board unfroze for
everyone (broadcast) while the coach who pressed End received nothing. New
`sendToCoaches()` reaches every coach socket.

## Merge was incomplete

`mergeStudent` rewrote `academyBatches` but NOT `classSchedules.batchStudentIds` — the
per-class audience SNAPSHOT — so a merge left the student locked out of exactly the
classes it was meant to fix. Now rewrites class audiences and attendance too.

Merged (old → new, keeping the login each student actually uses):
`pranav→pranavs`, `trilaksha→trilakshas`, `shrrikannish→shrrikannish-2`. Zero dangling
refs after. Trilaksha's Sunday Batch membership only existed on the old account and
would otherwise have been lost. Backup: `~/.cache/cg-backups/merge-backup-20260917.json`
(kept OUT of the repo — it contains password hashes).

## Light-mode contrast

Two elements were invisible for students: the notebook's active tab (`bg-brand-500/15`
is a 15% TINT, but `index.css` forces pure white on anything matching
`[class*="bg-brand-"]`, assuming a solid button) at 4.47:1, and the live-class banner
subtitle (`text-emerald-200/70`, a dark-surface colour) at **1.28:1** on white. Fixed in
the components, not the global rule — that rule backs ~670 call sites.

## Open

- `haritha`/`harithar`, `janvi`/`janvi-3`, `ragul`/`ragul-2` NOT merged — both sides of
  each have recent real activity, so the survivor is the owner's call.
- The rename endpoint has **no UI button**; the duplicate guard is what protects coaches today.
- Dormant duplicates to tidy: `dhritibhattacharya-2`, `lakshmikkanth`/`-2`, `balajis`/`-2`.
