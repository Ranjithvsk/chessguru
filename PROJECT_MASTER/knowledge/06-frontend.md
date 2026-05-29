# ChessGuru — Frontend

All pages are **self-contained HTML** (inline CSS + inline JS), served from `public/`. No bundler.
Gameplay pages vendor `chess.js` (`/js/chess.min.js`) and `chessground` (`/js/chessground.min.js`)
client-side; pieces are SVGs in `/pieces/`. `js/chessground.js` is the un-minified upstream
chessground module (no project-specific logic).

---

## Gameplay pages

### index.html — main puzzle trainer
Core client flow:
1. On load, an IIFE calls `GET /auth/me` (sets `window._userId`, shows username) then
   `GET /api/me/rating` (seeds `myRating`/`myGlicko`).
2. `loadNextClean()` → `GET /api/puzzles/random?theme=&rating=&difficulty=`. (Deep links:
   `?puzzle=<id>` → `GET /api/puzzles/{id}`.)
3. `showPuzzle(p)`: parses `solution` (UCI array), loads `fen` into a fresh `chess.js`; if
   `lastMove`+`preFen` present it shows `preFen` then animates to `fen` after 1 s (the opponent's
   setup move).
4. `onMove(from,to)`: validates the move by **exact UCI string compare** against
   `solution[solIdx]` (with a `+"q"` auto-queen tolerance) — *not* a position compare, so only the
   mainline move is accepted. Correct → play it, `oppReply()` after 600 ms; complete → `submit(true)`.
   Wrong → snap back, `submit(false)`.
5. `submit(win,hint)` → `POST /api/puzzles/{id}/complete` body `{win, hint, difficulty, userId}`;
   updates the displayed rating from `glicko.r`.
6. `doHint()` highlights the from-square; `viewSolution()` auto-plays the rest.
7. Difficulty `<select>` (easiest…hardest), theme `<select>` populated from `GET /api/themes`.
   `setFB(...)` reproduces Lichess's `puzzle__feedback` states.

### blindfold.html — blindfold mode
- "Blindfold" = the board renders normally but **pieces are CSS-hidden** (`body.blindfold
  cg-board piece{opacity:0}`); squares/coords/last-move stay visible. A `peek` mode reveals them
  briefly.
- **Dual input**: drag the invisible pieces, *or* type SAN/UCI in `#moveInput` (`handleText`
  normalizes castling, tries SAN then a UCI regex, routes through `onMove`).
- A textual position panel lists each side's pieces (`Ng1`, `Ke1`, …); optional **voice**
  (`SpeechSynthesis`) reads the opponent's move aloud.
- Selects puzzles by **piece-count band** (`PC_BANDS=[4,5,6,7,8,10,12,16,20,32]`):
  `GET /api/puzzles/random?theme=&maxPc=&rating=` and `GET /api/puzzles/pc-options?theme=&rating=`
  to populate only available counts.
- Separate **blindfold rating perf** (default **800**): `submit` posts `{win, mode:"blindfold",
  rating, deviation, userId}`. QR code links `https://harinitharanjith.com/?puzzle=<id>` to open
  the same puzzle on a phone.

### login.html
Two tabs (`showTab`). `doSignin()` → `POST /auth/signin {username,password,keep}`;
`doRegister()` → `POST /auth/register {username,password,email}` (client validates
username/password first). `?tab=register` deep-link; redirects to `?back=` or `/` on success.

### theme.html — polished puzzle variant
Same engine + same APIs as index.html, redesigned UI (circular difficulty dial, daily-streak
bars). Notably it **fixes** index's bugs: wrong-move loss is deduped (`_submittedFalse`),
`viewSolution()` sets `solved=true`.

### opening.html — opening explorer (different stack)
Uses **chessboard.js + jQuery + chess.js 0.12.0** (NOT chessground), no puzzles/rating/auth. Free
play board; queries the **public Lichess explorer** (`https://explorer.lichess.ovh/lichess` and
`/masters`) for opening stats (with 429 backoff), and runs a **client-side Stockfish WASM**
(`/js/sf/stockfish-nnue-17.1-lite*.js`, with tier detection) for live eval/PV. Talks to **no local
API**.

---

## Admin / tools pages

> ⚠️ **None of these pages enforce server-trusted auth in the page code**, yet they can start/stop
> the extractor, spawn Stockfish, delete puzzles, and approve/reject. See
> [10-known-issues](10-known-issues-and-risks.md).

### puzzle-status.html — "Puzzle Factory" admin dashboard (served at `/status`)
The main ops console. Polls (auto-refresh 15 s; log 3 s) and renders: total/engine puzzle counts,
quality metrics, rating & theme distributions, recent engine games (+ per-game **Re-analyze**),
pool stats, a generated-puzzle quality browser with A–D grades + detail modal, extractor
**Start/Stop**, and a **live extraction board** reconstructed by *regex-scraping the log text*.
Endpoints: `GET /api/status/{puzzles,games,puzzles/list,pools,extractor}`, `GET /api/extractor/log`,
`GET /api/generated/{stats,puzzles}`, `POST /api/status/extractor/{start,stop,start-game}`,
`POST /api/status/puzzles/{id}/quality` (good = verify, **bad = delete**),
`POST /api/generated/puzzles/{id}/{approve,reject}`.

### extraction-live.html — public live-extraction view
A lighter, public sibling: extractor stats, a 6-step explainer, live log, and a **review queue with
approve/reject** (`GET /api/status/extractor`, `GET /api/extractor/log`,
`GET /api/generated/{stats,puzzles}`, `POST /api/generated/puzzles/{id}/{approve,reject}`). Polls
status/log every 3 s, review every 10 s. Board thumbnails come from the third-party
`fen2image.chessvision.ai`.

### engine_battle.html — tournament viewer/controller
Pure **WebSocket** client to `/ws-engine` (→ `:3002`). Engine checklist + think-time + max-games,
Start/Stop, live board, standings table, game log, and a per-side analysis panel (eval/depth/PV)
driven by `engine_info` messages. No REST, no auth.

### board_editor.html — board editor + analysis (served at `/board-editor`)
Lichess-style editor using **chess.js 0.10.3**. Play mode (legal moves, promotion prompt), edit
mode (piece palette, side-to-move, castling rights, FEN load/share, presets), and an engine panel.
Analysis goes through **`POST /api/engine/analyze` {fen, depth, multiPV}** (server-side Stockfish) —
the WebSocket/`:3002` code in this page is **dead**. "Train as Puzzle" opens `/?puzzle_fen=…`.
⚠️ Move navigation (`gotoMove`/`nextMove`) are non-functional stubs; client source leaks the
server-side engine binary paths.

### terminal.html — admin terminal (served at `/terminal`)
Just gates and embeds an external web shell `https://term.harinitharanjith.com` in an `<iframe>`.
The gate is a **client-side `GET /auth/me` check only** — bypassable by opening that host directly;
real protection must be Cloudflare Access on `term.harinitharanjith.com`. Permissive iframe
sandbox + clipboard access. **Security-sensitive** — see [10-known-issues](10-known-issues-and-risks.md).

---

## Every endpoint the frontend calls
See the consolidated [08-api-reference](08-api-reference.md). External services used by the
frontend: Lichess explorer API, `lichess.org` links, `fen2image.chessvision.ai`, Google Fonts,
qrcodejs/jQuery/chessboard.js CDNs, client Stockfish WASM. Catalogued in
[09-links-libraries-resources](09-links-libraries-resources.md).
