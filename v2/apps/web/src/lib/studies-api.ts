// Studies (user-created) API client. Mirrors the shape of studies.service on
// the backend. Kept in its own file so the main api.ts stays uncluttered.

const BASE = (import.meta as any).env?.VITE_API_BASE ?? "";

export type Intent = "game" | "puzzle" | "concept" | "opening" | "endgame" | "notebook" | "book";
export type Visibility = "private" | "shared" | "academy" | "public";

export interface SourceBook {
  bookId: string;
  chapterNumber?: number;
  topicTags?: string[];
}

export interface Shape {
  brush: "green" | "red" | "blue" | "yellow";
  orig: string;
  dest?: string;
}

export interface MoveNode {
  id: string;
  parentId: string | null;
  ply: number;
  san: string;
  uci: string;
  fenAfter: string;
  comment?: string;
  nag?: number;
  shapes?: Shape[];
  isRevisePoint?: boolean;
  isMainLine: boolean;
}

export interface StudySummary {
  _id: string;
  ownerId: string;
  academyId: string | null;
  title: string;
  intent: Intent;
  visibility: Visibility;
  sharedWithUserIds: string[];
  chapterCount: number;
  sourceBook?: SourceBook;
  createdAt: string;
  updatedAt: string;
}

export interface ChapterSummary {
  _id: string;
  studyId: string;
  order: number;
  title: string;
  startingFen: string;
  createdAt: string;
  updatedAt: string;
}

export interface Chapter extends ChapterSummary {
  moves: MoveNode[];
  headers?: Record<string, string>;
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

export const studiesApi = {
  list: () => req<{ items: StudySummary[] }>("GET", "/api/studies"),

  create: (body: {
    title?: string; intent?: Intent; visibility?: Visibility;
    startingFen?: string; pgn?: string; chapterTitle?: string;
    sourceBook?: SourceBook;
  }) => req<{ studyId: string; chapterId: string }>("POST", "/api/studies", body),

  get: (sid: string) =>
    req<{ study: StudySummary; chapters: ChapterSummary[] }>("GET", `/api/studies/${encodeURIComponent(sid)}`),

  updateMeta: (sid: string, body: { title?: string; visibility?: Visibility; sharedWithUserIds?: string[]; sourceBook?: SourceBook | null }) =>
    req<{ ok: boolean }>("PATCH", `/api/studies/${encodeURIComponent(sid)}`, body),

  remove: (sid: string) => req<{ ok: boolean }>("DELETE", `/api/studies/${encodeURIComponent(sid)}`),

  addChapter: (sid: string, body: { title?: string; startingFen?: string; pgn?: string }) =>
    req<{ chapterId: string }>("POST", `/api/studies/${encodeURIComponent(sid)}/chapters`, body),

  getChapter: (sid: string, cid: string) =>
    req<Chapter>("GET", `/api/studies/${encodeURIComponent(sid)}/chapters/${encodeURIComponent(cid)}`),

  saveChapter: (sid: string, cid: string, body: {
    title?: string; startingFen?: string; moves?: MoveNode[]; headers?: Record<string, string>;
  }) => req<{ ok: boolean }>("PATCH", `/api/studies/${encodeURIComponent(sid)}/chapters/${encodeURIComponent(cid)}`, body),

  deleteChapter: (sid: string, cid: string) =>
    req<{ ok: boolean }>("DELETE", `/api/studies/${encodeURIComponent(sid)}/chapters/${encodeURIComponent(cid)}`),
};
