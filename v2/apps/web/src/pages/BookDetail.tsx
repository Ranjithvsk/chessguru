// Book detail — chapter list with per-chapter "mark done" checkbox and a
// "create a study from this chapter" shortcut. Route: /books/:id

import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { booksApi } from "../lib/books-api";
import { studiesApi } from "../lib/studies-api";

export default function BookDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });

  const q = useQuery({
    queryKey: ["book", id],
    queryFn: () => booksApi.get(id),
    enabled: !!auth?.loggedIn && !!id,
  });

  const markDone = useMutation({
    mutationFn: (ch: number) => booksApi.markDone(id, ch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["book", id] }),
  });
  const unmark = useMutation({
    mutationFn: (ch: number) => booksApi.unmark(id, ch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["book", id] }),
  });

  const createStudy = useMutation({
    mutationFn: (chapterNumber: number) => {
      const ch = q.data?.book.chapters.find((c) => c.number === chapterNumber);
      return studiesApi.create({
        title: `${q.data?.book.title} — Ch ${chapterNumber}${ch?.title ? ": " + ch.title : ""}`,
        intent: "book",
        chapterTitle: ch?.title || `Chapter ${chapterNumber}`,
        sourceBook: {
          bookId: id,
          chapterNumber,
          topicTags: ch?.tags,
        },
      });
    },
    onSuccess: (r) => nav(`/studies/${encodeURIComponent(r.studyId)}/edit/${encodeURIComponent(r.chapterId)}`),
  });

  const removeBook = useMutation({
    mutationFn: () => booksApi.remove(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["books"] }); nav("/books"); },
  });

  if (auth && !auth.loggedIn) return <Navigate to={`/login?back=/books/${encodeURIComponent(id)}`} replace />;
  if (q.isLoading) return <div className="mx-auto max-w-3xl px-3 py-8 text-sm text-ink-400">Loading…</div>;
  if (q.error) return <div className="mx-auto max-w-3xl px-3 py-8">
    <div className="rounded border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{String((q.error as any)?.message || q.error)}</div>
    <Link to="/books" className="mt-3 inline-block text-sm text-brand-300 hover:underline">← Book library</Link>
  </div>;
  if (!q.data) return null;

  const { book, progress } = q.data;
  const completed = new Set(progress.chaptersCompleted);
  const isMine = !book.isSeeded && auth?.loggedIn && book.addedByUserId === auth.userId;
  const total = book.chapters.length;
  const pct = total > 0 ? Math.round((completed.size / total) * 100) : 0;

  return (
    <div className="mx-auto max-w-3xl px-3 py-6">
      <Link to="/books" className="mb-3 inline-block text-xs text-ink-400 hover:text-ink-200">← Book library</Link>

      <div className="mb-4 rounded-xl2 border border-ink-700 bg-ink-900 p-4">
        <div className="flex gap-4">
          {book.coverImageUrl && (
            <img src={book.coverImageUrl} alt=""
              className="h-32 w-24 flex-shrink-0 rounded border border-ink-700 object-cover" />
          )}
          <div className="min-w-0 flex-1">
            <div className="mb-1 text-xs text-ink-400">{book.author}{book.publisher ? ` · ${book.publisher}` : ""}{book.year ? ` · ${book.year}` : ""}</div>
            <h1 className="font-display text-2xl text-white">{book.title}</h1>
            {book.pdfUrl && (
              <div className="mt-3 flex gap-2">
                <a href={book.pdfUrl} target="_blank" rel="noreferrer"
                  className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-500">
                  📖 Read PDF
                </a>
                <a href={book.pdfUrl} download
                  className="rounded-lg border border-ink-700 px-3 py-1.5 text-sm text-ink-200 hover:bg-ink-800">
                  ⬇ Download
                </a>
              </div>
            )}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <div className="flex-1 h-2 rounded-full bg-ink-800 overflow-hidden">
            <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
          </div>
          <div className="text-xs text-ink-300">{completed.size}/{total} chapters ({pct}%)</div>
        </div>
      </div>

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-400">Chapters</h2>
      <div className="space-y-2">
        {book.chapters.map((c) => {
          const done = completed.has(c.number);
          return (
            <div key={c.number} className={`flex items-start gap-3 rounded-xl border p-3 ${done ? "border-emerald-500/40 bg-emerald-500/5" : "border-ink-700 bg-ink-900"}`}>
              <button type="button"
                onClick={() => (done ? unmark.mutate(c.number) : markDone.mutate(c.number))}
                className={`mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded ${done ? "bg-emerald-500 text-white" : "border border-ink-600 hover:border-brand-500"}`}
                title={done ? "Mark not done" : "Mark done"}>
                {done ? "✓" : ""}
              </button>
              <div className="flex-1">
                <div className="text-sm font-semibold text-white">{c.number}. {c.title}</div>
                {c.tags.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {c.tags.map((t) => (
                      <span key={t} className="rounded-full bg-ink-800 px-2 py-0.5 text-[10px] text-ink-300">{t}</span>
                    ))}
                  </div>
                )}
              </div>
              <button type="button"
                onClick={() => createStudy.mutate(c.number)}
                disabled={createStudy.isPending}
                className="shrink-0 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-500 disabled:opacity-50"
                title="Create a study linked to this chapter">
                📓 Study →
              </button>
            </div>
          );
        })}
      </div>

      {progress.studiesLinked.length > 0 && (
        <div className="mt-6 rounded-xl border border-brand-500/30 bg-brand-500/5 p-3">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-200">Studies from this book</div>
          <div className="flex flex-wrap gap-2">
            {progress.studiesLinked.map((sid) => (
              <Link key={sid} to={`/studies/${encodeURIComponent(sid)}`}
                className="rounded-lg border border-brand-500/40 bg-ink-800 px-3 py-1.5 text-xs text-brand-100 hover:bg-brand-500/10">
                📓 {sid.slice(0, 8)}…
              </Link>
            ))}
          </div>
        </div>
      )}

      {isMine && (
        <div className="mt-8 rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 flex items-center justify-between">
          <div className="text-xs text-rose-200">Remove this book from your library.</div>
          <button onClick={() => { if (confirm(`Remove "${book.title}" from your library?`)) removeBook.mutate(); }}
            className="rounded-lg border border-rose-500/50 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/20">
            Remove book
          </button>
        </div>
      )}
    </div>
  );
}
