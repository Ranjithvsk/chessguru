# ChessGuru — Complete API Reference

Same-origin. Auth/page routes are mounted in `server3.js`; everything under `/api` is in `routes.js`
(rate-limited 60/min). The engine runner exposes a *separate* API on **:3002** (proxied at
`/ws-engine` and `/api/engine-runner`).

Legend: 🔓 = no auth/admin guard (see [10-known-issues](10-known-issues-and-risks.md)).

## Auth (server3.js)
| Method | Path | Body / params | Returns |
|---|---|---|---|
| POST | `/auth/register` | `{username,password,email?}` | `{ok}` (auto-logs-in) · rate-limited 10/15min |
| POST | `/auth/signin` | `{username,password,keep?}` | `{ok}` · rate-limited 10/15min |
| GET | `/auth/me` | — | `{loggedIn, username?, userId?}` |
| POST | `/auth/logout` | — | `{ok}` |

## Pages (server3.js)
`GET /login /blindfold /status /puzzle-status /board-editor /engine-battle /opening /terminal`,
and `GET /*splat` → `index.html` (SPA catch-all).

## Puzzles & rating (routes.js, under /api)
| Method | Path | Params / body | Returns |
|---|---|---|---|
| GET | `/api/themes` | — | `{themes:[...69]}` |
| GET | `/api/me/rating` | (session) | `{rating, loggedIn, userId?}` |
| GET | `/api/puzzles/pc-options` | `theme,rating` | `{theme,rating,available:[pc...]}` |
| GET | `/api/puzzles/daily` | — | puzzle (24h cache) |
| GET | `/api/puzzles/random` | `theme,difficulty,rating,pieceMin,pieceMax/maxPc` | puzzle (the main selector) |
| GET | `/api/puzzles/batch` | `theme,difficulty,rating,nb`(≤50) | `{puzzles:[...]}` |
| GET | `/api/puzzles/:id` | — | puzzle |
| POST | `/api/puzzles/:id/complete` | `{win,userId,difficulty,hint,mode,rating,deviation}` | `{win,ratingDiff,rating,deviation,puzzleRating,glicko}` |
| GET | `/api/streak` | — | `{puzzles:[...]}` (30s cache) |
| POST | `/api/streak/complete` | `{userId,score}` | `{ok}` |
| GET | `/api/dashboard/:days` | `userId` (req) | per-theme + global stats |
| GET | `/api/history` | `userId`(req),`page` | `{history:[{round,puzzle}],page}` |
| GET | `/api/health` | — | `{status,puzzles,paths,users,pathsStale}` |

Puzzle wire shape: `{id, fen, solution:[uci...], rating, ratingDeviation, plays, themes:[...],
glicko, lastMove?, preFen?}` (the first solution move is the opponent's setup move, exposed as
`lastMove`/`preFen`).

## Extractor control & generated-puzzle review (routes.js) — 🔓
| Method | Path | Notes |
|---|---|---|
| GET | `/api/status/puzzles` | dashboard stats (some metrics hardcoded) |
| GET | `/api/status/games` | `filter=all\|unextracted\|extracted` |
| GET | `/api/status/puzzles/list` | `source,theme,maxPc,limit` |
| GET | `/api/status/pools` | bfPools/piecePools stats |
| GET | `/api/status/extractor` | extractor status JSON |
| POST | 🔓 `/api/status/extractor/start` | **runs shell**: `nohup node …/puzzle_extractor.js …` |
| POST | 🔓 `/api/status/extractor/stop` | **runs shell**: `pkill -f puzzle_extractor.js` |
| POST | 🔓 `/api/status/extractor/start-game` | `{gameId}` — analyze one game |
| POST | 🔓 `/api/status/puzzles/:id/quality` | `{quality}` — `bad` **deletes** the puzzle |
| GET | `/api/generated/puzzles` | `status,limit,skip` |
| GET | `/api/generated/stats` | pending/approved/rejected counts |
| POST | 🔓 `/api/generated/puzzles/:id/approve` | sets approved+verified |
| POST | 🔓 `/api/generated/puzzles/:id/reject` | sets rejected |
| GET | `/api/extractor/log` | last 100 lines of `/tmp/puzzler.log` |

## Board-editor analysis (routes.js)
| POST | `/api/engine/analyze` | `{fen,depth,multiPV}` → `{lines:[{score,mate,depth,nodes,nps,pv:[uci]}]}` (server-side Stockfish) |

## Engine runner (:3002, separate service — engine_runner.js)
HTTP (CORS `*`): `GET /health`, `/engines`, `/games` (≤50), `/tournaments` (≤20).
WebSocket `/ws-engine`: client → `{type:'start_tournament', engineIds, thinkMs, maxGames}` /
`{type:'stop'}`; server → `connected, tournament_start, round_start, game_start, move, clock,
engine_info, game_end, standings_update, tournament_end, stopped, error`.
