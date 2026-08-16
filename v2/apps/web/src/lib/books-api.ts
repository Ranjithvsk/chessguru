// Books library API client. Companion to studies-api.ts.

const BASE = (import.meta as any).env?.VITE_API_BASE ?? "";

export interface BookChapter {
  number: number;
  title: string;
  tags: string[];
}

export interface Book {
  _id: string;
  title: string;
  author: string;
  publisher?: string;
  year?: number;
  coverImageUrl?: string;
  chapters: BookChapter[];
  isSeeded: boolean;
  addedByUserId?: string;
}

export interface BookSummary {
  _id: string;
  title: string;
  author: string;
  publisher?: string;
  year?: number;
  isSeeded: boolean;
}

export interface BookProgress {
  userId: string;
  bookId: string;
  chaptersCompleted: number[];
  studiesLinked: string[];
  notes?: string;
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

export const booksApi = {
  list: () => req<{ items: BookSummary[] }>("GET", "/api/books"),
  get: (id: string) => req<{ book: Book; progress: BookProgress }>("GET", `/api/books/${encodeURIComponent(id)}`),
  create: (body: { title: string; author: string; publisher?: string; year?: number; chapters: BookChapter[] }) =>
    req<{ bookId: string }>("POST", "/api/books", body),
  update: (id: string, body: Partial<Book>) => req<{ ok: boolean }>("PATCH", `/api/books/${encodeURIComponent(id)}`, body),
  remove: (id: string) => req<{ ok: boolean }>("DELETE", `/api/books/${encodeURIComponent(id)}`),
  markDone: (id: string, ch: number) => req<{ ok: boolean }>("POST", `/api/books/${encodeURIComponent(id)}/progress/${ch}`),
  unmark: (id: string, ch: number) => req<{ ok: boolean }>("DELETE", `/api/books/${encodeURIComponent(id)}/progress/${ch}`),
};
