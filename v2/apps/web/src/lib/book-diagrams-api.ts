// Book-diagram annotations API client.

const BASE = (import.meta as any).env?.VITE_API_BASE ?? "";

export interface Diagram {
  _id: string;
  bookSlug: string;
  page: number;
  bbox: [number, number, number, number];
  fen: string;
  side: "w" | "b";
  label?: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface AnnotateResult {
  ok: boolean;
  fen: string | null;
  fenIsValid: boolean;
  side: "w" | "b";
  warpQuality: number;
  boardPngBase64: string | null;
  backend?: string;
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

export const bookDiagramsApi = {
  annotate: (imageBase64: string) => req<AnnotateResult>("POST", "/api/book-diagrams/annotate", { imageBase64 }),
  list: (bookSlug: string) => req<{ items: Diagram[] }>("GET", `/api/book-diagrams?bookSlug=${encodeURIComponent(bookSlug)}`),
  create: (body: { bookSlug: string; page: number; bbox: [number, number, number, number]; fen: string; label?: string }) =>
    req<{ diagramId: string }>("POST", "/api/book-diagrams", body),
  update: (id: string, body: { fen?: string; label?: string; bbox?: [number, number, number, number] }) =>
    req<{ ok: boolean }>("PATCH", `/api/book-diagrams/${encodeURIComponent(id)}`, body),
  remove: (id: string) => req<{ ok: boolean }>("DELETE", `/api/book-diagrams/${encodeURIComponent(id)}`),
};
