# Session 2026-05-30 — M3 realtime: game flow + Glicko rating + reconnect BUILT

**What:** Milestone **M3** of the realtime online-play plan. Added game-flow actions (draw
offer/accept/decline, rematch), **Glicko-2 rating on rated game end**, and verified client
reconnection. 11/11 acceptance. Machinery (directory/mailbox/lease/snapshot/routing) unchanged.

**Why:** Owner said "build" → continue from M2.

**Built:**
- **`packages/glicko`** (new shared package) — Lichess-exact Glicko-2 (`computeGame`, `liveDeviation`,
  constants) lifted from `apps/api/src/glicko` + a PvP `rateGame(white, black, whiteScore)` helper.
  apps/api keeps its own copy for now (dedupe later — noted in the package header).
- **Rating on end** — engine `endGame()` rates any rated game with two real users, persists per-user
  per-**speed** perfs to a new `live_perfs` collection (`speedOf(tc)` = bullet/blitz/rapid/classical),
  and includes `ratingDiff` in `game-end` + before/after in the persisted game doc.
- **Game flow in `RoundGrain`** — `drawOffer/drawAccept/drawDecline` (offer cleared on any move),
  `rematch` (both-request → `spawnRematch`: new game id, swapped seats, same TC, snapshot written so
  whichever node owns it hydrates, `rematch-ready` broadcast). `rated` flag carried through.
- **Protocol** — client `draw-offer/draw-accept/draw-decline/rematch`, `create.rated`; server `offer`,
  `rematch-ready`, `game-end.ratingDiff`, `game-state.rated`. Snapshot extended (rated/pendingDraw/
  rematchReq) so flow survives rehydration.
- **Reconnect** — already supported by the resync path; M3 verifies it end-to-end (same-user reconnect
  resumes the seat and continues moving).

**Verified (`bash v2/scripts/run-m3.sh`, 11/11):** rated mate → `ratingDiff` (white −, black +) +
both `live_perfs.blitz` persisted with nb≥1 and ratings moved off 1500; draw-offer seen by opponent →
draw-accept ends **1/2-1/2 / agreement**; white disconnects mid-game, reconnects as same user →
resumes white seat, resync shows 2 plies, continues with a move; resign → both rematch → `rematch-ready`
with **colours swapped** (bob white, alice black) → join the new game → it's live (move applied).

**Deferred (noted):** casual **takeback**, **abort** (pre-move-1 no-rating exit), and
**pause-on-unavailable** (clock currently keeps running during a node-outage — the documented M2
trade-off). These are small follow-ups, not blockers.

**Files:** `v2/packages/glicko/**` (new); `v2/apps/game-engine/src/{grain,snapshot,mongo,perfs,main}.ts`,
`v2/apps/game-engine/{package.json,tsconfig.json}`; `v2/apps/ws/src/router.ts`;
`v2/packages/protocol/src/envelope.ts`; `v2/scripts/{m3-verify.mjs,run-m3.sh}`; `v2/pnpm-lock.yaml`;
docs: `plans/online-play-realtime-architecture.md` (§11 M3 BUILT), `INDEX.md`. All packages typecheck
clean; test `live_games`/`live_perfs` docs deleted; new apps still out of pm2.

**Open items:** owner sign-off on ADR-0008 + §10 infra/budget before deploy. **M0–M3 of Phase 1 are
done** (two humans play a full rated, timed game with flow + reconnect). **Next: M4 — lobby/seek**
(`apps/lobby`: Redis seek pools + Lua-atomic pairing + challenge-a-friend), then M5 hardening.
