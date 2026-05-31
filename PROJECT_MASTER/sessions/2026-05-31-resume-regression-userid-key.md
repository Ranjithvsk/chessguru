# Session 2026-05-31 — refresh-changes-puzzle regression (userId in queryKey)

**Symptom:** refresh loads a new puzzle again (the resume fix had worked before).

**Cause (regression exposed by the auth fix):** `usePuzzleGame` resumed the saved `cg_puzzle` via a
ONE-SHOT ref consumed in the first `queryFn` call. The puzzle react-query key includes `userId`. Now
that auth actually works (after the cookie/SW fixes), `auth.me` resolves *after* the first render →
`userId` flips `guest → <user>` → the query key changes → react-query refetches → the resume token was
already consumed by the first (guest) fetch, so the second fetch went **random** → new puzzle on refresh.
(Before the auth fix, userId stayed "guest", the key never changed, so resume worked — which is why it
looked already-fixed.)

**Fix:** read the saved id from `localStorage` **live in queryFn** (not a one-shot ref), so resume
survives the key change — both the guest-key and the user-key fetch resume the same puzzle. Solve/next/
theme still clear `cg_puzzle` so those correctly load a fresh puzzle. Built + redeployed.

**Verified (logged-in):** refresh keeps the same puzzle (0qkvq -> 0qkvq across two reloads).

**File:** `v2/apps/web/src/hooks/usePuzzleGame.ts`.
