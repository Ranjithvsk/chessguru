# ChessGuru — Links, Libraries & Resources

## Live URLs
- **Production site:** https://harinitharanjith.com (+ www) — main puzzle trainer (`index.html`)
- `/blindfold` — blindfold mode
- `/login` — sign in / register
- `/opening` — opening explorer (Lichess-data + client Stockfish)
- `/board-editor` — board editor + analysis
- `/status` & `/puzzle-status` — Puzzle Factory admin dashboard
- `/engine-battle` — engine tournament viewer
- `/terminal` — embeds the external web shell
- Deep links: `/?puzzle=<id>`, `/?fen=<fen>`, `/?puzzle_fen=<fen>`, `/board-editor?fen=<fen>`,
  `/login?back=<path>`, `/login?tab=register`
- External web shell: https://term.harinitharanjith.com (Cloudflare Access protected)

## Internal services / ports
- `:3000` — web/API (`server3.js`, PM2 `chessguru`)
- `:3002` — engine runner REST + WebSocket (`engine_runner.js`, PM2 `engine-runner`); nginx
  proxies `/ws-engine` + `/api/engine-runner`
- MongoDB `:27017` db `chessguru`; Redis `:6379` (best-effort cache)

## Client-side libraries
- **chess.js** — move legality/SAN. Versions in use are inconsistent: `/js/chess.min.js` (gameplay),
  cdnjs 0.12.0 (opening.html), cdnjs 0.10.3 (board_editor.html).
- **chessground** — Lichess's board UI (`/js/chessground.min.js`; source `/js/chessground.js`).
- **chessboard.js + jQuery** — used by opening.html and engine_battle.html (older board widget).
- **Stockfish WASM** — `/js/sf/stockfish-nnue-17.1-lite.js`, `…-lite-single.js`, `/js/sf/stockfish.js`
  (tier-selected in opening.html for in-browser analysis).
- **qrcodejs** (CDN) — blindfold QR.
- **Google Fonts** (CDN) — typography on all pages.

## Server-side libraries (package.json)
express 5, mongoose 9, connect-mongo 6, express-session, express-rate-limit, helmet, cors,
ioredis, bcrypt, chess.js 1.x, chessground 8 (server dep, unused at runtime), ws, dotenv.
(`passport` + `passport-lichess` are installed but **unused** — replaced by the own-auth system.)

## External services called
- **Lichess opening explorer:** `https://explorer.lichess.ovh/lichess` and `/masters`
  (opening.html live; `book_game_runner.js` for opening books — uses a committed token, rotate it).
- **lichess.org** links: `/training/<id>` (puzzle pages), `/<id>` (opening game cards).
- **fen2image.chessvision.ai** — third-party FEN→image thumbnails on the admin dashboards (your
  FENs are sent to a third party).
- **Maia weights:** `github.com/CSSLab/maia-chess` (downloaded by `engine_updater.js`).
- **Engine list source:** EngineProgramming `engine-list` README (scraped by `engine_updater.js`).

## Upstream source ports (this app mirrors Lichess `lila` / `lichess-puzzler`)
- Rating: `glicko2.js` ← lila Glicko-2 (constants frozen).
- Selection: `routes.js` `_sessions`/`tierQ`/`paths` ← `PuzzleSession.scala`, `PuzzleTier.scala`,
  `PuzzlePathApi.nextFor`, `PuzzleSelector.scala`.
- Feedback UI: `setFB(...)` ← `ui/puzzle/src/view/feedback.ts`, `after.ts`, `main.ts`, `side.ts`.
- Puzzle generation: `puzzle_extractor.js` ← `lichess-puzzler/generator.py`; `cook.js` ←
  `lichess-puzzler/tagger/cook.py`.
- More detail: [research/lichess-source-reads.md](../research/lichess-source-reads.md).

## On-disk layout (paths worth knowing)
- App: `/home/ubuntu/chessguru/` (user `ubuntu`; needs sudo from `dreamworld`)
- Engine binaries: `/home/ubuntu/engines/` (Stockfish at `~/engines/stockfish`)
- Maia weights: `/home/ubuntu/engines/weights/`
- Extractor log: `/tmp/puzzler.log`; extractor status: `~/chessguru/.extractor_status.json`
- nginx site: `/etc/nginx/sites-available/chessguru`; SSL: `/etc/letsencrypt/live/harinitharanjith.com/`
- Secrets: `/home/ubuntu/chessguru/.env` (`LICHESS_TOKEN`)
