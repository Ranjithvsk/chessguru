# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Commands

```bash
# Server (managed by PM2 — never run `node server3.js` directly in prod)
pm2 restart chessguru               # main API on :3000
pm2 logs chessguru --lines 50       # tail logs
pm2 list                            # 3 processes: chessguru, engine-runner, engine-updater

# Mongo
mongosh chessguru                   # local DB

# Status snapshot (cron, every 10 min → LIVE_STATUS.md)
~/chessguru/scripts/update_status.sh

# Puzzle generator (long-running, run detached)
nohup node engine-battle/puzzle_extractor.js >> /tmp/puzzler.log 2>&1 &
node engine-battle/puzzle_extractor.js --limit 10 --dry-run
```

There is **no test framework** and `npm test` is unconfigured. Verify changes by hitting endpoints directly (`curl localhost:3000/api/health`) or exercising the UI in a browser.

## Architecture

### Boot order matters (server3.js)
Routes are required **inside** the `mongoose.connect().then()` callback, *after* `express-session` + `MongoStore` are mounted. Session middleware must be in place before `routes.js` loads, or `req.session` is undefined in handlers. Don't move the `require("./routes")` call out of the connect callback.

Express v5 catch-all uses a **named wildcard**: `app.get("/*splat", ...)`. Bare `*` crashes path-to-regexp.

### Auth bypasses Mongoose (auth.js)
`auth.js` uses the raw MongoDB driver (`mongoose.connection.db.collection('users')`) instead of the `User` Mongoose model. This is deliberate: the `bpass` field is declared as `Buffer` in the schema, so Mongoose returns it as a BSON `Binary` object, which breaks `bcrypt.compare()` ("data and hash must be strings"). The raw driver returns the stored string directly. Don't "clean this up" by switching to the model.

### Puzzle selection (routes.js)
The `/api/puzzles/random` flow ports Lichess's puzzle pipeline:
- **In-memory session store** (`_sessions` Map, 1h TTL) — keyed by userId, holds 200 pre-sampled puzzle IDs at the user's current rating band. Flushed on theme/difficulty change or rating drift >100. Mirrors Lichess `PuzzleSession.scala` + `PuzzlePathApi.nextFor`.
- **Quality tiers** (`tierQ`) — top (vote≥0.75, plays≥100), good (vote≥0.5, plays≥20), all. Falls back through tiers if the top band is sparse.
- **Dedup** — checks `Round` collection for `userId:puzzleId` keys to avoid replay.
- Redis is used as an opportunistic cache (`rGet`/`rSet`) but failures are swallowed — code must work without it.

### Rating (glicko2.js)
Lichess-exact Glicko-2 port (constants from `lichess-org/lila`: TAU=0.75, SCALE=173.7178, RATING_FLOOR=400, MAX_DEVIATION=500, MIN_DEVIATION=45). Per-user ratings live in `userperfs.puzzle.gl` and update on every `POST /api/puzzles/:id/complete`. Guests use a default 1500/500/0.09 perf and don't persist.

### Engine pipeline (engine-battle/)
Independent subsystem managed by separate PM2 processes:
- `engine_runner.js` (PM2: engine-runner) — runs engine vs engine games, writes to `enginegames` collection
- `engine_updater.js` (PM2: engine-updater) — keeps `engines.json` registry current
- `puzzle_extractor.js` — scans completed games at depth=50/30s/25M nodes, extracts tactical positions matching Lichess puzzle quality thresholds (WIN_CHANCE_DELTA=0.3, MIN_WIN_CHANCE_GAIN=0.5, UNIQUENESS_MARGIN=50cp), writes to `puzzles`
- `cook.js` — theme tagger (70+ themes) reused by extractor

### Frontend (public/)
Plain HTML pages, no bundler. Each page is self-contained:
- `index.html` — main puzzle UI
- `blindfold.html` — blindfold mode (separate Glicko perf: `userperfs.blindfold`, default rating 800)
- `login.html`, `puzzle-status.html` (status dashboard, served at `/status`), `board_editor.html`, `engine_battle.html`, `terminal.html`, `theme.html`, `opening.html`

## Conventions

- **Test page workflow:** new features go in `public/test/feature.html` first, get confirmed working, *then* merge into `index.html` / `blindfold.html`. Editing production HTML directly has burned the project before.
- Root contains many one-off utility scripts (`build_pools*.js`, `gen_*.js`, `dbcheck.js`, `theme_check.js`, etc.) — these are migration/maintenance helpers, not part of the running server. Don't import them from server code.
- Files prefixed with `*.bak*` or named `server.js`/`server2.js` are dead code kept for reference. The live entry point is `server3.js`.
- `PROJECT_MASTER.md` is a historical session log (last updated April 2026) — useful for "why was this done" questions, not authoritative for current state. Trust the code.
- The organized docs hub lives in `PROJECT_MASTER/` (knowledge / decisions / plans / database / sessions, with `INDEX.md`). Read it for architecture/how-it-works; keep it updated.

## Workflow discipline (required)

- **After every change: write a session note + commit.** Add `PROJECT_MASTER/sessions/YYYY-MM-DD-<topic>.md` (what/why/files/verification/open items) and make a scoped git commit. Don't let uncommitted changes pile up.
- **Every idea goes in `PROJECT_MASTER/`** — plans/proposals → `plans/`, lasting decisions → `decisions/` (ADR), reusable knowledge → `knowledge/`; then link it in `INDEX.md`. Don't leave ideas only in chat.
- **Commit as the repo owner, scoped:** `sudo -u ubuntu git -C /home/ubuntu/chessguru ...`; stage exact paths (`git add <paths>` + `git commit -- <paths>`) — never `git add -A`, since the tree often holds unrelated in-progress work. Message style: `type: summary` (`fix:`/`feat:`/`docs:`/`chore:`).
- Full version: `PROJECT_MASTER/knowledge/11-working-rules.md`.
