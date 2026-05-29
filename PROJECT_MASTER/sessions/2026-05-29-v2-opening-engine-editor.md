# Session log: v2 — Opening, Engine Battle, Board Editor pages

**Date:** 2026-05-29

## What
Built the remaining player/tool pages (all reuse the shared `<Board>`; Opening + Editor share a
new `useFreePlay` hook).

- **Opening** (`/v2/opening`): free-play board + Lichess opening explorer (client-side
  `explorer.lichess.ovh`, Lichess/Masters toggle, win-rate bar, clickable move table). Explorer
  runs in the visitor's browser; "unavailable" only in the server-side test (401).
- **Engine Battle** (`/v2/engine-battle`): live WebSocket to `/ws-engine` (→ engine-runner :3002).
  Verified: connects, loads the real engine roster (Stockfish 18/17, Viridithas, Renegade, Carp,
  Stormphrax…), viewOnly board updates on moves, standings + log, Start/Stop tournament.
- **Board Editor** (`/v2/board-editor`): analysis board — free play, FEN load/copy, flip/undo/reset,
  presets, move list. Server-side engine analysis noted as pending (old `/api/engine/analyze` is 404).
- New: `hooks/useFreePlay.ts`, `lib/explorer.ts`; routes + nav updated (6 sections).

## Verified
- `tsc --noEmit` clean (exit 0); `vite build` ok. Published to /var/www/chessguru-v2.
- Browser: /v2/opening (board + explorer UI), /v2/engine-battle (WS Connected, real engines),
  /v2/board-editor (route 200). ✅

## Next (Phase 1)
- NestJS API (auth, puzzle selection, Glicko-2, me/rating, themes, complete) → repoint /v2 to it.
- Then login/auth UI + admin dashboards; final parity + cutover.
