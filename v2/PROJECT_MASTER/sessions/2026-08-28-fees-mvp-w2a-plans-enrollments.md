# 2026-08-28 · Fees MVP — W2a: plans + enrollments

## What
Second slice on `feat/fees-mvp-w1`. Extends W1's programs-only scaffold with:
- Plans (1:1 with a program): cadence, day-of-month, due-offset, start/end,
  late-fee grace.
- Enrollments: bulk-enrol multiple students in a plan with an optional
  discount; pause / resume / end row actions.
- Program detail page: single workspace showing heads, plan config,
  enrolled-students table, and the enrol modal.

**Invoices + PDFs come in the next slice (W2b).** This slice makes the shape
usable end to end so W2b just adds "generate invoice from an enrollment."

## Files
### Backend
- `apps/api/src/fees/fees.types.ts` — added `FeePlanDoc`, `FeeEnrollmentDoc`,
  Plan / Enrollment DTOs, `StudentPickRow`, and validation constants
  (`VALID_CADENCES`, `MIN_DAY_OF_MONTH`, `MAX_BULK_ENROLL`, …).
- `apps/api/src/fees/fees.service.ts` — new helpers (`plans()`,
  `enrollments()`, `users()`), extended `ensureIndices()` with
  UNIQUE(academyId, programId) on plans and UNIQUE(academyId, planId,
  studentUserId) on enrollments, added:
    - `upsertPlan`, `getPlan`
    - `bulkEnroll`, `listEnrollments`, `setEnrollmentStatus`
    - `listStudentsForEnroll` (picker rows tagged with already-enrolled)
- `apps/api/src/fees/fees.controller.ts` — new routes:
    - `PUT /api/fees/programs/:id/plan`, `GET /api/fees/programs/:id/plan`
    - `POST /api/fees/enrollments`, `GET /api/fees/enrollments`
    - `POST /api/fees/enrollments/:id/{pause|resume|end}`
    - `GET /api/fees/plans/:id/students-for-enroll`

### Frontend
- `apps/web/src/lib/fees-api.ts` — extended client with all Plan +
  Enrollment methods + typed responses.
- `apps/web/src/pages/FeesProgramDetail.tsx` — the main W2 UI. Program
  header + 3-stat chips + heads list + plan panel (cadence picker with
  gradient CTA, month-day / due-offset / dates / late-grace inputs) +
  enrollments table with status chips + `EnrolModal` (search + multi-select
  + per-student greyed if already enrolled + discount%). All 4 states
  designed (loading skeleton, empty per-section, error, populated).
- `apps/web/src/main.tsx` — route `/fees/programs/:id`.

## Verification
- `npx tsc --noEmit` — clean on both apps for the fees files. No new errors.
- Preview rendered: `/tmp/fees-preview/detail.html` → `detail.png`.

## Design notes worth remembering
- **Plans are 1:1 with a program.** UNIQUE(academyId, programId) index on
  the plans collection enforces it — upsertPlan can be called repeatedly
  and idempotently updates the same row.
- **Discount is per-enrolment, not per-plan.** Sibling discount = a specific
  enrolment row carries `discountPct: 15`, sibling's carries `discountPct: 0`.
  Keeps the model flexible when a family decides to sponsor a friend's kid
  at the same discount.
- **Guardian = existing user with role='parent'.** `bulkEnroll` auto-picks
  the *first* parent from `student.parentIds`. When a student has two
  parents split across households, W3 will add "which parent is the payer"
  toggle on the enrollment row.
- **Enrol modal reads students from the users collection** —
  `academyId + role='student'` — so it picks up whatever roster the academy
  already has in ChessGuru. No import step.
- **TERM + CUSTOM cadences greyed as "soon"** — data model accepts them,
  UI hides them until installment generation lands in V2.

## Open items (W2b next)
- Invoice generation: `POST /api/fees/invoices/generate?planId=` + nightly
  cron scaffold (Nest `@Cron('0 2 * * *')`).
- Invoice PDF: Puppeteer + a React-PDF-ish HTML template with tenant
  branding pulled from the existing AcademyBranding schema.
- Invoice list UI + drawer + "Mark cash paid" action.
- Second in-day slice possible if the API can hit 25 invoices generated end
  to end.

## Deployment
Still not deployed — same status as W1. Merge branch first, decide on
ChessGuru v2 deploy path.
