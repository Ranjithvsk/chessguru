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
  pdfUrl?: string;
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
  coverImageUrl?: string;
  pdfUrl?: string;
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

  /** Search the owner's real library on the Vinayaka host — thousands of books,
   *  not the handful already attached here. Server-side so the 1.2 MB
   *  catalogue (and the Drive paths in it) never reach the browser. */
  librarySearch: (q: string, limit = 25) =>
    req<{ items: Array<{ id: string; title: string; author: string; shelf: string }>; total: number }>(
      "GET", `/api/books/library/search?q=${encodeURIComponent(q)}&limit=${limit}`),

  /** Attach a library book so a study can point at it. Idempotent — the same
   *  library book always resolves to the same row. */
  adoptLibrary: (hostId: string) =>
    req<{ bookId: string; reused: boolean; chapters?: number }>("POST", "/api/books/library/adopt", { hostId }),
  get: (id: string) => req<{ book: Book; progress: BookProgress }>("GET", `/api/books/${encodeURIComponent(id)}`),
  create: (body: { title: string; author?: string; publisher?: string; year?: number; chapters?: BookChapter[] }) =>
    req<{ bookId: string }>("POST", "/api/books", body),
  update: (id: string, body: Partial<Book>) => req<{ ok: boolean }>("PATCH", `/api/books/${encodeURIComponent(id)}`, body),
  remove: (id: string) => req<{ ok: boolean }>("DELETE", `/api/books/${encodeURIComponent(id)}`),
  markDone: (id: string, ch: number) => req<{ ok: boolean }>("POST", `/api/books/${encodeURIComponent(id)}/progress/${ch}`),
  unmark: (id: string, ch: number) => req<{ ok: boolean }>("DELETE", `/api/books/${encodeURIComponent(id)}/progress/${ch}`),
};
