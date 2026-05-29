# ChessGuru — App & Database

## What it is

A self-hosted, Lichess-style **chess puzzle trainer**. Plain HTML frontend (no bundler) +
Express API + MongoDB, with an independent **engine pipeline** that generates its own puzzles.

## The three subsystems

### 1. Puzzle trainer (the main app)
`server3.js` → `routes.js` → `models.js` + `glicko2.js`.
- Puzzle selection (`/api/puzzles/random`) ports Lichess's pipeline: an in-memory `_sessions`
  Map (1h TTL, keyed by userId) holds ~200 pre-sampled puzzle IDs at the user's rating band.
  Flushed on theme/difficulty change or rating drift >100. Quality tiers (`tierQ`: top → good →
  all) fall back when a band is sparse. Dedup against the `rounds` collection avoids replay.
  Redis is an opportunistic cache (`rGet`/`rSet`) — failures are swallowed.
- Rating: per-user Glicko-2 in `userperfs.puzzle.gl`, updated on every puzzle completion.

### 2. Auth
`auth.js` — own bcrypt + `express-session` system. Sessions persist in MongoDB
(`connect-mongo`, 30-day TTL). Rate-limited 10 attempts / 15 min.
**Uses the raw MongoDB driver, not Mongoose** — see [ADR-0002](../decisions/ADR-0002-auth-bypasses-mongoose.md).

### 3. Engine pipeline (`engine-battle/`)
A self-feeding puzzle factory, run by separate PM2 processes:
- `engine_runner.js` (PM2 `engine-runner`) — engine-vs-engine games → `enginegames`
- `engine_updater.js` (PM2 `engine-updater`) — keeps `engines.json` current
- `puzzle_extractor.js` — analyses finished games at depth 50 / 30s / 25M nodes, extracts
  tactical positions meeting Lichess-quality thresholds (WIN_CHANCE_DELTA=0.3,
  MIN_WIN_CHANCE_GAIN=0.5, UNIQUENESS_MARGIN=50cp) → `puzzles`
- `cook.js` — 70+ theme tagger, shared by the extractor

## Boot order (server3.js) — DO NOT reorder

`require("./routes")` is called **inside** the `mongoose.connect().then()` callback, *after*
`express-session` + `MongoStore` are mounted. Session middleware must exist before routes load,
or `req.session` is `undefined` in handlers. See [ADR-0001](../decisions/ADR-0001-server3-is-the-entrypoint.md).

## Live file map (root = `/home/ubuntu/chessguru`)

```
server3.js          ← ACTIVE entrypoint (:3000)
routes.js           ← all /api endpoints (~31KB) + status/extractor control + generated-queue
auth.js             ← raw-driver bcrypt/session auth
models.js           ← Mongoose schemas: User, UserPerfs, Round
glicko2.js          ← Lichess-exact Glicko-2 engine
models/Puzzle.js    ← Puzzle model (used by engine pipeline)
migration/fix_fen.js
scripts/update_status.sh   ← cron status snapshot → LIVE_STATUS.md
engine-battle/      ← engine_runner.js, engine_updater.js, puzzle_extractor.js, cook.js,
                      engines.json, pgn/, logs/, reports/
public/             ← index.html, blindfold.html, login.html, puzzle-status.html,
                      board_editor.html, engine_battle.html, opening.html, theme.html,
                      terminal.html, css/, js/, pieces/
PROJECT_MASTER.md   ← original flat session log (historical; this folder supersedes it for reading)
CLAUDE.md           ← authoritative engineering guide for Claude Code
archive/            ← dead/backup files moved out of the way (see plans/code-cleanup.md)
```

One-off maintenance scripts also live in the root (`build_pools*.js`, `gen_*.js`, `diag*.js`,
`test_*.js`, `dbcheck.js`, `theme_check.js`, etc.). They are **not** imported by the server —
migration/maintenance helpers only. See [plans/code-cleanup.md](../plans/code-cleanup.md).

## Frontend pages

Self-contained HTML, no build step. `index.html` (main puzzles), `blindfold.html` (blindfold
mode — separate perf `userperfs.blindfold`, default rating 800), `login.html`,
`puzzle-status.html` (served at `/status`), plus board editor / engine battle / opening / theme /
terminal tools.

## Database (`chessguru` on local MongoDB)

Live counts as of 2026-05-29:

| Collection | Count | Notes |
|---|---|---|
| `puzzles` | 5,882,680 | imported Lichess set + engine-extracted |
| `bfPools` | 13,443 | blindfold pools |
| `paths` | 4,299 | pre-computed puzzle paths |
| `piecePools` | 590 | ⚠️ note casing: a stray empty `piecepools` (0) also exists |
| `enginegames` | 245 | engine-vs-engine results |
| `rounds` | 165 | per-user puzzle attempt history |
| `enginetournaments` | 12 | |
| `sessions` | 5 | express-session store |
| `users` | 4 | registered accounts |
| `userperfs` | 4 | per-user Glicko-2 ratings |
| `themePools` / `enginePools` | 3 / 3 | |

See [database/schema.md](../database/schema.md) for field-level schemas.

## API surface (code-accurate, from routes.js + server3.js)

```
# Auth (server3.js)
POST /auth/register | POST /auth/signin | GET /auth/me | POST /auth/logout

# Pages (server3.js)
GET /login /blindfold /status /puzzle-status /board-editor /engine-battle /opening /terminal
GET /*splat              → index.html (catch-all)

# Puzzles & rating (/api, routes.js)
GET  /api/themes
GET  /api/me/rating
GET  /api/puzzles/daily | /api/puzzles/random | /api/puzzles/batch | /api/puzzles/:id
POST /api/puzzles/:id/complete         → Glicko-2 update + Round record + User counters
GET  /api/streak     | POST /api/streak/complete
GET  /api/dashboard/:days | GET /api/history | GET /api/health
GET  /api/puzzles/pc-options

# Status / extractor control (/api/status, routes.js)
GET  /api/status/puzzles | /api/status/games | /api/status/puzzles/list | /api/status/pools
GET  /api/status/extractor
POST /api/status/extractor/start | /api/status/extractor/stop
POST /api/status/puzzles/:id/quality
GET  /api/extractor/log

# Generated-puzzle review queue (/api/generated, routes.js)
GET  /api/generated/puzzles | /api/generated/stats
POST /api/generated/puzzles/:id/approve | /api/generated/puzzles/:id/reject
```
