# Session 2026-05-30 — M1 realtime: legal chess game + persistence BUILT

**What:** Milestone **M1** of the realtime online-play plan. Swapped M0's echo `EchoGrain` for a real
chess `RoundGrain`, added Mongo persistence of finished games, and verified 14/14: two humans play a
full untimed game to checkmate through the authority — including a **mid-game owner crash** — and the
finished game is persisted. The directory / mailbox / lease / snapshot / routing machinery from M0 is
unchanged, exactly as the plan intended.

**Why:** Owner said "go" → continue from M0. M1 makes the skeleton play actual chess.

**Rules-engine choice:** used **chess.js** (already in the monorepo store; gives threefold /
insufficient-material / 50-move detection for free, stable API) rather than chessops. Rules are
encapsulated inside `RoundGrain`, so adopting chessops for variants later (post-M5) is a local swap —
the same hedge philosophy as the D1 socket adapter. Noted against ADR-0008 open-decision #6.

**Built / changed:**
- `packages/protocol` — message types rewritten to chess: client `join`/`move`/`resign`/`sub`/
  `resync`; server `joined`/`game-state`/`moved`/`game-end`/`error`; `EngineInbound` kinds extended.
- `apps/game-engine` — `RoundGrain` (chess.js: legality, turn ownership, ply idempotency, mate/
  stalemate/insufficient/threefold/50-move/resign); `snapshot` GameState = replayable
  (initialFen+moves) so rehydration restores full history (repetition); `mongo.ts` upserts finished
  games to `chessguru.live_games`; `main.ts` dispatches sub/resync/join/move/resign, broadcasts
  `moved`/`game-end`, persists on end. Seating: first two distinct users get white/black, rest spectate.
- `apps/ws/router.ts` — handles join/move/resign/sub/resync; `track()` subscribes the gateway to
  `game:out:{g}` and seats the socket.
- Removed superseded M0 echo scripts (`scripts/m0-verify.mjs`, `run-m0.sh`); added `scripts/m1-verify.mjs`
  + `run-m1.sh`. Deps: game-engine += chess.js, mongodb; root += mongodb (verifier). All typecheck clean.

**Verified (`bash v2/scripts/run-m1.sh`, 14/14):** seating (white/black); single-writer placement +
`SET NX` loser; out-of-turn → `not-your-turn`; illegal → `illegal-move`; wrong ply → `stale-ply`;
moves broadcast to both; **SIGKILL owner mid-game → re-place on survivor → position rehydrated → game
continues**; Fool's mate → `game-end 0-1 / checkmate`; finished game persisted to Mongo with correct
result/status/moves/players; late spectator sees the full final state; gateway `/healthz`.

**Hygiene:** harness cleans up by port; deleted the test `live_games` doc from the real chessguru DB
after the run (no test pollution). New apps remain out of pm2 (not deployed).

**Files:** `v2/packages/protocol/src/envelope.ts`; `v2/apps/game-engine/src/{grain,snapshot,registry,
mongo,main}.ts`; `v2/apps/ws/src/router.ts`; `v2/scripts/{m1-verify.mjs,run-m1.sh}` (+removed m0
scripts); `v2/package.json`, `v2/apps/game-engine/package.json`, `v2/pnpm-lock.yaml`; docs:
`plans/online-play-realtime-architecture.md` (§11 M0+M1 BUILT), `plans/online-play-m0-walking-skeleton.md`,
`INDEX.md`.

**Open items:** owner sign-off on ADR-0008 + the §10 infra/budget call before deploying. **Next: M2 —
clocks** (server-truth integer-ms time, increment, flag + insufficient-material, lag comp, periodic
clock ticks), then M3 (resign/draw/rematch/reconnect + Glicko-2 rating on end).
