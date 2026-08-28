# 2026-08-28 · Fees MVP — W1 kickoff

## What
Landed the first slice of the ChessGuru Fees module: schema-first fee-program
creation + browse UI. Backend + frontend both compile clean. Deployed nowhere
yet — this commit stages the code on `feat/fees-mvp-w1`; deploy to Guna canary
is a follow-up step once the branch merges.

## Why
Plans landed today:
- `PROJECT_MASTER/plans/CHESSGURU-FEES-MVP.md` — 6-week build
- `PROJECT_MASTER/plans/CHESSGURU-FEES-WORLD-CLASS.md` — 12-month vision on top

Owner said "let's build". Following the MVP plan's W1 concrete-first-tasks list.
Design principles from the world-class doc baked in from day one so we don't
rewrite in M3 (i18n-keyed strings, all-4-states designed together, currency via
Intl.NumberFormat en-IN).

## Files
### Backend — new
- `apps/api/src/fees/fees.types.ts` — shared TS types, collection-name const,
  validation constants. No Mongoose `@Schema` — matches the ChessGuru raw-
  collection convention (`this.conn.db!.collection("fees_programs")`).
- `apps/api/src/fees/fees.service.ts` — program + head CRUD. Money in paise
  integers only. AcademyId scoping via `req.session.academyId`. Role gate:
  academy_owner only for W1.
- `apps/api/src/fees/fees.controller.ts` — REST surface under `/api/fees/*`.
- `apps/api/src/fees/fees.module.ts` — Nest module + `onModuleInit` that runs
  `ensureIndices()` idempotently at boot (no migration file needed).

### Backend — edited
- `apps/api/src/app.module.ts` — import FeesModule + register.

### Frontend — new
- `apps/web/src/lib/fees-api.ts` — typed fetch helpers + `fmtRupees` /
  `parseRupeesInput` utilities (rupees ↔ paise conversion at the edge).
- `apps/web/src/pages/Fees.tsx` — landing tile grid; only Programs tile is live
  in W1, others are "coming soon".
- `apps/web/src/pages/FeesPrograms.tsx` — list + create modal. All 4 states
  designed (loading skeleton, empty w/ SVG king-on-coin, error, populated grid).
  Kind-tinted head rows in the modal with live total per bill.

### Frontend — edited
- `apps/web/src/main.tsx` — routes for /fees + /fees/programs.
- `apps/web/src/components/Navbar.tsx` — one nav entry: 💰 Fees under Academy
  group.

## API surface added (all under `/api/fees/*`)
- `POST /programs` — create program (optionally with heads)
- `GET /programs?status=&q=` — list w/ head-count + total-per-bill preview
- `GET /programs/:id` — single program with heads
- `POST /programs/:id/archive` — soft-delete

## Mongo collections created lazily on first write (indices set by ensureIndices)
- `fees_programs`   — `{academyId, status, updatedAt DESC}` index
- `fees_heads`      — `{academyId, programId, order}` index

## Verification
- `npx tsc --noEmit` in both apps/api and apps/web — no errors introduced by
  this branch. (Pre-existing errors in unrelated files — StudyChapterEdit,
  Navbar's session-academy hook, purchases page — not touched.)
- Visual preview rendered as `/tmp/fees-preview/index.html` (headless-chrome
  screenshot in the conversation transcript).

## Open items (W1 → W2)
- **Deploy to Guna canary.** The MVP plan's W1 target is "Guna creates a real
  program and downloads a PDF." Deploy path for ChessGuru v2 isn't documented
  in the plan doc yet — TBD whether we mirror `scripts-deploy/deploy-canary.sh`
  or ship-to-Guna-directly. Ranjith to decide.
- **Session academyId injection.** ChessGuru sessions carry `session.academyId`
  for academy_owner users already (verified via
  `apps/api/src/academy/academy.service.ts` — same pattern reused). No new
  auth work needed for W1.
- **PDF library.** Not needed for W1 (no invoices yet). Decide in W2 when
  invoice PDF generation lands.
- **W2 next:** enrollments + invoice generation + basic PDF layout. Data model
  already in `fees.types.ts` (COL constants ready).

## Design decisions worth remembering
- **No new Guardian collection.** ChessGuru already models parents as `users`
  rows with `role="parent"`, linked from student docs via `parentIds: [userId]`.
  Fees will store `guardianUserId` on enrollments in W2 — no separate schema.
- **Paise-integer discipline.** Every service call validates `Number.isInteger`
  on `amountPaise`. The web layer converts rupees → paise via
  `parseRupeesInput` at the input boundary and never elsewhere.
- **Design principles applied to W1** (from CHESSGURU-FEES-WORLD-CLASS
  §Design Principles):
  - All 4 UI states designed (loading / empty / error / populated).
  - Every user-facing string wrapped in `t("...")` (placeholder for M4
    react-intl port — extraction script will find them all).
  - 44 × 44 px touch targets on primary CTAs.
  - `fmtRupees` uses `Intl.NumberFormat("en-IN", {currency:"INR"})`.
  - Zero dark patterns.

## Commit
`feat: fees MVP W1 — programs + heads (schema-first)` on branch
`feat/fees-mvp-w1`. Pushed to `origin/feat/fees-mvp-w1` for review.
