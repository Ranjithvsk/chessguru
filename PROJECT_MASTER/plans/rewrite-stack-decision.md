# Plan: ChessGuru greenfield rewrite — APPROVED

**Status:** APPROVED 2026-05-29 (owner: "rebuild everything, organised neat colourful software";
"mongo db is enough"). Build new app in parallel on the same VPS; cut over at nginx when at parity;
old site stays live until then.

## Decisions (locked)
- **Scope:** everything — player pages (Puzzles, Blindfold, Theme), Opening, Engine Battle, Board
  Editor, and the admin/Puzzle-Factory dashboards.
- **Frontend:** React + **Vite** + **TypeScript**; **chessground** + **chess.js**; **Tailwind** for a
  neat, colourful design system; TanStack Query; Vitest + Playwright.
- **Backend:** **NestJS** + TypeScript; Redis + **BullMQ** for the engine/extractor jobs.
- **Database:** **MongoDB** (confirmed by owner) — mirrors Lichess (runs on MongoDB), the data model
  is already Lichess-shaped, and it reuses the existing 5.88M-puzzle dataset (lowest risk).
- **Structure:** pnpm monorepo at `chessguru/v2/` with `apps/web`, `apps/api`, `packages/types`.
- **Design intent:** clean, organised, **colourful** — vibrant primary + accent palette, card-based
  layout, dark theme, generous spacing, accessible contrast (fixes the old grey-on-black problem).

## Critical infra constraint
Shares the VPS with **production Dream World** (7.6 GiB, known OOM on heavy builds).
→ Do installs/builds **carefully** (sequential, watch `free -h`; swap is configured). Never run an
unbounded parallel install/build that could OOM-kill the box.

## Phasing
0. **Scaffold** monorepo (web + api + types) + Tailwind colourful theme + CI lint/typecheck. New web
   app initially reads the **existing** `/api` so we see real puzzles immediately.
1. **NestJS API** (Mongo via @nestjs/mongoose): auth, puzzle selection (rating/theme/piece + dedup),
   Glicko-2 rating, me/rating, daily/streak/dashboard/history.
2. **Player frontend** to parity: Puzzles → Blindfold → Theme (chessground), colourful UI.
3. **Engine pipeline** on BullMQ (runner/extractor/cook) → Mongo; admin dashboards rebuilt.
4. Opening explorer (self-hosted libs, no CDN) + Board editor.
5. Parity QA → nginx cutover → decommission old.

## Cross-refs
`knowledge/06-frontend.md`, `knowledge/10-known-issues-and-risks.md`,
`plans/modernization-and-cdn-assessment.md`.
