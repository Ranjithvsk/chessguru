# 2026-06-01 — Chess engines on the box + Study (endgame trainer)

## Stockfish / engine inventory (findings)
- **Native UCI binaries:** `/home/ubuntu/engines/` — `stockfish` (~112 MB, SF17 full NNUE),
  `stockfish16` (~40 MB), plus ~20 other engines (berserk, clover, viridithas, igel, …) and
  `weights/` + `books/`. These are **server-side**, driven by the EngineBattle feature via the
  `/ws-engine` WebSocket + the `engine-runner` pm2 process (engine-vs-engine tournaments).
- **v1 app** (`/home/ubuntu/chessguru/public`, express :3000) HTML references
  `/js/sf/stockfish-nnue-17.1-lite-(single).js`, but **`public/js/sf/` is EMPTY** — those files
  are not actually present. Don't rely on them.
- **v2 web (the live React app)** had **no** browser engine until now.

## Decision: browser-side Stockfish for interactive trainers
For interactive single-move play (Study/practice), server engines are the wrong tool (built for
batch tournaments; per-move spawn = server load on a RAM-bound box). Use a **client-side**
engine instead — zero server load, runs on the user's device.

Chosen build: **Stockfish 16 NNUE, single-threaded** (latest powerful that needs **no**
COOP/COEP cross-origin-isolation headers — the multi-threaded builds require SharedArrayBuffer):
- `apps/web/public/stockfish-nnue-16-single.js` (25 KB loader)
- `apps/web/public/stockfish-nnue-16-single.wasm` (575 KB, NNUE embedded)
- Source: `cdn.jsdelivr.net/npm/stockfish@16.0.0/src/...`. (SF17.1 browser builds are blocked/huge
  on jsdelivr; SF16 NNUE is plenty — KQK and most endgames are trivial for it.)
- Loaded via a Web Worker in `apps/web/src/lib/engine.ts` (`createEngine()` → UCI `uci/isready`,
  then `bestMove(fen, movetimeMs)`). `.wasm` added to the SW `STATIC_RE` so it caches once (SW -> cg-v11).

## Study feature (v1: Queen Mate, K+Q vs K)
- Route `/study`, page `apps/web/src/pages/Study.tsx`, nav "Study".
- Random **legal** KQK start (you = White K+Q, white to move, not already mate/stalemate).
- **Stockfish plays the lone king** (defends at full strength). Player drives it to the edge and
  mates. Stalemate/draw = "try again". Move counter (KQK mates in ≤10).
- Reuses `Board.tsx` (chessground) + chess.js v1 (`isCheckmate/isStalemate/isDraw/isCheck`).
- Extensible: add more studies (KR vs K, KBB vs K, opposition, etc.) under the same hub later.
