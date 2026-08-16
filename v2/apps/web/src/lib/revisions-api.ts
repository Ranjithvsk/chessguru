// Revision queue API client — spaced-repetition drill of ⭐-flagged positions.

const BASE = (import.meta as any).env?.VITE_API_BASE ?? "";

export type Grade = "again" | "hard" | "good" | "easy";

export interface RevisionItem {
  _id: string;
  userId: string;
  studyId: string;
  chapterId: string;
  nodeId: string;
  bookId?: string | null;
  bookChapterNumber?: number | null;
  studyTitle: string;
  chapterTitle: string;
  fenBefore: string;
  expectedUci: string;
  expectedSan: string;
  turnColor: "white" | "black";
  interval: number;
  ease: number;
  streak: number;
  reps: number;
  lapses: number;
  dueAt: string;
  lastReviewedAt: string | null;
}

export interface RevisionStats {
  dueNow: number;
  dueNext24h: number;
  total: number;
  longestStreak: number;
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

export const revisionsApi = {
  queue: (limit = 30) => req<{ items: RevisionItem[]; now: string }>("GET", `/api/revisions/queue?limit=${limit}`),
  stats: () => req<RevisionStats>("GET", "/api/revisions/stats"),
  review: (body: { chapterId: string; nodeId: string; grade: Grade }) =>
    req<{ ok: boolean; interval: number; ease: number; streak: number; dueAt: string }>("POST", "/api/revisions/review", body),
  addStudy: (sid: string) => req<{ ok: boolean; added: number }>("POST", `/api/revisions/study/${encodeURIComponent(sid)}/add`),
};
