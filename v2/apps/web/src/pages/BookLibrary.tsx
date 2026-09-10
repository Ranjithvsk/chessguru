// The library — every chess book in the owner's Drive, shelved and searchable,
// with a queue for choosing which ones the vision pipeline reads next.
// Route: /books/library
//
// The files live on Vinayaka and are served through the API, never directly:
// they are copyrighted books belonging to one person, so the ownership check
// on the server is the thing that keeps them private. This page is only a view.
//
// 4,101 files collapse to ~3,000 titles because the same book arrives from
// several dump sites under several names. Copies are counted, not hidden, and
// nothing here deletes anything from Drive.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

const API_BASE = (import.meta as any).env?.VITE_API_BASE ?? "";

type Book = {
  id: string; title: string; author: string | null; shelf: string;
  mb: number; copies: number; folder: string;
};
type Catalogue = {
  books: Book[]; shelves: Record<string, number>;
  files: number; titles: number;
};
type QueueItem = { id: string; title?: string; state?: string };

export default function BookLibraryPage() {
  const [cat, setCat] = useState<Catalogue | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [shelf, setShelf] = useState<string>("All");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/api/user-books/library/catalogue`,
                              { credentials: "include" });
        if (r.status === 401) throw new Error("Please sign in.");
        if (r.status === 404) throw new Error("No library is linked to this account.");
        if (!r.ok) throw new Error("The library is not reachable right now.");
        const j = await r.json();
        if (!dead) setCat(j);
      } catch (e) { if (!dead) setErr((e as Error).message); }
    })();
    return () => { dead = true; };
  }, []);

  // The queue moves on its own as books are read, so keep it fresh. The
  // catalogue does not, and it is a megabyte, so that is fetched once.
  useEffect(() => {
    let dead = false;
    const load = async () => {
      try {
        const r = await fetch(`${API_BASE}/api/user-books/library/queue`,
                              { credentials: "include" });
        if (!r.ok) return;
        const j = await r.json();
        if (!dead) setQueue(j.queue ?? []);
      } catch { /* the shelf still works without the queue */ }
    };
    load();
    const t = setInterval(load, 6000);
    return () => { dead = true; clearInterval(t); };
  }, []);

  const shown = useMemo(() => {
    if (!cat) return [];
    const needle = q.trim().toLowerCase();
    return cat.books.filter((b) => {
      if (shelf !== "All" && b.shelf !== shelf) return false;
      if (!needle) return true;
      return b.title.toLowerCase().includes(needle)
          || (b.author ?? "").toLowerCase().includes(needle);
    });
  }, [cat, shelf, q]);

  const toggle = (id: string) => setPicked((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const send = async () => {
    if (!picked.size || sending) return;
    setSending(true);
    try {
      const r = await fetch(`${API_BASE}/api/user-books/library/queue`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...picked] }),
      });
      if (!r.ok) throw new Error("Could not add those to the queue.");
      const j = await r.json();
      setQueue(j.queue ?? []);
      setPicked(new Set());
    } catch (e) { setErr((e as Error).message); }
    finally { setSending(false); }
  };

  if (err) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center">
        <p className="text-ink-300">{err}</p>
        <Link to="/books/read" className="mt-4 inline-block text-sm text-brand-300 hover:underline">
          Back to my books
        </Link>
      </div>
    );
  }
  if (!cat) return <div className="p-8 text-center text-ink-400">Opening the library…</div>;

  const shelves = ["All", ...Object.keys(cat.shelves).sort()];

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <header className="mb-4 rounded-2xl bg-gradient-to-r from-brand-600/25 via-fuchsia-600/10 to-transparent p-5 ring-1 ring-brand-500/20">
        <h1 className="text-xl font-bold text-ink-50">📚 Library</h1>
        <p className="mt-0.5 text-sm text-ink-400">
          {cat.titles.toLocaleString()} books
          {cat.files > cat.titles && (
            <> · {(cat.files - cat.titles).toLocaleString()} duplicate copies folded together</>
          )}
        </p>
      </header>

      {queue.length > 0 && (
        <div className="mb-4 rounded-lg border border-brand-500/30 bg-brand-600/15 p-3">
          <p className="text-sm font-medium text-brand-100">
            Reading queue · {queue.length}
          </p>
          <ul className="mt-1 space-y-0.5 text-sm text-brand-200">
            {queue.slice(0, 5).map((it) => (
              <li key={it.id} className="truncate">
                {it.title ?? it.id}
                {it.state && <span className="ml-1 text-brand-300">· {it.state}</span>}
              </li>
            ))}
            {queue.length > 5 && <li className="text-brand-300">and {queue.length - 5} more</li>}
          </ul>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search by title or author"
          className="min-w-[14rem] flex-1 rounded-md border border-ink-700 bg-ink-900 text-ink-100 px-3 py-1.5 text-sm"
        />
        <select
          value={shelf} onChange={(e) => setShelf(e.target.value)}
          className="rounded-md border border-ink-700 bg-ink-900 text-ink-100 px-2 py-1.5 text-sm"
        >
          {shelves.map((s) => (
            <option key={s} value={s}>
              {s}{s !== "All" && ` (${cat.shelves[s]})`}
            </option>
          ))}
        </select>
        {picked.size > 0 && (
          <button
            onClick={send} disabled={sending}
            className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white
                       hover:bg-brand-500 disabled:opacity-60"
          >
            {sending ? "Adding…" : `Read these ${picked.size}`}
          </button>
        )}
      </div>

      <p className="mb-2 text-xs text-ink-400">
        {shown.length.toLocaleString()} shown
      </p>

      <ul className="divide-y divide-ink-800 rounded-2xl border border-ink-700 bg-ink-900">
        {shown.slice(0, 400).map((b) => (
          <li key={b.id} className="flex items-center gap-3 px-3 py-2 hover:bg-ink-800">
            <input
              type="checkbox" checked={picked.has(b.id)} onChange={() => toggle(b.id)}
              className="h-4 w-4 shrink-0 rounded border-ink-700 bg-ink-900 text-ink-100"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink-50">{b.title}</p>
              <p className="truncate text-xs text-ink-400">
                {b.author && <>{b.author} · </>}{b.shelf} · {b.mb.toFixed(1)} MB
                {b.copies > 1 && <> · {b.copies} copies</>}
              </p>
            </div>
          </li>
        ))}
      </ul>
      {shown.length > 400 && (
        <p className="mt-2 text-center text-xs text-ink-400">
          Showing the first 400. Search to narrow it down.
        </p>
      )}
    </div>
  );
}
