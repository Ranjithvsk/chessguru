// Coach Class Board API client.

const BASE = (import.meta as any).env?.VITE_API_BASE ?? "";

export interface StudentRow {
  userId: string;
  username: string;
  name?: string;
  role: string;
  assignedCoachId?: string;
  gamesAnalyzed: number;
  blunders: number;
  mistakes: number;
  inaccuracies: number;
  topWeakness?: { tag: string; label: string; count: number };
  reviseDueNow: number;
  reviseStreak: number;
  bestExamPct: number | null;
  booksInProgress: number;
  lastGameAt: string | null;
  health: "green" | "amber" | "red";
  healthReason: string;
}

export interface ClassWeakness {
  tag: string;
  label: string;
  studentsAffected: number;
  totalOccurrences: number;
}

export interface ClassBoard {
  academyId: string;
  studentCount: number;
  students: StudentRow[];
  classWeaknesses: ClassWeakness[];
}

export interface ClassPlanExampleGame {
  studentId: string;
  studentName: string;
  gameId: string;
  ply: number;
  san: string;
  bestSan: string | null;
  fenBefore: string;
  explanation?: string;
}

export interface ClassPlan {
  tag: string;
  label: string;
  studentsAffected: number;
  warmUp: { theme: string; puzzleCount: number };
  teach: { books: { bookId: string; title: string; author: string; chapters: { number: number; title: string }[] }[] };
  demoPositions: ClassPlanExampleGame[];
  practice: { studyIds: string[] };
  homework: { puzzleTheme: string; targetCount: number };
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

export const coachBoardApi = {
  board: () => req<ClassBoard>("GET", "/api/coach-board"),
  plan: (tag: string) => req<ClassPlan>("GET", `/api/coach-board/plan/${encodeURIComponent(tag)}`),
};
