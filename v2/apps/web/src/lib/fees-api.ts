// Fees API client (W1 scope: programs + heads).
// Server: apps/api/src/fees — see PROJECT_MASTER/plans/CHESSGURU-FEES-MVP.md §6.
//
// All money is in PAISE (integer). Multiply by 100 when a user types rupees.

const BASE = (import.meta as { env?: { VITE_API_BASE?: string } }).env?.VITE_API_BASE ?? "";

export type FeeHeadKind = "TUITION" | "EXAM" | "BOOK" | "LATE" | "OTHER";

export interface HeadResponse {
  id: string;
  name: string;
  amountPaise: number;
  kind: FeeHeadKind;
  gstPct?: number;
  hsnSac?: string;
  order: number;
}

export interface ProgramResponse {
  id: string;
  name: string;
  description?: string;
  currency: "INR";
  status: "ACTIVE" | "ARCHIVED";
  createdAt: string;
  updatedAt: string;
  headCount: number;
  totalPaise: number;
  heads?: HeadResponse[];
}

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

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await r.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!r.ok) {
    const msg = (body && typeof body === "object" && "message" in body && typeof (body as { message: unknown }).message === "string")
      ? (body as { message: string }).message
      : `Request failed (${r.status}).`;
    throw new Error(msg);
  }
  return (body ?? {}) as T;
}

export type PlanCadence = "ONE_OFF" | "MONTHLY" | "TERM" | "CUSTOM";
export type EnrollmentStatus = "ACTIVE" | "PAUSED" | "ENDED";

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

export interface UpsertPlanInput {
  cadence: PlanCadence;
  dayOfMonth?: number;
  dueOffsetDays?: number;
  startOn: string;                     // ISO YYYY-MM-DD
  endOn?: string;
  lateFeeGraceDays?: number;
}

export interface EnrollmentResponse {
  id: string;
  planId: string;
  programId: string;
  studentUserId: string;
  studentName?: string;
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

export interface BulkEnrollInput {
  planId: string;
  studentUserIds: string[];
  discountPct?: number;
  discountFlatPaise?: number;
  concessionReason?: string;
  startsOn?: string;
}

export interface StudentPickRow {
  id: string;
  name: string;
  username?: string;
  parentPhone?: string;
  alreadyEnrolled: boolean;
}

export const feesApi = {
  // ---- programs ------------------------------------------------------------
  listPrograms: (opts: { status?: "ACTIVE" | "ARCHIVED"; q?: string } = {}) => {
    const p = new URLSearchParams();
    if (opts.status) p.set("status", opts.status);
    if (opts.q) p.set("q", opts.q);
    const qs = p.toString();
    return req<{ programs: ProgramResponse[] }>(`/api/fees/programs${qs ? `?${qs}` : ""}`);
  },
  getProgram: (id: string) => req<ProgramResponse>(`/api/fees/programs/${encodeURIComponent(id)}`),
  createProgram: (input: CreateProgramInput) =>
    req<ProgramResponse>(`/api/fees/programs`, { method: "POST", body: JSON.stringify(input) }),
  archiveProgram: (id: string) =>
    req<{ ok: true }>(`/api/fees/programs/${encodeURIComponent(id)}/archive`, { method: "POST" }),

  // ---- plans (1:1 with program) -------------------------------------------
  getPlan: (programId: string) =>
    req<{ plan: PlanResponse | null }>(`/api/fees/programs/${encodeURIComponent(programId)}/plan`),
  upsertPlan: (programId: string, input: UpsertPlanInput) =>
    req<PlanResponse>(`/api/fees/programs/${encodeURIComponent(programId)}/plan`, { method: "PUT", body: JSON.stringify(input) }),

  // ---- enrollments --------------------------------------------------------
  listEnrollments: (opts: { planId?: string; studentUserId?: string; status?: EnrollmentStatus } = {}) => {
    const p = new URLSearchParams();
    if (opts.planId) p.set("planId", opts.planId);
    if (opts.studentUserId) p.set("studentUserId", opts.studentUserId);
    if (opts.status) p.set("status", opts.status);
    const qs = p.toString();
    return req<{ enrollments: EnrollmentResponse[] }>(`/api/fees/enrollments${qs ? `?${qs}` : ""}`);
  },
  bulkEnroll: (input: BulkEnrollInput) =>
    req<{ enrolled: number; skipped: number; enrollments: EnrollmentResponse[] }>(`/api/fees/enrollments`, { method: "POST", body: JSON.stringify(input) }),
  pauseEnrollment:  (id: string) => req<{ ok: true }>(`/api/fees/enrollments/${encodeURIComponent(id)}/pause`,  { method: "POST" }),
  resumeEnrollment: (id: string) => req<{ ok: true }>(`/api/fees/enrollments/${encodeURIComponent(id)}/resume`, { method: "POST" }),
  endEnrollment:    (id: string) => req<{ ok: true }>(`/api/fees/enrollments/${encodeURIComponent(id)}/end`,    { method: "POST" }),

  studentsForEnroll: (planId: string) =>
    req<{ students: StudentPickRow[] }>(`/api/fees/plans/${encodeURIComponent(planId)}/students-for-enroll`),
};

// ---- format helpers -------------------------------------------------------

/** paise → ₹ string, locale en-IN (lakh grouping). */
export function fmtRupees(paise: number): string {
  const r = paise / 100;
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: r % 1 === 0 ? 0 : 2 }).format(r);
}

/** user types "1800" → 180_000 paise. Accepts 1800, 1,800, ₹1,800, 1800.50. */
export function parseRupeesInput(v: string): number | null {
  const cleaned = v.replace(/[₹,\s]/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}
