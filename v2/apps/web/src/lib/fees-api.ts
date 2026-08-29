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

// ---- W2b types -------------------------------------------------------------

export type InvoiceStatus = "DRAFT" | "SENT" | "PARTIAL" | "PAID" | "OVERDUE" | "WAIVED" | "CANCELLED";
export type PaymentMethod = "UPI" | "CARD" | "CASH" | "BANK" | "WALLET" | "OFFSET";
export type PaymentStatus = "PENDING" | "CAPTURED" | "FAILED" | "REFUNDED";

export interface InvoiceLineResponse {
  headId?: string;
  name: string;
  amountPaise: number;
  kind: FeeHeadKind;
  gstPct?: number;
}

export interface InvoiceResponse {
  id: string;
  invoiceNo: string;
  enrollmentId: string;
  planId: string;
  programId: string;
  programName?: string;
  studentUserId: string;
  studentName?: string;
  guardianUserId?: string;
  guardianName?: string;
  guardianPhone?: string;
  periodStart: string;
  periodEnd: string;
  lines: InvoiceLineResponse[];
  subtotalPaise: number;
  discountPaise: number;
  taxPaise: number;
  totalPaise: number;
  paidPaise: number;
  balancePaise: number;
  dueOn: string;
  status: InvoiceStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  paidAt?: string;
  waivedAt?: string;
  waivedReason?: string;
  cancelledAt?: string;
}

export interface PaymentResponse {
  id: string;
  guardianUserId?: string;
  amountPaise: number;
  method: PaymentMethod;
  pgProvider: "razorpay" | "paytm" | "manual";
  status: PaymentStatus;
  receiptNo: string;
  capturedAt?: string;
  note?: string;
  createdAt: string;
  allocations: Array<{ invoiceId: string; invoiceNo?: string; amountPaise: number }>;
}

export interface RecordManualPaymentInput {
  invoiceIds: string[];
  amountPaise: number;
  method: "CASH" | "BANK" | "UPI";
  capturedOn?: string;
  note?: string;
}

// ---- W3-lite: dashboard + reminders ---------------------------------------

export type ReminderChannel = "WHATSAPP" | "SMS" | "EMAIL";
export type ReminderTemplate = "FEE_DUE" | "FEE_OVERDUE" | "PAYMENT_ACK";

export interface DashboardResponse {
  currency: "INR";
  now: string;
  monthLabel: string;
  collectedMonthPaise: number;
  overdueCountInvoices: number;
  overdueBalancePaise: number;
  expectedNext7dPaise: number;
  totalActiveEnrollments: number;
  topDefaulters: Array<{
    guardianUserId?: string;
    guardianName?: string;
    guardianPhone?: string;
    studentNames: string[];
    invoiceCount: number;
    outstandingPaise: number;
    oldestDueOn: string;
  }>;
  recentPayments: Array<{
    id: string;
    amountPaise: number;
    method: PaymentMethod;
    receiptNo: string;
    guardianName?: string;
    capturedAt: string;
    invoiceNos: string[];
  }>;
  collectionByDay: Array<{ day: string; collectedPaise: number }>;
  lastReminderAt: string | null;
}

export interface ReminderTextResponse {
  waLink: string;
  text: string;
  template: ReminderTemplate;
  channel: ReminderChannel;
  guardianPhone?: string;
  guardianName?: string;
}

export interface LogReminderInput {
  invoiceId?: string;
  guardianUserId?: string;
  channel: ReminderChannel;
  template?: ReminderTemplate;
}

// ---- W4b: parent portal + Razorpay ----------------------------------------

export interface PortalInvoiceLine {
  id: string;
  invoiceNo: string;
  studentName?: string;
  programName?: string;
  periodLabel: string;
  totalPaise: number;
  paidPaise: number;
  balancePaise: number;
  dueOn: string;
  status: InvoiceStatus;
  overdue: boolean;
}

export interface PortalResponse {
  guardianName: string;
  guardianPhone?: string;
  academyName: string;
  academyTagline?: string;
  invoices: PortalInvoiceLine[];
  currency: "INR";
  totalOutstandingPaise: number;
  razorpayAvailable: boolean;
}

export interface CheckoutOrderResponse {
  razorpayKeyId: string;
  razorpayOrderId: string;
  amountPaise: number;
  currency: "INR";
  guardianName?: string;
  guardianPhone?: string;
  invoiceIds: string[];
  academyName: string;
}

