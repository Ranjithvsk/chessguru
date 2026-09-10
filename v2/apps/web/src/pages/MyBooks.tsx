// "My Books" — the shelf. Every book the vision pipeline has read, with what it
// found in each.
//
// This page existed only as a URL you had to type: the reader at
// /books/read/:id worked, but nothing listed what was on the shelf, so a book
// that had been ingested was invisible unless you already knew its id.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

const API_BASE = (import.meta as any).env?.VITE_API_BASE ?? "";

type Book = {
  id: string; title: string; pages: number; diagrams: number;
  state: string; done: number;
};

export default function MyBooksPage() {
  const [books, setBooks] = useState<Book[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    const load = async () => {
      try {
        const r = await fetch(`${API_BASE}/api/user-books`, { credentials: "include" });
        if (r.status === 401) throw new Error("Please sign in to see your books.");
        if (!r.ok) throw new Error("Could not load your books.");
        const j = await r.json();
        if (!dead) setBooks(j.books ?? []);
      } catch (e) { if (!dead) setErr((e as Error).message); }
    };
    load();
    // A book being read updates as it goes, so refresh while any is unfinished.
    const t = setInterval(load, 5000);
    return () => { dead = true; clearInterval(t); };
  }, []);

  if (err) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center">
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6 text-rose-100">{err}</div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-6 rounded-2xl bg-gradient-to-r from-brand-600/25 via-fuchsia-600/10 to-transparent p-5 ring-1 ring-brand-500/20">
        <h1 className="text-xl font-bold text-ink-50">📖 My Books</h1>
        <p className="mt-1 text-sm text-ink-300">
          Books read by the vision pipeline. Tap one, then tap any diagram to put it on a board.
        </p>
        <Link
          to="/books/library"
          className="mt-3 inline-block rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500"
        >
          Browse the library →
        </Link>
      </div>

      {books === null && (
        <div className="py-16 text-center text-ink-400">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
          Loading your shelf…
        </div>
      )}

      {books?.length === 0 && (
        <div className="rounded-2xl border border-ink-700 bg-ink-900 p-10 text-center">
          <div className="text-4xl">📚</div>
          <p className="mt-3 text-ink-200">No books read yet.</p>
          <p className="mt-1 text-sm text-ink-400">Once a book is ingested it appears here.</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(books ?? []).map((b) => {
          const busy = b.state !== "done";
          const pct = b.pages ? Math.round((100 * b.done) / b.pages) : 0;
          return (
            <Link
              key={b.id}
              to={`/books/read/${encodeURIComponent(b.id)}`}
              className="group rounded-2xl border border-ink-700 bg-ink-900 p-4 transition hover:border-brand-500/60 hover:bg-ink-800"
            >
              {/* The real front cover, not an emoji. Page 0 IS the cover, and
                  the API already serves page images — a shelf of actual covers
                  is how you find a book you know by sight. */}
              <div className="mb-3 overflow-hidden rounded-lg bg-ink-950 ring-1 ring-ink-700">
                <img
                  src={`${API_BASE}/api/user-books/${encodeURIComponent(b.id)}/page/0`}
                  alt=""
                  loading="lazy"
                  className="h-40 w-full object-cover object-top transition group-hover:scale-[1.03]"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                />
              </div>
              <div className="mb-2 flex items-start justify-between gap-2">
                <span className="text-2xl">📕</span>
                {busy ? (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-200">
                    reading {pct}%
                  </span>
                ) : (
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-200">
                    ready
                  </span>
                )}
              </div>
              <div className="font-semibold text-ink-50 group-hover:text-brand-200">{b.title}</div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-400">
                <span>{b.pages} pages</span>
                <span className="text-brand-300">{b.diagrams} playable positions</span>
              </div>
              {busy && (
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-800">
                  <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${pct}%` }} />
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
