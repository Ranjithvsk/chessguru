# Plan: ChessGuru greenfield rewrite — recommended stack & DB

**Status:** PROPOSED (2026-05-29) — awaiting owner approval before any build. Owner wants a full
greenfield rewrite of frontend AND backend, best-in-market.

## Recommended stack (my pick)
- **Monorepo:** pnpm workspaces with a shared `packages/types` (one source of truth for FE↔BE types).
- **Frontend:** React 19 + **Vite** + **TypeScript**; **chessground** (board) + **chess.js** (rules);
  TanStack Query (data), Tailwind (styling), Vitest + Playwright (tests).
- **Backend:** **NestJS** + TypeScript (modules/DI, auth guards, validation). Alt considered:
  Fastify + tRPC (leaner, best end-to-end types, less structure) — Nest chosen for long-term
  structure.
- **Database:** **PostgreSQL + Prisma** (see decision below). **Redis + BullMQ** for cache + the
  engine/extractor job queue.
- **Engine pipeline:** Stockfish runner/extractor stay as standalone Node/TS workers driven by BullMQ.

## DB decision: PostgreSQL (over keeping MongoDB)
Data is fundamentally relational (`users → userperfs → rounds → puzzles`) and rating updates want
transactions. Postgres wins on:
1. Relational integrity + transactions (ratings/rounds).
2. Strong indexing — btree on rating, **GIN** on `themes` — likely **removes most of the precomputed
   "pools" complexity** that exists only to work around Mongo random/filter cost.
3. **JSONB** keeps Mongo-style flexibility for engine-generated metadata while hot fields stay typed
   and indexed.
4. **Owner already runs PostgreSQL** for Dream World (Prisma, backups, ops) → one DB tech to operate;
   Prisma gives typed access that matches the TS stack.
- Keep MongoDB only if avoiding data migration matters more than the above — but a greenfield rewrite
  is the right time to switch.
- Migration: export 5.88M puzzles + users/perfs/rounds → Postgres tables (typed columns + JSONB for
  extras); re-derive selection from indexes (drop/shrink pools).

## Zero-downtime approach
Build the new app in parallel on the same VPS under a new path; keep the current site serving
`harinitharanjith.com` until parity; cut over at the nginx layer. Old code/data stay intact as a
rollback.

## Phasing (proposed)
0. Scaffold monorepo (Vite+React+TS, NestJS+TS, Prisma+Postgres, shared types), CI: lint+typecheck+test.
1. Data layer: Postgres schema + migrate puzzles/users/perfs/rounds; verify counts.
2. Core API (NestJS): auth, puzzle selection (rating/theme/piece + dedup), rating (Glicko-2), me.
3. Player frontend: Puzzles → Blindfold → Theme (chessground), at parity with today.
4. Engine pipeline on BullMQ (runner/extractor/cook) writing to Postgres; admin dashboards.
5. Opening explorer + board editor.
6. Parity QA → nginx cutover → decommission old.

## Open questions for owner
- Scope: everything (incl. admin/Puzzle-Factory) or player-facing first?
- Timeline/urgency? Any must-keep features or URLs?
- Confirm staying on this VPS.

## Cross-refs
`knowledge/10-known-issues-and-risks.md`, `knowledge/06-frontend.md`,
`plans/modernization-and-cdn-assessment.md` (the lighter incremental alternative).
