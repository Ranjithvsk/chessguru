# Session 2026-05-30 — M2 realtime: server-truth clocks BUILT

**What:** Milestone **M2** of the realtime online-play plan — added authoritative clocks to the chess
`RoundGrain`. Verified 8/8: win-on-time, flag→insufficient-material draw, lag compensation (present and
absent), and periodic clock ticks. Machinery (directory/mailbox/lease/snapshot/routing) unchanged.

**Why:** Owner said "build" → continue from M1.

**Built:**
- **Clock model** (in `RoundGrain`): integer-ms time; running side = `clockRemaining[turn] -
  (now - turnStartedAt)`. `turnStartedAt` is **epoch-ms** so the clock survives rehydration onto
  another node (snapshot now carries timeControl/clockRemaining/clockStarted/turnStartedAt).
- **Move debit pipeline** (plan §4.2 order): clock-first → debit `elapsed - lagRefund` → if ≤0 flag
  the mover (move not applied) → else legality/apply → add Fischer increment → switch the running side.
- **Lag compensation**: capped refund `min(reportedLag, 1000ms, elapsed)`; client reports its RTT
  estimate on `move` (gateway clamps ≥0). Refund-only + capped, so it can't be abused for time.
- **Flagging**: proactive per-game `setTimeout(dueAt)` in the engine (cleared/re-armed on every state
  change; **re-armed on rehydrate**), plus reactive flag-on-late-move. `flag()` is a **draw when the
  opponent has only a lone king / K+single-minor** (insufficient mating material), else a win on time.
- **Periodic `clock` ticks**: engine broadcasts live clocks every 2s for running games; clocks also ride
  on `moved`, `game-state`, `game-end`.
- **`create` message**: configure time control (+ optional initial FEN, validated) before the game
  starts; lobby (M4) will issue the same internally.

**Verified (`bash v2/scripts/run-m2.sh`, 8/8):** moved carries both clocks; 1.2s bullet → black flags →
**1-0 / flag**, flagged clock 0; K+N vs lone-king, white flags → **1/2-1/2 / flag** (insufficient
material); 500ms claimed lag → white debit ≪ elapsed; 0 lag → black debit ≈ elapsed; white kept ~500ms
more than black for equal think; periodic clock tick received.

**Notes / trade-offs:** clock uses epoch-ms (portable across nodes) rather than per-process monotonic —
the documented cost is that time during a node-outage counts against the mover until pause-on-unavailable
lands (a later milestone); M2 tests don't combine the crash with a tight clock. Berserk deferred to
tournaments (M4+). Bug found & fixed was in the verifier (a `moved` matcher lacked a uci filter and
caught the opponent's broadcast), not the engine.

**Files:** `v2/packages/protocol/src/envelope.ts`; `v2/apps/game-engine/src/{grain,snapshot,mongo,main}.ts`;
`v2/apps/ws/src/router.ts`; `v2/scripts/{m2-verify.mjs,run-m2.sh}`; docs:
`plans/online-play-realtime-architecture.md` (§11 M2 BUILT), `INDEX.md`. All three packages typecheck clean.
Test `live_games` docs deleted; new apps still out of pm2.

**Open items:** owner sign-off on ADR-0008 + §10 infra/budget before deploy. **Next: M3** — game flow
(resign already in; add draw-offer/accept, rematch, takeback-casual), **reconnection grace +
pause-on-unavailable**, and **Glicko-2 rating on game end** (reuse `v2/apps/api/src/glicko`).
