# 2026-09-25 — TKT-269 "why student auto kicked" (room cmuguoqbfc54v)

**Evidence.** LiveKit closed `harinitharanjith` 13× between 11:05 and 11:11 UTC with
`DUPLICATE_IDENTITY` (a new connection with her identity replaced the old one); the coach
9× likewise. nginx: 28 loads of `/class-v2/cmuguoqbfc54v?role=student` from her phone
(157.51.135.152, Android) in six minutes, in bursts of up to 3/s; the coach reloaded 11×.
errorEvents: `Cannot read properties of undefined (reading 'default')` ×3 on her phone during
the burst (8 users total since 24 Sep). 11:16:50 `PEER_CONNECTION_DISCONNECTED` (her data
dropped); 11:17:04 `LiveKit disconnected · reason=1 · leaving=false` = LiveKitRoom unmounted
by the fatal card in her screenshot ("ConnectionError · Abort handler called · reason=3").

**Causes (all ours).**
1. `report-error.ts` called `e.preventDefault()` on `vite:preloadError` (24 Sep). Vite's
   preload helper then swallows the failure and `React.lazy` receives `undefined` →
   TypeError → blank page → user reloads → each reload kicks the previous LiveKit session.
2. `ClassV2` `onError` rendered `errMsg` for every `ConnectionError`; `Cancelled` (reason 3)
   is our own newer connect aborting the older one. The card unmounts LiveKitRoom and
   RoomKeepAlive with it.
3. `DUPLICATE_IDENTITY` was in DELIBERATE and rendered nothing — the replaced tab just went quiet.

**Fix (f2d0a4e).** `lib/lazy-retry.ts` (3 attempts, rejects empty modules) on all 17 lazy
routes; preloadError handler removed; `recoverStaleChunk` exported and used by
`ErrorBoundary`; `Unable to preload CSS` counts as stale. `ClassV2`: ConnectionError
Cancelled/LeaveRequest ignored, transient reasons → `netState=reconnecting`, only
NotAllowed/ServiceNotFound fatal; `replaced` state + card with "Use this tab".

**Verified (chessguru.cc, after deploy 11:36Z).** Chunk aborted once → page renders in
2.2 s, no crash. Two student tabs (isolated `zze2e` room in chess-guru academy, announcement
pre-seeded so no push): first tab shows the card 1.36 s after the second joins, no reload;
second tab unaffected; "Use this tab" swaps them back; no page errors. Not reproduced: a
genuine Cancelled error (the SDK coalesces concurrent `connect()` calls) — code path only.
Caveat: under Playwright interception a chunk that fails twice still fails after the
fallback reload (0-byte cached failure); likely an interception artefact, not seen with a
real network failure.

Cleanup: zz room docs, `zztest` sessions, test errorEvents, cookies removed.
