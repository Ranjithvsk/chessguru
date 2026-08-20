// Thin fetch wrappers for /api/opening-trainer — the server-side analytics
// store for Opening Trainer drills. Feeds the student's stats strip on the
// trainer page + the coach's per-student compliance view (rollout step 1).

const BASE = (import.meta as any).env?.VITE_API_BASE ?? "";

async function jf<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${url}`, { credentials: "include", ...init });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.message || `${r.status}`);
  return j as T;
}

export interface DrillSessionPayload {
  slug: string;
  name: string;
  totalMoves: number;
  correctFirstTry: number;
  correctWithPeek: number;
  wrongAtLeastOnce: number;
  scorePct: number;
  durationMs?: number;
  isForceAssigned?: boolean;
}

export function postDrillSession(body: DrillSessionPayload): Promise<{ ok: boolean; id: string }> {
  return jf("/api/opening-trainer/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export interface TrainerRollup {
  heat: Array<{ day: string; sessions: number; moves: number; correctPct: number }>;
  totals: { sessions7: number; sessions30: number; moves7: number; moves30: number; allSessions: number };
  successPct7: number;
  successPct30: number;
  streak: number;
  uniqueOpenings30: number;
  forcedCompliance: { assigned: number; done: number; pct: number } | null;
}

export function getMyTrainerRollup(): Promise<TrainerRollup> {
  return jf("/api/opening-trainer/rollup/mine");
}
export function getStudentTrainerRollup(studentId: string): Promise<TrainerRollup> {
  return jf(`/api/opening-trainer/rollup/${encodeURIComponent(studentId)}`);
}
