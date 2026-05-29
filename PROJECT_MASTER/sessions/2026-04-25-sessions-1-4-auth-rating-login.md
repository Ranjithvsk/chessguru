# Session log: Auth + per-user rating + login page (Sessions 1–4)

**Date:** 2026-04-25 · _Condensed from the original monolithic `PROJECT_MASTER.md` (§6)._

## What shipped
1. **Own login system** (`auth.js`, 83 lines) — bcrypt(10) + `express-session`, sessions stored
   in MongoDB via `connect-mongo` (`.default`, 30-day TTL). Endpoints `POST /auth/register`,
   `POST /auth/signin`, `GET /auth/me`, `POST /auth/logout`. Rate-limited 10/15min. Uses the raw
   MongoDB driver to dodge the BSON-Binary `bpass` bug → [ADR-0002].
2. **Login page** (`public/login.html`, 134 lines) — Lichess-style sign-in/register tabs,
   password toggle, "keep me logged in", `?tab=register` deep link, redirects to `/` (or `?back=`).
3. **Navbar user widget** added to `index.html` + `blindfold.html` (Sign in / username / Sign out;
   loads saved rating via `/api/me/rating`).
4. **Per-user Glicko-2 rating** — `GET /api/me/rating` seeds the client; `POST /api/puzzles/:id/
   complete` runs `updatePuzzleRating()`, saves to `userperfs`, updates `User.count`, writes a
   `Round`. Replaced the old hardcoded-1500-on-load behaviour. → [ADR-0003].

## Bugs fixed this session
- `bcrypt` "data and hash must be strings" → normalize BSON Binary `bpass` (→ ADR-0002).
- `E11000 duplicate key lichessId_1` → `db.users.dropIndex("lichessId_1")`.
- `connect-mongo` `.create is not a function` → `require('connect-mongo').default`.
- Express v5 catch-all crash → named wildcard `/*splat` (→ ADR-0004).
- `OverwriteModelError` (User defined twice) → define once in `models.js`.

## Infra at the time
GCP `e2-small`, `34.143.245.57`, Ubuntu 24.04, MongoDB 7, disk ~86% full. _(Since superseded —
the app now runs co-located on the DreamWorld OVH VPS; see plans/ovh-migration.md.)_

## Test user
`TestUser` / `test1234` (`_id: testuser`) in `chessguru.users`.

## Carried-forward TODOs (still open as of 2026-05-29)
- Create `public/test/` and follow the test-page workflow (ADR-0005).
- Lichess-exact feedback UI (plans/feedback-ui-lichess-exact.md).
- Commit the repo regularly.
