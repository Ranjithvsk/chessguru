# Plan: our own opening explorer (v2)

**Status:** IN PROGRESS (started 2026-05-30) · owner chose "our own backend DB" over proxying Lichess.

## Why not just call Lichess
`explorer.lichess.ovh` **401s our datacenter IP** (confirmed from the VPS and from a browser on the
box; the live `/opening` page was throwing 401 in console). So we cannot proxy it server-side, can't
cache it, and even client-side it's an unverifiable, uncontrolled dependency. Decision: build our own
position-keyed opening book in the v2 NestJS+Mongo API and serve a Lichess-compatible endpoint.

## Data model (Mongo, `chessguru` db)
- **`openingpositions`** — one doc per reachable position, per database:
  - `_id`: `"<db>|<epd>"` where `epd` = the first **4** FEN fields (placement, side, castling, en
    passant) → transpositions collapse, move clocks ignored. `db` = `masters` (more later).
  - `w, d, b`: game-result counts at this position (white win / draw / black win).
  - `moves`: object map keyed by **UCI** (`e2e4`) → `{ san, w, d, b }` (result counts for games that
    played that move from here). UCI keys are dot-free so they're safe Mongo field names + allow
    `$inc` on `moves.<uci>.w`.
  - `g`: total games through this position.
- **`openingnames`** — ECO/opening-name lookup: `{ _id: epd, eco, name }`, ~3700 rows from
  `lichess-org/chess-openings` (a–e.tsv). At query time we look up the *current* position's epd; if
  miss, we keep the last known opening from the line walked (handled client- or server-side).

## Ingestion (one-off Node scripts, `v2/apps/api/scripts/`, run as ubuntu)
- **`ingest-eco.js`** — fetch a–e.tsv, replay each `pgn` with chess.js, store `{_id:epd, eco, name}`.
- **`ingest-pgn.js <files…> [--maxply 24] [--db masters]`** — stream each PGN file, for every game:
  parse the result, replay the mainline up to `maxply`, and for each ply accumulate (in an in-memory
  Map flushed every N games) `$inc` updates to the position doc and its `moves.<uci>` counters via a
  batched `bulkWrite` upsert. Memory is bounded by distinct positions per flush-batch. CPU-bound
  (chess.js replay) → run `nice`, watch `free -h` (shared box with DWP prod).
  - PGN parser is intentionally minimal: strip `{…}` comments, `(…)` variations, `$n` NAGs and move
    numbers, tokenise SAN, replay with `chess.js`. Master PGNs (pgnmentor) are clean mainlines.

## API — `GET /api/explorer` (NestJS `ExplorerModule`, served at `/v2api/api/explorer`)
Query: `fen` (required), `db=masters`, `moves=12`, `topGames=0`.
Response (Lichess-shaped so the FE reads 1:1):
```jsonc
{ "white": N, "draws": N, "black": N,
  "moves": [ { "uci","san","white","draws","black","averageRating":null,"game":null } ], // sorted by total desc, sliced to `moves`
  "topGames": [],                 // v1: empty (no per-position game store yet)
  "opening": { "eco","name" } | null }
```

## Frontend
`lib/explorer.ts` → calls `/api/explorer` (our backend, no 401). `Opening.tsx` upgraded: per-move
W/D/B win bars + game counts, opening ECO/name breadcrumb, keep board + line navigation.

## Phasing
1. ✅/▶ plan doc.
2. ECO names ingestion + schema (small, reliable) → opening-name lookup works.
3. PGN ingestion pipeline + **small sample** run → prove the tree end-to-end.
4. `/api/explorer` endpoint.
5. Frontend repoint + UI; verify from the box (no 401).
6. Scale: ingest a real masters corpus (pgnmentor), monitor memory, record data-state.

## Deferred (documented, not silently dropped)
- `topGames`/`recentGames` (needs a per-position sample-game store).
- `averageRating`/`performance` per move (needs Elo in the corpus + running averages).
- `since`/`until`, `ratings`, `speeds` filters; the `lichess` and `player` databases.
- Idempotent re-ingestion (v1 `$inc` is additive — ingest each corpus once; track processed files).
