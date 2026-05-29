# ChessGuru — Architecture Overview

A self-hosted, Lichess-style **chess puzzle trainer** with a **self-feeding engine puzzle factory**.
Plain-HTML frontend, Express/MongoDB backend, separate engine service. This is the 1-page map; each
area links to its deep-dive.

```
                          harinitharanjith.com (nginx, TLS)
                                      │
        ┌─────────────────────────────┼──────────────────────────────┐
        │                             │                              │
   /  /blindfold /login        /status /engine-battle           /ws-engine
   /opening /theme ...          /board-editor /terminal         /api/engine-runner
        │                             │                              │
        ▼                             ▼                              ▼
  ┌───────────────────────────────────────────────┐        ┌──────────────────┐
  │  web/API  :3000   (PM2 chessguru, server3.js)  │        │ engine runner    │
  │  ┌──────────────────────────────────────────┐ │        │  :3002  (PM2     │
  │  │ routes.js: puzzle selection + rating +    │ │        │  engine-runner)  │
  │  │ /api/status,/api/generated (extractor ops)│ │        │ engine-vs-engine │
  │  │ auth.js (bcrypt+session)  glicko2.js      │ │        │ tournaments → WS │
  │  └──────────────────────────────────────────┘ │        └────────┬─────────┘
  └───────────────────┬───────────────┬───────────┘                 │
                      │               │                             │ writes
                      ▼               ▼                             ▼
                 MongoDB:27017    Redis:6379                 enginegames
                 (chessguru)     (best-effort)                    │
                  puzzles 5.88M                                   │ analyzed by
                  pools, users,                          puzzle_extractor.js
                  userperfs, rounds                      (Stockfish depth 50)
                      ▲                                          │ + cook.js themes
                      └──────────────── writes puzzles ◀─────────┘
```

## The flows in one paragraph each

**Solving a puzzle.** The browser (`index.html`) fetches `GET /api/puzzles/random`. For a logged-in
user with no piece filter, the backend serves from a per-user **in-memory session** of 200
pre-sampled IDs at their rating band (deduped against `rounds`); otherwise it falls back through
precomputed **pools** (`paths`/`bfPools`/`piecePools`) and finally a live DB scan. The first
solution move is the opponent's setup move (animated client-side). The user's moves are checked by
**exact UCI compare** against the solution line; on completion `POST /api/puzzles/:id/complete` runs
a **Lichess-exact Glicko-2** update and persists the perf + a `Round`. → [04-backend-deep-dive](04-backend-deep-dive.md)

**Generating puzzles.** `engine_runner.js` plays engine-vs-engine games into `enginegames`.
`puzzle_extractor.js` re-analyzes decisive games with **Stockfish** (depth 50 / 25M nodes / 30s,
MultiPV 3), flags **blunders** by win-chance swing (≥0.3), validates uniqueness, tags themes with
`cook.js`, estimates a rating, and writes new `cg_*` puzzles. Admins watch/operate it from
`/status`. → [05-engine-pipeline](05-engine-pipeline.md)

**Rating.** `glicko2.js` is a frozen Lichess port; puzzle ratings drift too (symmetric update).
Blindfold mode keeps a separate perf (default 800). → [ADR-0003](../decisions/ADR-0003-glicko2-lichess-exact.md)

**Pools.** Because `puzzles` has 5.88M docs, candidate-ID lists are precomputed offline into
`paths`/`piecePools`/`bfPools`/`enginePools` and refreshed by maintenance scripts.
→ [07-pools-and-maintenance-scripts](07-pools-and-maintenance-scripts.md), [ADR-0007](../decisions/ADR-0007-precomputed-pools.md)

## Where to read next
- Infra/host/ports/SSL → [01-infra](01-infra.md)
- App & DB summary → [02-app-and-db](02-app-and-db.md)
- Rules & gotchas → [03-rules-and-gotchas](03-rules-and-gotchas.md)
- Backend internals → [04-backend-deep-dive](04-backend-deep-dive.md)
- Engine pipeline → [05-engine-pipeline](05-engine-pipeline.md)
- Frontend (all pages) → [06-frontend](06-frontend.md)
- Pools & scripts → [07-pools-and-maintenance-scripts](07-pools-and-maintenance-scripts.md)
- API reference → [08-api-reference](08-api-reference.md)
- Links & libraries → [09-links-libraries-resources](09-links-libraries-resources.md)
- **Known issues & risks → [10-known-issues-and-risks](10-known-issues-and-risks.md)**
- Schemas → [database/schema.md](../database/schema.md)
