// Insights API client — weakness dashboard + prescriptions.

const BASE = (import.meta as any).env?.VITE_API_BASE ?? "";

export interface Prescription {
  books: {
    bookId: string; title: string; author: string;
    chapters: { number: number; title: string; done: boolean; tags: string[] }[];
  }[];
  puzzleThemes: { theme: string; puzzleCount: number }[];
  studies: { studyId: string; title: string }[];
}

export interface Weakness {
  tag: string;
  label: string;
  count: number;
  severity: "high" | "medium" | "low";
  exampleGames: { gameId: string; ply: number; san: string; bestSan: string | null; explanation?: string }[];
  prescriptions: Prescription;
}

export interface InsightsSummary {
  userId: string;
  gamesAnalyzed: number;
  totalBlunders: number;
  totalMistakes: number;
  totalInaccuracies: number;
  weaknesses: Weakness[];
  updatedAt: string;
}

async function req<T>(method: string, path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { method, credentials: "include" });
  if (!r.ok) {
    let msg = `${method} ${path} → ${r.status}`;
    try { const j = await r.json(); if (j?.message) msg = String(j.message); } catch { /* ignore */ }
    throw new Error(msg);
  }
  return r.json() as Promise<T>;
}

export const insightsApi = {
  mine: () => req<InsightsSummary>("GET", "/api/insights/me"),
  forStudent: (userId: string) => req<InsightsSummary>("GET", `/api/insights/students/${encodeURIComponent(userId)}`),
};
