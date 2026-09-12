// Book library — grid of chess books coaches assign, plus custom additions.
// Route: /books

import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  const qc = useQueryClient();

  // This page used to list ONLY the books already added here — a few dozen —
  // while the owner's real library is thousands of books on the Vinayaka host.
  // Searching for a book you own and getting "No books match" was the whole
  // complaint. Now the same search also asks the library.
  const libQ = useQuery({
    queryKey: ["book-library", q.trim()],
    queryFn: () => booksApi.librarySearch(q.trim(), 30),
    enabled: q.trim().length >= 2,
    staleTime: 60_000,
  });
  const adopt = useMutation({
    mutationFn: (hostId: string) => booksApi.adoptLibrary(hostId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["books"] }),
  });
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

  // Library hits, minus anything already added here — adopting is idempotent,
  // so a duplicate row would just be two doors to the same book.
  const libRows = useMemo(() => {
    const have = new Set((list.data?.items ?? []).map((b) => String(b.title || "").toLowerCase()));
    return (libQ.data?.items ?? []).filter((b) => !have.has(String(b.title || "").toLowerCase()));
  }, [libQ.data, list.data]);

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

      {!list.isLoading && filtered.length === 0 && libRows.length === 0 && !libQ.isFetching && (
        <div className="rounded-xl2 border border-dashed border-ink-700 bg-ink-900/50 p-8 text-center text-sm text-ink-400">
          {q.trim().length >= 2
            ? <>Nothing matches “{q.trim()}” — not in your books, and not in the library.</>
            : <>No books match.</>}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {filtered.map((b) => <BookCard key={b._id} b={b} />)}
      </div>

      {/* The library itself — searched only once there is something to search
          for, because the catalogue is thousands of books and lives on another
          machine. Adding one here pulls its chapters across with it. */}
      {q.trim().length >= 2 && (
        <div className="mt-6">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-brand-300">From the library</span>
            {libQ.data && <span className="text-[11px] text-ink-500">{libQ.data.total} match{libQ.data.total === 1 ? "" : "es"}</span>}
            {libQ.isFetching && <span className="text-[11px] text-ink-500">searching…</span>}
            <span className="h-px flex-1 bg-ink-800" />
          </div>
          {libQ.error && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
              The library is unavailable right now — {String((libQ.error as any)?.message || libQ.error)}
            </div>
          )}
          {!libQ.isFetching && !libQ.error && libRows.length === 0 && (
            <div className="rounded-lg border border-dashed border-ink-700 p-4 text-center text-xs text-ink-500">
              No library book matches that.
            </div>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {libRows.map((b) => (
              <div key={b.id} className="flex items-center gap-3 rounded-xl border border-ink-700 bg-ink-900 p-3">
                <span className="text-2xl">📖</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-white">{b.title}</div>
                  <div className="truncate text-[11px] text-ink-400">{[b.author, b.shelf].filter(Boolean).join(" · ")}</div>
                </div>
                <button
                  onClick={() => adopt.mutate(b.id)}
                  disabled={adopt.isPending}
                  className="flex-shrink-0 rounded-lg border border-brand-500/50 bg-brand-500/10 px-3 py-1.5 text-xs font-semibold text-brand-100 hover:bg-brand-500/20 disabled:opacity-50">
                  {adopt.isPending ? "Adding…" : "+ Add"}
                </button>
              </div>
            ))}
          </div>
          {adopt.error && (
            <div className="mt-2 text-[11px] text-rose-300">Could not add it — {String((adopt.error as any)?.message || adopt.error)}</div>
          )}
        </div>
      )}
    </div>
  );
}

function BookCard({ b }: { b: BookSummary }) {
  return (
    <Link to={`/books/${encodeURIComponent(b._id)}`}
      className="group flex h-full gap-3 rounded-xl2 border border-ink-700 bg-ink-900 p-4 transition hover:border-brand-500/60 hover:shadow-glow">
      {/* One frame for every book, whether it has a cover or not. Mixed sizes
          made the rows look ragged, and object-contain shows a whole cover
          rather than cropping the title off it. */}
      <div className="grid h-28 w-20 flex-shrink-0 place-items-center overflow-hidden rounded border border-ink-700 bg-ink-800">
        {b.coverImageUrl ? (
          <img src={b.coverImageUrl} alt="" loading="lazy" className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="text-3xl opacity-60">📚</span>
        )}
      </div>
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
