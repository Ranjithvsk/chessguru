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

export const feesApi = {
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
