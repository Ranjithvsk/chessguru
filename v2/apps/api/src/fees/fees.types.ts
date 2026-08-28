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
