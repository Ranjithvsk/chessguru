// Exams API client — coach-scheduled timed tests + student attempts.

const BASE = (import.meta as any).env?.VITE_API_BASE ?? "";

export interface ExamPosition {
  id: string;
  fenBefore: string;
  turnColor: "white" | "black";
  comment?: string;
  bookId?: string | null;
  bookChapterNumber?: number | null;
  order: number;
  // Owner-only fields (undefined in student view):
  studyId?: string;
  chapterId?: string;
  nodeId?: string;
  expectedUci?: string;
  expectedSan?: string;
}

export interface ExamSummary {
  _id: string;
  ownerId: string;
  academyId: string | null;
  title: string;
  description?: string;
  timePerPosSec: number | null;
  passMarkPct: number;
  retryable: boolean;
  assignedTo: string[];
  status: "draft" | "published" | "closed";
  dueAt: string | null;
  positions: ExamPosition[];
  createdAt: string;
  updatedAt: string;
}

export interface ExamListEntry extends ExamSummary {
  myStatus: "not_started" | "in_progress" | "done";
  myBestScorePct: number | null;
  myAttempts: number;
}

export interface AttemptAnswer {
  positionId: string;
  playedUci: string | null;
  playedSan: string | null;
  correct: boolean;
  timeSpentMs: number;
}

export interface Attempt {
  _id: string;
  examId: string;
  userId: string;
  attemptNumber: number;
  startedAt: string;
  submittedAt: string | null;
  answers: AttemptAnswer[];
  score: number;
  totalPositions: number;
  scorePct: number;
  passed: boolean;
  user?: { _id: string; username: string; name?: string };
}

export interface Results {
  role: "owner" | "student";
  exam: ExamSummary;
  attempts: Attempt[];
  perPosition?: { id: string; expectedSan: string; chapterId: string; studyId: string; missCount: number }[];
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

export const examsApi = {
  list: () => req<{ owned: ExamListEntry[]; assigned: ExamListEntry[] }>("GET", "/api/exams"),
  pickableStudents: () => req<{ items: { _id: string; username: string; name?: string; role: string }[] }>("GET", "/api/exams/pickable-students"),
  create: (body: { title?: string; description?: string; timePerPosSec?: number | null; passMarkPct?: number; retryable?: boolean }) =>
    req<{ examId: string }>("POST", "/api/exams", body),
  get: (id: string) => req<{ exam: ExamSummary; role: "owner" | "student" }>("GET", `/api/exams/${encodeURIComponent(id)}`),
  updateMeta: (id: string, body: Partial<ExamSummary>) => req<{ ok: boolean }>("PATCH", `/api/exams/${encodeURIComponent(id)}`, body),
  addFromStudy: (id: string, sid: string) => req<{ ok: boolean; added: number }>("POST", `/api/exams/${encodeURIComponent(id)}/positions/from-study/${encodeURIComponent(sid)}`, {}),
  removePosition: (id: string, pid: string) => req<{ ok: boolean }>("DELETE", `/api/exams/${encodeURIComponent(id)}/positions/${encodeURIComponent(pid)}`),
  publish: (id: string, body: { dueAt?: string | null }) => req<{ ok: boolean }>("POST", `/api/exams/${encodeURIComponent(id)}/publish`, body),
  close: (id: string) => req<{ ok: boolean }>("POST", `/api/exams/${encodeURIComponent(id)}/close`, {}),
  remove: (id: string) => req<{ ok: boolean }>("DELETE", `/api/exams/${encodeURIComponent(id)}`),
  startAttempt: (id: string) => req<{ attemptId: string; attemptNumber: number; resumed: boolean }>("POST", `/api/exams/${encodeURIComponent(id)}/attempts/start`, {}),
  answer: (id: string, aid: string, body: { positionId: string; playedUci: string | null; playedSan: string | null; timeSpentMs: number }) =>
    req<{ ok: boolean; correct?: boolean; expectedSan?: string; expectedUci?: string; alreadyAnswered?: boolean }>("POST", `/api/exams/${encodeURIComponent(id)}/attempts/${encodeURIComponent(aid)}/answer`, body),
  finish: (id: string, aid: string) => req<{ ok: boolean; score?: number; total?: number; scorePct?: number; passed?: boolean; alreadySubmitted?: boolean }>("POST", `/api/exams/${encodeURIComponent(id)}/attempts/${encodeURIComponent(aid)}/finish`, {}),
  results: (id: string) => req<Results>("GET", `/api/exams/${encodeURIComponent(id)}/results`),
};
