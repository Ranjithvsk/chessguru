# ChessGuru — Backend Deep Dive

Covers `server3.js`, `routes.js`, `glicko2.js`, `models.js`, `models/Puzzle.js`, `auth.js`.
Every line reference is to the file at `/home/ubuntu/chessguru/`.

---

## 1. `server3.js` — boot & middleware (the only live entrypoint)

Boot sequence (order matters — see [ADR-0001](../decisions/ADR-0001-server3-is-the-entrypoint.md)):

1. Build two rate limiters first: `limiter` (60 req/min, applied to the whole `/api` tree) and
   `authLimiter` (10 attempts / 15 min, applied to register/signin only).
2. `app.set("trust proxy", 1)` (correct client IPs behind nginx).
3. `helmet({contentSecurityPolicy:false, crossOriginEmbedderPolicy:false})` — **CSP and COEP
   disabled** (so board/engine assets load).
4. `cors({origin:true, credentials:true})` — reflects **any** origin and allows cookies (wide open).
5. `express.json()`.
6. `mongoose.connect("mongodb://localhost:27017/chessguru")` — URL **hardcoded** (not env). On
   success:
   - mount `express-session` with `MongoStore` (TTL 30 days); `secret = process.env.SESSION_SECRET
     || 'cg_super_secret_2026'` (**hardcoded fallback**); `cookie:{secure:false, maxAge:7d}`
     (**cookie sent over plain HTTP**).
   - `const routes = require("./routes")` — required *after* session is mounted.
   - register page routes (`/status`, `/puzzle-status`, `/board-editor`, `/engine-battle`,
     `/opening`, `/terminal`), then `express.static("public")`.
   - auth routes (`/auth/register|signin|me|logout`, `/login`).
   - `app.use("/api", limiter, routes)`.
   - `/blindfold`, then the SPA catch-all `app.get("/*splat", …)` (Express-v5 named wildcard —
     [ADR-0004](../decisions/ADR-0004-express-v5-named-wildcard.md)).
   - `app.listen(PORT)`.

Env vars: `PORT` (default 3000), `SESSION_SECRET` (fallback above). Mongo URL is hardcoded.

---

## 2. `routes.js` — the puzzle engine

### Wire-format helpers
- `fmtPuzzle(p)` (L2): converts a DB puzzle to the API shape — exposes `id`, `rating` (rounded
  `glicko.r`), `ratingDeviation`, `solution` (UCI array split from `line`), keeps `glicko`.
- `applyLastMove(p)` (L3–7): **Lichess convention** — the *first* solution move is the opponent's
  setup move. Plays `solution[0]` on `fen`, returns `{preFen, lastMove, fen:postMove,
  solution:solution.slice(1)}`. The client animates `preFen → fen` then the user solves from there.

### Difficulty & quality tiers
- `DIFF` (L17): `easiest:-600, easier:-300, normal:0, harder:+300, hardest:+600` (rating offset).
- `tierQ(tier)` (L20): `top` = `{vote≥0.75, plays≥100}`, `good` = `{vote≥0.50, plays≥20}`,
  else `{}` (all). Mirrors Lichess `PuzzleTier.scala`.

### In-memory session store `_sessions` (L26–76) — the personalized path
A module-level `Map`, keyed by userId, **TTL 1 hour**. Mirrors Lichess `PuzzleSession`.
- `_sFlush` rebuilds when: no session, theme changed, difficulty changed, **or rating drift > 100**.
- `_sCreate` builds up to **200 puzzle IDs**: `target = clamp(rating + DIFF[diff], 400..3000)`;
  band `flex = round(100 + |1500−target|/4)` (widens away from 1500); walks tiers
  `top → good → all`, first tier with ≥5 hits wins; widen to ±400 if still empty; Fisher–Yates
  shuffle; `{ids, pos:0}`.
- `_getNextForUser` pops `ids[pos++]`, up to 10 retries; **dedups against the `rounds` collection**
  on the first 5 retries (via a `$where` JS predicate — slow, flagged in
  [10-known-issues](10-known-issues-and-risks.md)); rebuilds the session when the list runs out.

### Path / pool fast-paths (offline-precomputed — see [07-pools](07-pools-and-maintenance-scripts.md))
- `paths` collection (range-keyed `theme|tier|RRRR`): `fromPath`/`sel` (L86–93) `$sample` a path
  doc and return a random member, stepping the tier down on miss.
- `bfPools` (`theme|band|pc`) and `piecePools` (`theme|band`): O(1) random lookups used when a
  **piece-count filter** is active.
- `getPool` (L94–98): Redis-cached top-300-by-vote pool for a rating band.

### `getPz(...)` (L99–179) — the multi-strategy fallback selector
Tries, in order: (1) `paths`; (2) `bfPools` ladder (piece filter + theme); (3) `piecePools`
ladder; (4) `getPool`; (5) widen rating ±400 keeping the piece filter; (6) a Lichess-exact
5-level rating-flex scan over tiers with random `skip`. Returns null only if all fail.

### Redis (L79–84)
`ioredis` to `127.0.0.1:6379`, **fail-fast** (`retryStrategy:()=>null`, no offline queue), all
errors swallowed → best-effort cache only. `rGet`/`rSet` (default TTL 60 s). In-process
`sCache` (streak, 30 s) and `dayCache` (daily, 24 h).