export const portalApi = {
  view: (token: string, guardianUserId: string, academyId: string) =>
    req<PortalResponse>(`/api/fees/portal/${encodeURIComponent(token)}?g=${encodeURIComponent(guardianUserId)}&a=${encodeURIComponent(academyId)}`),

  checkout: (token: string, guardianUserId: string, academyId: string, invoiceIds: string[]) =>
    req<CheckoutOrderResponse>(
      `/api/fees/portal/${encodeURIComponent(token)}/checkout?g=${encodeURIComponent(guardianUserId)}&a=${encodeURIComponent(academyId)}`,
      { method: "POST", body: JSON.stringify({ invoiceIds }) },
    ),

  payments: (token: string, guardianUserId: string, academyId: string) =>
    req<{ payments: Array<{ id: string; receiptNo: string; amountPaise: number; method: PaymentMethod; capturedAt: string; invoiceNos: string[] }> }>(
      `/api/fees/portal/${encodeURIComponent(token)}/payments?g=${encodeURIComponent(guardianUserId)}&a=${encodeURIComponent(academyId)}`,
    ),
};

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

  // ---- invoices --------------------------------------------------
  generateInvoices: (planId: string, upToDate?: string) =>
    req<{ created: number; skipped: number }>(`/api/fees/invoices/generate`, {
      method: "POST",
      body: JSON.stringify({ planId, upToDate }),
    }),
  listInvoices: (opts: { status?: InvoiceStatus; planId?: string; programId?: string; guardianUserId?: string; overdueOnly?: boolean } = {}) => {
    const p = new URLSearchParams();
    if (opts.status) p.set("status", opts.status);
    if (opts.planId) p.set("planId", opts.planId);
    if (opts.programId) p.set("programId", opts.programId);
    if (opts.guardianUserId) p.set("guardianUserId", opts.guardianUserId);
    if (opts.overdueOnly) p.set("overdueOnly", "1");
    const qs = p.toString();
    return req<{ invoices: InvoiceResponse[] }>(`/api/fees/invoices${qs ? `?${qs}` : ""}`);
  },
  getInvoice: (id: string) =>
    req<{ invoice: InvoiceResponse; payments: PaymentResponse[] }>(`/api/fees/invoices/${encodeURIComponent(id)}`),
  waiveInvoice: (id: string, reason: string) =>
    req<{ ok: true }>(`/api/fees/invoices/${encodeURIComponent(id)}/waive`, { method: "POST", body: JSON.stringify({ reason }) }),
  cancelInvoice: (id: string) =>
    req<{ ok: true }>(`/api/fees/invoices/${encodeURIComponent(id)}/cancel`, { method: "POST" }),

  // ---- payments (manual) -----------------------------------------
  recordManualPayment: (input: RecordManualPaymentInput) =>
    req<{ payment: PaymentResponse; leftoverPaise: number }>(`/api/fees/payments/manual`, { method: "POST", body: JSON.stringify(input) }),

  // ---- PDF URLs (browser opens directly, cookies auth in-flight) -
  invoicePdfUrl: (id: string) => `${BASE}/api/fees/invoices/${encodeURIComponent(id)}/pdf`,
  receiptPdfUrl: (paymentId: string) => `${BASE}/api/fees/payments/${encodeURIComponent(paymentId)}/receipt.pdf`,

  // ---- W3-lite: dashboard + reminders --------------------------
  dashboard: () => req<DashboardResponse>(`/api/fees/dashboard`),
  reminderText: (invoiceId: string, channel: ReminderChannel = "WHATSAPP") =>
    req<ReminderTextResponse>(`/api/fees/invoices/${encodeURIComponent(invoiceId)}/reminder-text?channel=${channel}`),
  logReminder: (input: LogReminderInput) =>
    req<{ ok: true; alreadyToday: boolean }>(`/api/fees/reminders`, { method: "POST", body: JSON.stringify(input) }),
};

// ---- invoice-status meta (labels + colour classes) -----------------------

export const INVOICE_STATUS_META: Record<InvoiceStatus, { label: string; ring: string; dot: string }> = {
  DRAFT:     { label: "draft",       ring: "bg-ink-800 text-ink-400 ring-ink-700",                       dot: "bg-ink-500" },
  SENT:      { label: "sent",        ring: "bg-brand-500/15 text-brand-300 ring-brand-400/30",           dot: "bg-brand-400" },
  PARTIAL:   { label: "partial",     ring: "bg-gold-500/15 text-gold-400 ring-gold-400/30",              dot: "bg-gold-400" },
  PAID:      { label: "paid",        ring: "bg-accent-500/15 text-accent-400 ring-accent-400/30",        dot: "bg-accent-400" },
  OVERDUE:   { label: "overdue",     ring: "bg-red-500/15 text-red-300 ring-red-400/30",                 dot: "bg-red-400" },
  WAIVED:    { label: "waived",      ring: "bg-ink-800 text-ink-400 ring-ink-700",                       dot: "bg-ink-500" },
  CANCELLED: { label: "cancelled",   ring: "bg-ink-800 text-ink-400 ring-ink-700",                       dot: "bg-ink-500" },
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
