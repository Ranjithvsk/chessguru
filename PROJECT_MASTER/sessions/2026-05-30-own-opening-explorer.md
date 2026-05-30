# 2026-05-30 — Our own opening explorer (v2)

Owner asked to build *our own* opening explorer instead of depending on Lichess. Reason it's needed:
`explorer.lichess.ovh` **401s our datacenter IP** (confirmed from the VPS and a browser on the box —
the live `/opening` page was erroring in console), so we can't proxy or cache it. Full design in
`plans/own-opening-explorer.md`. This note is the rolling build journal.

## Phase 1–3 — ingestion foundation (DONE)
- **Schema** (Mongo, `chessguru` db): `openingnames {_id:epd, eco, name}` and
  `openingpositions {_id:"<db>|<epd>", db, key, w,d,b,g, moves:{<uci>:{san,w,d,b}}}`.
  `epd` = first 4 FEN fields → transpositions collapse.
- **Scripts** (`v2/apps/api/scripts/`, CommonJS, run as ubuntu from `apps/api`):
  - `pgn.js` — shared: `epdOf`, `sanTokens` (strips comments/variations/NAGs/move-numbers),
    `iterGames`, `walkGame` (replays mainline to maxPly via chess.js).
  - `ingest-eco.js` — lichess `chess-openings` a–e.tsv → `openingnames`. **Ran: 3706 docs, 0 skipped.**
  - `ingest-pgn.js` — stream PGN, aggregate positions+moves by game result, batched `$inc` bulkWrite
    upserts. Memory bounded by per-flush distinct positions.
- **Sample run** (proof): pgnmentor Anand+Carlsen+Kasparov = **13,822/13,823 games → 128,831
  positions**, memory stable (~1.7Gi free). Spot-check: start pos W/D/B 5069/5288/3465; top first
  moves e4(6935)>d4(4384)>Nf3>c4; `1.e4 c5` resolves to **B20 Sicilian Defense**. Correct.

## Phase 4 — /api/explorer endpoint (DONE)
- `ExplorerModule` (controller+service, raw Mongo Connection like PuzzlesService). `GET /api/explorer?fen&db=masters&moves&topGames` → Lichess-shaped `{white,draws,black,moves[],topGames:[],opening}`. Verified live via `https://harinitharanjith.com/v2api/api/explorer` (no 401): startpos 5069/5288/3465 top e4/d4; `1.e4 c5` → B20 Sicilian, top reply Nf3.
## Phase 5 — frontend repoint + UI (next)
## Phase 6 — scale corpus (next)

## Notes / data state
- Data lives in Mongo, not git. Current corpus = 3 pgnmentor player files (sample). `openingnames`
  fully populated. Re-running `ingest-pgn` is additive (`$inc`) — ingest each corpus once.
- `unzip` is not installed on the box; use `python3 -m zipfile`/`zipfile` to extract pgnmentor zips.
- pgnmentor needs a non-empty User-Agent and dislikes `-L`/`-e` combos; `curl -A Mozilla/5.0 -o` works.
