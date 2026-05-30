# Session 2026-05-30 — Play UI: draw offers + rematch

**What:** Completed the in-game flow on the `/play` page — **draw offer/accept/decline** (with an
incoming-offer banner) and **rematch** (after game-end, auto-continues into the colour-swapped game).
All backed by the M3 engine. Verified end-to-end in a browser.

**Why:** Continue building the chess app — round out the 1v1 experience the engine already supports.

**Built (apps/web):**
- `lib/live.ts` — added `drawOffer/drawAccept/drawDecline`.
- `hooks/usePlay.ts` — handle `offer` (show incoming-draw when the opponent offers) and
  `rematch-ready` (compute my new colour from the userIds, reset board, sub, resume). New actions:
  `offerDraw/acceptDraw/declineDraw/rematch`. Extracted a `startGame()` used by both `matched` and
  `rematch-ready`. `window.__play` (DEV) gained `offerDraw/acceptDraw/rematch` for scripted testing.
- `pages/Play.tsx` — "Offer draw" button while playing; an amber **incoming-draw banner**
  (Accept / Decline); **Rematch** + **New game** buttons after a game ends; draw result text.
- `scripts/spar-bot.mjs` — now accepts draw offers, auto-requests a rematch on game-end, and handles
  `rematch-ready` (re-seats + plays its line in the new game).

**Verified (Playwright, vs spar-bot, on the live cluster):**
- play `e2e4`→`e7e5`, click **Offer draw** → bot accepts → status **"Draw (agreement)"**, rematch
  button appears;
- click **Rematch** (bot auto-requested on end) → `rematch-ready` → board resets, **colour swaps to
  black**, new game id `…~r…`, bot (now white) opens `1. e4`, status "Your move";
- play `e7e5` in the rematch → bot replies `Nf3` → `1. e4 e5 2. Nf3` — the rematch game is fully live.
`pnpm typecheck` + `pnpm build` (vite) clean.

**Resource note (per owner question):** all of this ran on the **VPS**, not a separate PC. The Vite
build is tiny (~325 kB bundle, ~4s, a few hundred MB peak) — nothing like DreamWorld's ~6 GB
`next build`, so it never threatened the box. The only heavy thing was the transient Playwright
Chromium (~900 MB), closed after. Stack torn down, ports free, ~2.8 GB available; nothing in pm2.

**Files:** `v2/apps/web/src/{lib/live.ts,hooks/usePlay.ts,pages/Play.tsx}`, `v2/scripts/spar-bot.mjs`,
this note. Test `live_games` docs deleted.

**Still open / next:** premove (chessground `premovable` → send `premove`, backend already supports it),
a promotion-piece chooser (currently auto-queens), challenge-a-friend link UI, and the production `/ws`
proxy. Deploy still gated on ADR-0008 + §10 infra/budget.
