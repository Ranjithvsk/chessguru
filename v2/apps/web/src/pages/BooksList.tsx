// Book library — grid of chess books coaches assign, plus custom additions.
// Route: /books

import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { booksApi, type BookSummary } from "../lib/books-api";

export default function BooksListPage() {
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const list = useQuery({
    queryKey: ["books"],
    queryFn: () => booksApi.list(),
    enabled: !!auth?.loggedIn,
  });

  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"all" | "seeded" | "mine">("all");

  const items = list.data?.items ?? [];
  const filtered = useMemo(() => {
    let arr = items;
    if (tab === "seeded") arr = arr.filter((b) => b.isSeeded);
    if (tab === "mine") arr = arr.filter((b) => !b.isSeeded);
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      arr = arr.filter((b) => b.title.toLowerCase().includes(needle) || b.author.toLowerCase().includes(needle));
    }
    return arr;
  }, [items, tab, q]);

  if (auth && !auth.loggedIn) return <Navigate to="/login?back=/books" replace />;

  return (
    <div className="mx-auto max-w-5xl px-3 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-white">Book library</h1>
          <p className="text-sm text-ink-400">Track chapters read, link studies to book positions.</p>
        </div>
        <Link to="/books/new"
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 shadow-glow">
          + Add a book
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search title or author…"
          className="flex-1 min-w-[200px] rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
        <div className="flex gap-1 rounded-lg border border-ink-700 bg-ink-900 p-1 text-xs">
          {(["all", "seeded", "mine"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`rounded px-3 py-1.5 font-semibold ${tab === t ? "bg-brand-600 text-white" : "text-ink-300 hover:text-white"}`}>
              {t === "all" ? "All" : t === "seeded" ? "Curated" : "My books"}
            </button>
          ))}
        </div>
      </div>

      {list.isLoading && <div className="text-sm text-ink-400">Loading…</div>}
      {list.error && <div className="rounded border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{String((list.error as any)?.message || list.error)}</div>}

      {!list.isLoading && filtered.length === 0 && (
        <div className="rounded-xl2 border border-dashed border-ink-700 bg-ink-900/50 p-8 text-center text-sm text-ink-400">
          No books match.
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((b) => <BookCard key={b._id} b={b} />)}
      </div>
    </div>
  );
}

function BookCard({ b }: { b: BookSummary }) {
  return (
    <Link to={`/books/${encodeURIComponent(b._id)}`}
      className="group flex gap-3 rounded-xl2 border border-ink-700 bg-ink-900 p-4 transition hover:border-brand-500/60 hover:shadow-glow">
      {b.coverImageUrl ? (
        <img src={b.coverImageUrl} alt="" className="h-24 w-16 flex-shrink-0 rounded border border-ink-700 object-cover" />
      ) : (
        <div className="flex h-24 w-16 flex-shrink-0 items-center justify-center rounded border border-ink-700 bg-ink-800 text-3xl">📚</div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mb-1 flex items-center gap-2 text-xs text-ink-400">
          <span className="truncate">{b.author}</span>
          {b.year && <span className="text-ink-500">· {b.year}</span>}
          {!b.isSeeded && <span className="ml-auto rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-200">Custom</span>}
        </div>
        <h3 className="line-clamp-3 flex-1 font-semibold text-white group-hover:text-brand-200">{b.title}</h3>
        <div className="mt-2 flex items-center gap-2 text-[11px] text-ink-500">
          {b.publisher && <span className="truncate">{b.publisher}</span>}
          {b.pdfUrl && <span className="ml-auto rounded-full bg-brand-500/20 px-2 py-0.5 text-brand-200">📖 PDF</span>}
        </div>
      </div>
    </Link>
  );
}