### `/api/puzzles/random` — the headline flow (L229–267)
1. Logged-in **and no piece filter** → `_getNextForUser` (personalized + deduped + batched).
2. Else if `pieceMax<32` → direct `bfPools` O(1) lookup.
3. Else → `getPz`.
Then `applyLastMove(fmtPuzzle(p))`. 404 if nothing found.

### `POST /api/puzzles/:id/complete` (L270–285) — rating update
Body `{win, userId, difficulty, hint, mode, rating, deviation}`. `$inc plays`. If `userId`:
load `UserPerfs`, pick perf `blindfold` (default r=800) or `puzzle` (default 1500); if `hint` →
no rating change, else `updatePuzzleRating()`; persist perf, a `Round` (`_id="userId:puzzleId"`,
`{w,d}`), and `User.count` increments. Guests with `rating` in the body get a one-off, non-persisted
update. (Quirk: the logged-in response hardcodes `d:200` in the payload though the real `d` is stored.)

### Other endpoints (full list in [08-api-reference](08-api-reference.md))
`pc-options`, `themes` (the 69-key `THEMES` array), `me/rating`, `puzzles/daily`, `puzzles/:id`,
`puzzles/batch`, `streak` (+`SBUCKETS` ramp) / `streak/complete`, `dashboard/:days`, `history`,
`health`. Plus the **`/status/*`** extractor-control + **`/generated/*`** review-queue +
`extractor/log` endpoints (these read the raw `puzzles` collection in its richer engine shape).

> `module.exports = router` sits at L340 but ~220 more `router.get/post` lines follow it — works
> only because `router` is a shared mutable reference. Fragile; don't destructure the export.

---

## 3. `glicko2.js` — rating math (Lichess-exact)

Constants (L1): `DEFAULT_RATING 1500`, `DEFAULT_DEVIATION 500`, `DEFAULT_VOLATILITY 0.09`,
`TAU 0.75`, `RATING_PERIODS_PER_DAY 0.21436`, `MAX_DEVIATION 500`, `MIN_DEVIATION 45`,
`MAX_RATING_DELTA 700`, `RATING_FLOOR 400`, `CONVERGENCE_TOL 1e-6`, `SCALE 173.7178`. Frozen — see
[ADR-0003](../decisions/ADR-0003-glicko2-lichess-exact.md).

- `toG2/fromG2` scale conversions; `g(phi)`, `E(...)` standard Glicko helpers.
- `computeGame(player, opponent, score)` (L6–22): one Glicko-2 step — variance `v`, `delta`,
  volatility via the **Illinois (regula-falsi) iteration** to `1e-6`, new `σ' φ' μ'`; returns
  `{r:max(400,round), d:clamp(45..500), v:σ'}`.
- `liveDeviation(perf, reverse)` (L23–29): inflates RD by idle time
  (`periods = daysIdle·0.21436`); `reverse=true` undoes the pre-game inflation before storing.
- `updatePuzzleRating(userPerf, puzzleGlicko, win)` (L31–40) — the public API. Runs `computeGame`
  for the user **and** symmetrically for the puzzle (so puzzle ratings drift too), clamps the user
  delta to ±700, keeps the last 12 ratings in `re`, returns
  `{userPerf, puzzleGlicko, ratingDiff}`.

---

## 4. Schemas (`models.js`, `models/Puzzle.js`)

`models.js` (Lichess-style compact field names, `{_id:false, versionKey:false}`):
- `User` (coll `users`): `_id` (=lowercased username), `username`, `count{game,rated,win,loss,draw}`,
  `profile{...}`, `roles[]`, `marks[]`, **`bpass:Buffer`** (but auth writes a *string* — see
  [ADR-0002](../decisions/ADR-0002-auth-bypasses-mongoose.md)), `email`, `createdAt`, etc.
- `UserPerfs` (coll `userperfs`): `_id`=userId; a Glicko perf (`{gl:{r,d,v}, nb, re[], la}`) for
  every variant (`bullet…crazyhouse`, `puzzle`), score perfs for `storm/racer/streak`, and
  `blindfold` **defaulting to r=800**.
- `Round` (coll `rounds`): `_id`=`userId:puzzleId`, `w` (win), `d`/`f` dates, `v`, `t[]` themes —
  doubles as the dedup source for selection.

`models/Puzzle.js` is a **separate, legacy** model with the Lichess-CSV shape
(`puzzleId, fen, moves, rating, popularity, nbPlays, themes:String, gameUrl, openingTags`). The
live runtime uses a *different* compact `Puzzle` shape declared inside `routes.js`
(`line, glicko{r,d,v}, plays, vote, themes:[String], pieceCount`), and the `/status` & `/generated`
endpoints read an even richer raw-collection superset (`solution, sourceGameId, status, pov,
scoreBefore/After, verified, source`). Three field vocabularies coexist in one `puzzles`
collection — documented in [database/schema.md](../database/schema.md).

---

## 5. `auth.js` — raw-driver auth

`getCol() = mongoose.connection.db.collection('users')` (bypasses the `User` model). 
- `register`: validate username `^[a-zA-Z0-9_-]{2,20}$` + password ≥6; case-insensitive uniqueness;
  `bcrypt.hash(pw,10)`; insert `{_id:lowercased, username, bpass, email, createdAt}`; auto-login.
- `signin`: lookup by username (escaped regex) or email; **normalize `bpass`** from string / Node
  Buffer / BSON Binary to a string before `bcrypt.compare` (the whole reason for the raw driver);
  `keep` extends the cookie to 30 days.
- `me` / `logout`: session read / `req.session.destroy`.
- Rate limiting comes from `authLimiter` in `server3.js` (register/signin only).
