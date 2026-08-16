// Add a custom book to my library. Route: /books/new
//
// A coach adds a book that isn't in the curated 30 (regional, native-language,
// self-published, etc). Fields: title/author + a chapter list (title + tags).
// Starts with 1 blank chapter row; owner grows the list.

import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { booksApi, type BookChapter } from "../lib/books-api";

export default function BookCreatePage() {
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const nav = useNavigate();
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [publisher, setPublisher] = useState("");
  const [year, setYear] = useState("");
  const [chapters, setChapters] = useState<BookChapter[]>([{ number: 1, title: "", tags: [] }]);
  const [err, setErr] = useState("");

  const mut = useMutation({
    mutationFn: (body: any) => booksApi.create(body),
    onSuccess: (r) => nav(`/books/${encodeURIComponent(r.bookId)}`),
    onError: (e: any) => setErr(String(e?.message || e)),
  });

  const updateCh = (i: number, patch: Partial<BookChapter>) => {
    setChapters((prev) => prev.map((c, idx) => idx === i ? { ...c, ...patch } : c));
  };
  const addCh = () => setChapters((prev) => [...prev, { number: prev.length + 1, title: "", tags: [] }]);
  const removeCh = (i: number) => setChapters((prev) => prev.filter((_, idx) => idx !== i).map((c, idx) => ({ ...c, number: idx + 1 })));

  const submit = () => {
    setErr("");
    if (!title.trim() || !author.trim()) { setErr("Title + author required"); return; }
    const cleanChapters = chapters.map((c, i) => ({
      number: i + 1,
      title: c.title.trim() || `Chapter ${i + 1}`,
      tags: c.tags.filter((t) => t.trim()).map((t) => t.trim()),
    }));
    mut.mutate({
      title: title.trim(),
      author: author.trim(),
      publisher: publisher.trim() || undefined,
      year: year ? Number(year) : undefined,
      chapters: cleanChapters,
    });
  };

  if (auth && !auth.loggedIn) return <Navigate to="/login?back=/books/new" replace />;

  return (
    <div className="mx-auto max-w-3xl px-3 py-6">
      <Link to="/books" className="mb-3 inline-block text-xs text-ink-400 hover:text-ink-200">← Book library</Link>
      <h1 className="mb-4 font-display text-2xl text-white">Add a book</h1>

      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200}
              placeholder="e.g. My Best Games"
              className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Author</label>
            <input value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={120}
              placeholder="e.g. Viswanathan Anand"
              className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Publisher (optional)</label>
            <input value={publisher} onChange={(e) => setPublisher(e.target.value)} maxLength={120}
              className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-white focus:border-brand-500 focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Year (optional)</label>
            <input value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
              className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-white focus:border-brand-500 focus:outline-none" />
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wide text-ink-400">Chapters</label>
            <button type="button" onClick={addCh}
              className="rounded border border-ink-700 px-2 py-1 text-xs text-ink-300 hover:bg-ink-800 hover:text-white">
              + Add chapter
            </button>
          </div>
          <div className="space-y-2">
            {chapters.map((c, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-900 p-2">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded bg-ink-800 text-xs text-ink-300">{i + 1}</div>
                <input value={c.title} onChange={(e) => updateCh(i, { title: e.target.value })} maxLength={200}
                  placeholder="Chapter title"
                  className="flex-1 rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-white focus:border-brand-500 focus:outline-none" />
                <input value={c.tags.join(", ")} onChange={(e) => updateCh(i, { tags: e.target.value.split(",").map((s) => s.trim()) })}
                  placeholder="tags (comma-sep)"
                  className="w-48 rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-xs text-white focus:border-brand-500 focus:outline-none" />
                <button type="button" onClick={() => removeCh(i)} disabled={chapters.length === 1}
                  className="rounded px-2 py-1 text-xs text-rose-400 hover:bg-rose-500/10 disabled:opacity-40">×</button>
              </div>
            ))}
          </div>
        </div>

        {err && <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{err}</div>}

        <button type="button" onClick={submit} disabled={mut.isPending}
          className="w-full rounded-lg bg-brand-600 px-4 py-2.5 font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
          {mut.isPending ? "Adding…" : "Add book →"}
        </button>
      </div>
    </div>
  );
}
