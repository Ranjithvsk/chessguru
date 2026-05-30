# Session 2026-05-30 — v2 web client wired to the realtime engine

**What:** Connected the v2 React web app to the realtime engine built in M0–M5. New `/play` page: quick
pairing, a live chessground board you actually move on, clocks, move list, resign, and game-end.
Verified end-to-end **in a real browser** (Playwright) against the running cluster.

**Why:** After Phase 1 (M0–M5) the engine was a backend with no UI. This makes it playable.

**Built (apps/web):**
- `src/lib/live.ts` — `LiveClient`: thin browser WS client for the gateway; protocol **types only**
  from `@chessguru/protocol` (erased at build, no runtime coupling), JSON wire format.
- `src/hooks/usePlay.ts` — all game state from one client: connect→hello→seek→matched→sub→play;
  handles `game-state/moved/clock/game-end`; chess.js mirror for chessground `dests`; auto-queen
  promotion; exposes `window.__play` in DEV for scripted testing.
- `src/pages/Play.tsx` — board (orientation = your colour, movable only on your turn), opponent/your
  clocks (mm:ss), status, move list (SAN), quick-pairing buttons (1+0 / 3+2 / 5+3 / 10+0), resign.
- Wiring: `/play` route + Navbar "Play" link; `@chessguru/protocol` added to web tsconfig paths + deps;
  `WS_URL` from `VITE_WS_URL` (default `ws://localhost:18080/ws`).
- `scripts/spar-bot.mjs` — dev sparring bot (seeks + plays a fixed Ruy Lopez line) for driving the UI.

**Verified:** `pnpm typecheck` + `pnpm build` (vite, 121 modules) clean. Browser e2e (Playwright) against
2 engines + lobby + gateway + `vite dev`:
- page connects (WS), board renders, `window.__play` exposed;
- click **Blitz 5+3** → seeking; spar-bot matches → browser is **white**, status "Your move";
- drive `e2e4` (send path) → bot auto-replies `e7e5` (receive path) → board + move list render `1. e4 e5`;
- drive `g1f3` → bot `b8c6` → `1. e4 e5 2. Nf3 Nc6`, 4 moves, **live clocks** (opp 5:06 / you 4:29,
  increment + think-time reflected);
- **resign** → status "You lost — 0-1 (resign)".
Only console error is `favicon.ico` 404 (benign); the StrictMode WS double-mount warning is dev-only.
Screenshot captured during the run (`.playwright-mcp/cg-play-e2e.png`).

**Notes / dev-only bits:** `window.__play` is gated on `import.meta.env.DEV`. The page connects directly
to the gateway WS; **production should proxy `/ws`** (and set `VITE_WS_URL`) — same-origin, behind TLS.
The dev verification needs the gateway running (`ws://…:18080`); `vite.config` still proxies `/api`,`/auth`
to the v1 backend on :3000, so auth/rating just no-op if it's down (Play doesn't need them).

**Files:** new `v2/apps/web/src/{lib/live.ts,hooks/usePlay.ts,pages/Play.tsx}`,
`v2/scripts/spar-bot.mjs`; modified `v2/apps/web/src/{main.tsx,components/Navbar.tsx}`,
`v2/apps/web/{tsconfig.json,package.json}`, `v2/.gitignore` (+*.tsbuildinfo), `v2/pnpm-lock.yaml`.

**Status:** the realtime engine is now **playable from the React UI**. Still not deployed (gated on
ADR-0008 + §10 infra/budget); nothing in pm2. Next options: promotion-piece chooser + draw/rematch
buttons in the UI; point the page at a proxied `/ws`; or start Phase 4 (analysis/tournaments).
