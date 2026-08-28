// Fees module — shared TypeScript types + Mongo collection helpers.
//
// Design notes (from PROJECT_MASTER/plans/CHESSGURU-FEES-MVP.md §5):
//   * Every doc is scoped by academyId (tenant boundary).
//   * All money in PAISE (integer). Never floats. `1800` = ₹18.00, `180_000` = ₹1,800.
//   * Guardians are existing `users` rows (role='parent') — no separate collection.
//   * W1 scope: FeeProgram + FeeHead only. Enrollment / Invoice / Payment come in W2+.
//
// Collection names are `fees_*` prefixed to keep the Mongo shell/mongosh
// scannable — Fees data always groups together in `show collections`.

import type { ObjectId } from "mongodb";

export const COL = {
  programs: "fees_programs",
  heads: "fees_heads",
  plans: "fees_plans",           // scaffold — populated in W2
  enrollments: "fees_enrollments",
  invoices: "fees_invoices",
  payments: "fees_payments",
  paymentAllocs: "fees_payment_allocations",
  reminders: "fees_reminder_log",
  refunds: "fees_refunds",
  settings: "fees_settings",
  wallets: "fees_wallets",
  walletTxns: "fees_wallet_txns",
} as const;

export type ProgramStatus = "ACTIVE" | "ARCHIVED";
export type FeeHeadKind = "TUITION" | "EXAM" | "BOOK" | "LATE" | "OTHER";

/** A named collection of heads + a plan. E.g. "September 2026 Batch A". */
export interface FeeProgramDoc {
  _id: ObjectId;
  academyId: string;
  name: string;
  description?: string;
  currency: "INR";
  status: ProgramStatus;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;             // userId of the academy owner / fees admin
}

/** One line item on the future invoice. Multiple heads per program → they sum. */
export interface FeeHeadDoc {
  _id: ObjectId;
  academyId: string;
  programId: string;             // FeeProgramDoc._id as string
  name: string;
  amountPaise: number;
  kind: FeeHeadKind;
  gstPct?: number;               // null unless academy has GSTIN
  hsnSac?: string;
  order: number;                 // display order in invoices
  createdAt: Date;
  updatedAt: Date;
}

// -------- DTOs (request/response over HTTP) ----------------------------------

export interface CreateProgramInput {
  name: string;
  description?: string;
  heads?: Array<{
    name: string;
    amountPaise: number;
    kind: FeeHeadKind;
    gstPct?: number;
  }>;
}

export interface ProgramResponse {
  id: string;
  name: string;
  description?: string;
  currency: "INR";
  status: ProgramStatus;
  createdAt: string;
  updatedAt: string;
  headCount: number;
  totalPaise: number;            // sum of head amounts — a preview number for the list card
  heads?: HeadResponse[];        // included in single-program GET; omitted in list
}

export interface HeadResponse {
  id: string;
  name: string;
  amountPaise: number;
  kind: FeeHeadKind;
  gstPct?: number;
  hsnSac?: string;
  order: number;
}

// -------- Validation guardrails ----------------------------------------------

export const MAX_NAME_LEN = 80;
export const MAX_DESC_LEN = 400;
export const MAX_HEADS_PER_PROGRAM = 20;
export const MIN_AMOUNT_PAISE = 100;                // ₹1 — anything below is almost certainly a typo
export const MAX_AMOUNT_PAISE = 100 * 100_000;      // ₹1,00,000 per head — well above any realistic tuition line
export const VALID_KINDS: readonly FeeHeadKind[] = ["TUITION", "EXAM", "BOOK", "LATE", "OTHER"] as const;

// ============================================================================
// W2 — plans + enrollments
// ============================================================================

export type PlanCadence = "ONE_OFF" | "MONTHLY" | "TERM" | "CUSTOM";
export type EnrollmentStatus = "ACTIVE" | "PAUSED" | "ENDED";

