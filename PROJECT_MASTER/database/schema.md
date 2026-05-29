# ChessGuru — Database Schema

MongoDB database `chessguru` on `mongodb://localhost:27017` (no auth, local only). Mongoose schemas
in `models.js`; a legacy `models/Puzzle.js`; pool collections written by maintenance scripts.
`_id` is a string across user-facing collections.

## Collections & live counts (2026-05-29)

| Collection | Count | Purpose |
|---|---|---|
| `puzzles` | 5,882,680 | all puzzles (imported Lichess + engine-generated `cg_*`) |
| `bfPools` | 13,443 | blindfold selection pools (`theme\|ratingBand\|pc`) |
| `paths` | 4,299 | Lichess path model (`theme\|tier\|rating`, range-keyed) |
| `piecePools` | 590 | piece-count selection pools (`theme\|maxPc`) ⚠️ stray empty `piecepools`(0) too |
| `enginegames` | 245 | engine-vs-engine games (extractor input) |
| `rounds` | 165 | per-user attempt history + dedup source |
| `enginetournaments` | 12 | tournament standings/status |
| `sessions` | 5 | express-session store (connect-mongo, 30d TTL) |
| `users` | 4 | accounts (accessed via raw driver — [ADR-0002](decisions/ADR-0002-auth-bypasses-mongoose.md)) |
| `userperfs` | 4 | per-user Glicko-2 ratings |
| `themePools` / `enginePools` | 3 / 3 | engine puzzles by theme (duplicates; app uses `enginePools`) |

## User-facing schemas (models.js)

**`User`** (`users`): `_id`(=lowercased username), `username`, `bpass:Buffer` (but auth stores a
*string* — [ADR-0002](decisions/ADR-0002-auth-bypasses-mongoose.md)), `email`, `enabled`, `roles[]`,
`count{game,rated,win,loss,draw}`, `profile{flag,location,bio,realName,fideRating,links}`, `toints`,
`time{total,tv}`, `lang`, `kid`, `marks[]`, `seenAt`, `createdAt`. Mirrors Lichess's user doc.

**`UserPerfs`** (`userperfs`): `_id`(=userId). Glicko sub-doc `{r:1500,d:500,v:0.09}`. One perf
(`{gl, nb, re[], la}`) per variant (`bullet…crazyhouse`, `puzzle`), score perfs (`{nb,w,last}`) for
`storm/racer/streak`, and **`blindfold` defaulting to r=800**. The trainer uses `puzzle.gl`;
blindfold uses `blindfold.gl`.

**`Round`** (`rounds`): `_id`(=`userId:puzzleId`), `w`(win bool), `d`/`f`(dates), `v`, `t[]`(themes).
Also the dedup source for selection.

## The `puzzles` field-vocabulary divergence (important)

One collection, **three coexisting shapes** — know which you're reading:
1. **Runtime `Puzzle`** (declared in `routes.js`): `_id, fen, line` (space-sep UCI), `glicko{r,d,v}`,
   `plays`, `vote`, `themes:[String]`, `pieceCount`. This is what the gameplay API uses.
2. **Legacy `models/Puzzle.js`** (Lichess-CSV import shape): `puzzleId, fen, moves, rating,
   ratingDeviation, popularity, nbPlays, themes:String, gameUrl, openingTags`. Effectively dead vs
   the live API.
3. **Engine-generated superset** (written by `puzzle_extractor.js`, read by `/api/status/*` &
   `/api/generated/*` via the raw driver): adds `solution, initialPly, sourceGameId, sourceRound,
   white/blackName, pov, scoreBefore/After, verified, ratingDeviation` — and *attempts*
   `source:'generated'` + `status` which the schema **silently drops**
   ([10-known-issues](knowledge/10-known-issues-and-risks.md) #8).

The one-time `migration/fix_fen.js` normalized older docs so `fen` is post-first-move and `line` is
the remaining moves (guarded by a `migrated` flag).

## Pool collections (see [07-pools](knowledge/07-pools-and-maintenance-scripts.md))
`paths` (`{_id,min,max,ids[]}` range-keyed), `piecePools`/`bfPools`/`themePools`/`enginePools`
(`{_id,ids[],count,gen}`-style). Built offline; consumed by `routes.js` selection — [ADR-0007](decisions/ADR-0007-precomputed-pools.md).

## Maintenance notes
- Drop the duplicate-cased empty `piecepools` collection.
- Rebuild pools when the puzzle set changes (watch `/api/health` `pathsStale`).
