// Parent Reports API client.

const BASE = (import.meta as any).env?.VITE_API_BASE ?? "";

export interface ReportData {
  student: { userId: string; username: string; name?: string; role: string };
  period: { start: string; end: string };
  rating: { current: number | null; change: number | null; historyPoints: number; history?: number[] };
  games: { played: number; won: number; drawn: number; lost: number };
  puzzles: { solved: number };
  revision: { longestStreak: number; totalCards: number };
  weaknesses: { tag: string; label: string; count: number }[];
  studies: { studyId: string; title: string; chapterCount: number }[];
  books: { bookId: string; title: string; chaptersDoneInPeriod: number; totalDone: number; totalChapters: number }[];
  exams: { examId: string; title: string; scorePct: number; passed: boolean }[];
}

export interface Report {
  _id: string;
  ownerId: string;
  academyId: string;
  studentId: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  data: ReportData;
  coachNote?: string;
  parentEmail?: string;
  sentAt?: string;
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method,
    credentials: "include",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    let msg = `${method} ${path} → ${r.status}`;
    try { const j = await r.json(); if (j?.message) msg = String(j.message); } catch { /* ignore */ }
    throw new Error(msg);
  }
  return r.json() as Promise<T>;
}

export const parentReportsApi = {
  preview: (body: { studentId: string; periodStart?: string; periodEnd?: string }) =>
    req<ReportData>("POST", "/api/parent-reports/preview", body),
  // Self-scoped (current logged-in user, no coach check needed).
  previewSelf: (body: { periodStart?: string; periodEnd?: string }) =>
    req<ReportData>("POST", "/api/parent-reports/preview-self", body),
  save: (body: { studentId: string; periodStart?: string; periodEnd?: string; coachNote?: string; parentEmail?: string }) =>
    req<{ reportId: string }>("POST", "/api/parent-reports", body),
  list: (studentId?: string) =>
    req<{ items: Report[] }>("GET", `/api/parent-reports${studentId ? `?studentId=${encodeURIComponent(studentId)}` : ""}`),
  get: (id: string) => req<Report>("GET", `/api/parent-reports/${encodeURIComponent(id)}`),
  updateMeta: (id: string, body: { coachNote?: string; parentEmail?: string }) =>
    req<{ ok: boolean }>("PATCH", `/api/parent-reports/${encodeURIComponent(id)}`, body),
  markSent: (id: string) => req<{ ok: boolean }>("POST", `/api/parent-reports/${encodeURIComponent(id)}/send`, {}),
  remove: (id: string) => req<{ ok: boolean }>("DELETE", `/api/parent-reports/${encodeURIComponent(id)}`),
};
