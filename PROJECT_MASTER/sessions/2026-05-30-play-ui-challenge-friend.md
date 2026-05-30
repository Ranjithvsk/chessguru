# Session 2026-05-30 — Play UI: challenge a friend (by link)

**What:** Added challenge-a-friend to /play (M4 backend already supported it). The creator clicks
"Challenge a friend", gets a shareable link, and the game starts when the friend opens it. Verified
end-to-end in a browser.

**Built (apps/web):**
- `lib/live.ts` — `challenge(clock,rated)` + `challengeAccept(id)`.
- `hooks/usePlay.ts` — `createChallenge()`; handle `challenge-created` (store id, status=seeking);
  **auto-accept** a `?challenge=<id>` URL param on connect (then strip it from the URL). `challengeId`
  exposed; cleared on match/newGame.
- `pages/Play.tsx` — "Challenge a friend (5+3)" button in the idle/ended panel; a link panel showing
  `…/v2/play?challenge=<id>` (read-only, select-on-focus) + Copy button + "waiting for your friend".
- `scripts/spar-bot.mjs` — `CHALLENGE=<id>` env to accept a challenge instead of seeking.

**Verified (browser, vite dev + cluster):** click "Challenge a friend" → `challenge-created` → link
panel with the shareable URL (`?challenge=a14bb732-6`). Bot accepts that id → both `matched`
(challenger = white) → browser "Your move" → play e2e4 → bot replies e7e5 → `1. e4 e5`. typecheck +
build clean. (The friend-opens-the-link path is the same `challengeAccept`, triggered by the URL param
in usePlay; exercised here via the bot's accept.)

**Files:** `v2/apps/web/src/{lib/live.ts,hooks/usePlay.ts,pages/Play.tsx}`, `v2/scripts/spar-bot.mjs`.
Stack torn down, ports free, test docs cleaned.

**Next:** browser e2e of a real second-tab opening the link; promotion-chooser e2e; production /ws proxy
+ deploy (gated on ADR-0008 + §infra/budget).
