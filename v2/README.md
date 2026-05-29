# ChessGuru v2

Modern rebuild of ChessGuru. pnpm monorepo.

```
v2/
├── apps/
│   ├── web/   # React + Vite + TypeScript + Tailwind + chessground  (player UI, colourful)
│   └── api/   # NestJS + TypeScript + MongoDB (Mongoose) + BullMQ    (API + engine jobs)
└── packages/
    └── types/ # shared FE↔BE TypeScript types
```

## Stack
- **Web:** React 18, Vite, TypeScript, Tailwind CSS, chessground, chess.js, TanStack Query
- **API:** NestJS, Mongoose (MongoDB), Redis + BullMQ
- **DB:** MongoDB (same data model as Lichess / the existing app)

## Develop
> ⚠️ This VPS also runs production Dream World — install/build **carefully** (sequential, watch
> `free -h`; swap is configured). Don't run unbounded parallel builds.

```bash
cd v2
pnpm install                 # do this deliberately; watch memory
pnpm dev:web                 # web on :5173 (proxies /api to the existing :3000 in Phase 0)
pnpm dev:api                 # NestJS API on :4000
```

## Status
**Phase 0 — scaffold.** The web app currently reads the **existing** Express API (`:3000/api`) so it
shows real puzzles immediately, while the NestJS API (`apps/api`) is built out in Phase 1. See
`../PROJECT_MASTER/plans/rewrite-stack-decision.md` for the full phased plan.
