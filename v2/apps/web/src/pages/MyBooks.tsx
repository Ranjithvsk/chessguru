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
  state: string; done: number; coverPage?: number;
};

export default function MyBooksPage() {
  const [books, setBooks] = useState<Book[] | null>(null);
  const [q, setQ] = useState("");
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
      {/* Same header treatment as the Learn library: plain heading on the left,
          the action on the right, a search box under it. A different-looking
          page for the same job just makes the app feel like two apps. */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-white">My Books</h1>
          <p className="text-sm text-ink-400">Read by the vision pipeline. Open one, then tap any diagram to put it on a board.</p>
        </div>
        <Link to="/books/library"
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-glow hover:bg-brand-500">
          Browse the library
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search title…"
          className="min-w-[200px] flex-1 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {(books ?? [])
          .filter((b) => b.title.toLowerCase().includes(q.trim().toLowerCase()))
          .map((b) => (
          <BookCard
            key={b.id}
            b={b}
            onCover={(page) =>
              setBooks((prev) => prev && prev.map((x) =>
                x.id === b.id ? { ...x, coverPage: page } : x))
            }
          />
        ))}
      </div>
    </div>
  );
}

/** One book on the shelf, laid out like the Learn library: a portrait cover
 *  beside the details rather than a wide banner above them. */
function BookCard({ b, onCover }: { b: Book; onCover: (page: number) => void }) {
  const [picking, setPicking] = useState(false);
  const [busySave, setBusySave] = useState(false);
  const cover = b.coverPage ?? 0;
  const reading = b.state !== "done";
  const pct = b.pages ? Math.round((100 * b.done) / b.pages) : 0;

  const choose = async (page: number) => {
    if (busySave) return;
    setBusySave(true);
    try {
      const r = await fetch(`${API_BASE}/api/user-books/${encodeURIComponent(b.id)}/cover`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page }),
      });
      if (r.ok) { onCover(page); setPicking(false); }
    } finally { setBusySave(false); }
  };

  // How many pages to offer. The cover is near the front of any book, and a
  // strip of 854 thumbnails would fetch the whole scan to choose one image.
  const choices = Math.min(b.pages || 0, 12);

  return (
    <div className="group rounded-xl2 border border-ink-700 bg-ink-900 p-4 transition hover:border-brand-500/60 hover:shadow-glow">
      <div className="flex h-full gap-3">
        <Link to={`/books/read/${encodeURIComponent(b.id)}`} className="flex-shrink-0">
          <div className="grid h-28 w-20 place-items-center overflow-hidden rounded border border-ink-700 bg-ink-800">
            <img
              src={`${API_BASE}/api/user-books/${encodeURIComponent(b.id)}/page/${cover}`}
              alt=""
              loading="lazy"
              className="max-h-full max-w-full object-contain"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          </div>
        </Link>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="mb-1 flex items-center gap-2 text-xs text-ink-400">
            <span>{b.pages} pages</span>
            <span className="text-brand-300">· {b.diagrams} positions</span>
            {reading ? (
              <span className="ml-auto rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-200">reading {pct}%</span>
            ) : (
              <span className="ml-auto rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-200">ready</span>
            )}
          </div>
          <Link to={`/books/read/${encodeURIComponent(b.id)}`}
            className="line-clamp-3 flex-1 font-semibold text-white group-hover:text-brand-200">
            {b.title}
          </Link>
          {b.pages > 1 && (
            <button
              onClick={() => setPicking((v) => !v)}
              className="mt-2 self-start text-[11px] text-ink-500 underline-offset-2 hover:text-brand-300 hover:underline"
            >
              {picking ? "cancel" : "change cover"}
            </button>
          )}
        </div>
      </div>

      {/* Page 0 is usually the front cover and sometimes is not: one scan opens
          on a nearly blank half-title, another on a two-page spread. Rather
          than guess harder, point at the right page. */}
      {picking && (
        <div className="mt-3 border-t border-ink-800 pt-2">
          <p className="mb-2 text-[11px] text-ink-400">Pick the page to show on the shelf</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {Array.from({ length: choices }, (_, i) => (
              <button
                key={i}
                onClick={() => choose(i)}
                disabled={busySave}
                title={`Page ${i + 1}`}
                className={`shrink-0 overflow-hidden rounded border transition disabled:opacity-50 ${
                  i === cover ? "border-brand-500 ring-1 ring-brand-500" : "border-ink-700 hover:border-brand-500/60"}`}
              >
                <img
                  src={`${API_BASE}/api/user-books/${encodeURIComponent(b.id)}/page/${i}`}
                  alt="" loading="lazy" className="h-20 w-14 bg-ink-950 object-contain"
                />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