/** A plan is 1:1 with a program for MVP. Governs when invoices are generated
 *  and when they're due. TERM installments come in V2 — MVP is MONTHLY-only in
 *  practice (ONE_OFF for camps / registration fees). */
export interface FeePlanDoc {
  _id: ObjectId;
  academyId: string;
  programId: string;                   // unique per program in MVP
  cadence: PlanCadence;
  dayOfMonth?: number;                 // 1-28 (MONTHLY only) — 29-31 skipped to avoid Feb edge cases
  dueOffsetDays: number;               // days from period start to due date (default 10)
  startOn: Date;
  endOn?: Date;                        // null = open-ended
  lateFeeGraceDays: number;            // default 7 — grace before late-fee cron fires
  lateFeeHeadId?: string;              // which head to auto-add on overdue > grace (V2)
  createdAt: Date;
  updatedAt: Date;
}

/** An enrolment is a student+guardian+plan tuple. Invoices derive from these.
 *  guardianUserId is the specific parent charged — a student may have 2 parents
 *  in users.parentIds but only one is the "payer" per enrolment. Not enforced
 *  in W2 UI (auto-picks the first parent) but the column is here for later. */
export interface FeeEnrollmentDoc {
  _id: ObjectId;
  academyId: string;
  planId: string;
  programId: string;                   // denormalised for cheaper queries
  studentUserId: string;               // users._id where role="student"
  guardianUserId?: string;             // users._id where role="parent"
  discountPct?: number;                // 0-100
  discountFlatPaise?: number;          // rupee flat off — mutually exclusive with pct in UI (backend accepts either)
  concessionReason?: string;
  startsOn: Date;
  endsOn?: Date;
  status: EnrollmentStatus;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;                   // userId of the enroller
}

// -------- Plan DTOs ----------------------------------------------------------

export interface UpsertPlanInput {
  cadence: PlanCadence;
  dayOfMonth?: number;
  dueOffsetDays?: number;
  startOn: string;                     // ISO date
  endOn?: string;
  lateFeeGraceDays?: number;
}

export interface PlanResponse {
  id: string;
  programId: string;
  cadence: PlanCadence;
  dayOfMonth?: number;
  dueOffsetDays: number;
  startOn: string;
  endOn?: string;
  lateFeeGraceDays: number;
  updatedAt: string;
}

// -------- Enrollment DTOs ----------------------------------------------------

export interface BulkEnrollInput {
  planId: string;
  studentUserIds: string[];
  discountPct?: number;
  discountFlatPaise?: number;
  concessionReason?: string;
  startsOn?: string;                   // defaults to today
}

export interface EnrollmentResponse {
  id: string;
  planId: string;
  programId: string;
  studentUserId: string;
  studentName?: string;                // populated on list; null on lean fetch
  guardianUserId?: string;
  guardianName?: string;
  guardianPhone?: string;
  discountPct?: number;
  discountFlatPaise?: number;
  concessionReason?: string;
  startsOn: string;
  endsOn?: string;
  status: EnrollmentStatus;
  createdAt: string;
}

// -------- Student helper (for enrolment picker) ------------------------------

/** Lightweight student record for the "pick who to enrol" UI. Not the full
 *  academy student — just what the picker needs. */
export interface StudentPickRow {
  id: string;
  name: string;
  username?: string;
  parentPhone?: string;                // first parent's mobile
  alreadyEnrolled: boolean;            // in the specific plan being enrolled into
}

// -------- Validation limits --------------------------------------------------

export const VALID_CADENCES: readonly PlanCadence[] = ["ONE_OFF", "MONTHLY", "TERM", "CUSTOM"] as const;
export const MIN_DAY_OF_MONTH = 1;
export const MAX_DAY_OF_MONTH = 28;
export const MAX_DUE_OFFSET_DAYS = 30;
export const MAX_LATE_GRACE_DAYS = 30;
export const MAX_BULK_ENROLL = 500;
export const MIN_DISCOUNT_PCT = 0;
export const MAX_DISCOUNT_PCT = 100;
