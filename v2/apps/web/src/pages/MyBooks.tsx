// "My Books" — the shelf. Every book the vision pipeline has read, with what it
// found in each.
//
// This page existed only as a URL you had to type: the reader at
// /books/read/:id worked, but nothing listed what was on the shelf, so a book
// that had been ingested was invisible unless you already knew its id.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";

const API_BASE = (import.meta as any).env?.VITE_API_BASE ?? "";

type Book = {
  id: string; title: string; pages: number; diagrams: number;
  state: string; done: number; coverPage?: number;
  // Parsed from the filename at upload; null when nothing in it could be trusted
  // (a wrong author is worse than none), and those group under "Unknown".
  author?: string | null;
  // Set while a book waits its turn — only one renders at a time across the whole
  // academy, so a coach can see where they are instead of re-uploading.
  queuePosition?: number | null; etaSeconds?: number | null;
};

const UNKNOWN_AUTHOR = "Unknown";

export default function MyBooksPage() {
  const [books, setBooks] = useState<Book[] | null>(null);
  const [q, setQ] = useState("");
  const [author, setAuthor] = useState("");        // "" = every author
  // Coaches only. Reading a book costs GPU time on a machine shared with live
  // classes, and the library is one person's copyrighted collection.
  const [canAdd, setCanAdd] = useState(false);
  const [adding, setAdding] = useState<"" | "sending" | "storing" | "done" | "failed">("");
  const [addMsg, setAddMsg] = useState("");
  // Bytes actually on the wire. A book is tens of megabytes and coaches upload
  // from phones, where that is a long silence with nothing on screen — long
  // enough to look like a hang and be cancelled.
  const [sent, setSent] = useState(0);
  const [total, setTotal] = useState(0);
  const upload = useRef<XMLHttpRequest | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    api.me()
      .then((m) => { if (!dead) setCanAdd(m.role === "coach" || m.role === "academy_owner"); })
      .catch(() => { /* not signed in, or role unknown — no upload button */ });
    return () => { dead = true; };
  }, []);

  const addBook = (file: File) => {
    setAdding("sending");
    setAddMsg("");
    setSent(0);
    setTotal(file.size);
    const title = file.name.replace(/\.pdf$/i, "");

    // XMLHttpRequest, not fetch: fetch cannot report how much of a request body
    // has gone out, and that number is the whole point here.
    const xhr = new XMLHttpRequest();
    upload.current = xhr;
    xhr.open("POST", `${API_BASE}/api/user-books/upload?title=${encodeURIComponent(title)}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Content-Type", "application/pdf");

    xhr.upload.onprogress = (e) => { if (e.lengthComputable) setSent(e.loaded); };
    // The last byte is not the end: the server still has to store the file and
    // hand it to the reader, which takes a moment on a big book.
    xhr.upload.onload = () => setAdding("storing");

    xhr.onload = () => {
      upload.current = null;
      let j: any = {};
      try { j = JSON.parse(xhr.responseText); } catch { /* fall back to the status */ }
      if (xhr.status < 200 || xhr.status >= 300) {
        setAdding("failed");
        setAddMsg(j?.message || (xhr.status === 413
          ? "That file is too large — the limit is 200 MB."
          : `Could not add that book (${xhr.status}).`));
        return;
      }
      setAdding("done");
      if (j.alreadyHave) {
        const b = j.book;
        setAddMsg(b.where === "read"
          ? `Already in your library: \u201c${b.title}\u201d — ${b.pages} pages, ${b.diagrams} positions.`
          : `Already in your library: \u201c${b.title}\u201d — not read yet, queue it from the library.`);
      } else {
        setAddMsg(`Added \u201c${j.book.title}\u201d. It is queued and will appear here when read.`);
      }
    };
    xhr.onerror = () => {
      upload.current = null;
      setAdding("failed");
      setAddMsg("The upload did not finish — check the connection and try again.");
    };
    xhr.onabort = () => {
      upload.current = null;
      setAdding("");
      setAddMsg("Upload cancelled.");
    };
    xhr.send(file);
  };

  const cancelUpload = () => upload.current?.abort();


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
        <div className="flex flex-wrap items-center gap-2">
          {canAdd && (
            <label className="cursor-pointer rounded-lg border border-ink-700 px-4 py-2 text-sm font-semibold text-ink-200 hover:bg-ink-800">
              {adding === "sending" || adding === "storing" ? "Adding…" : "Add a book"}
              <input
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                disabled={adding === "sending" || adding === "storing"}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.currentTarget.value = "";        // so the same file can be picked twice
                  if (f) void addBook(f);
                }}
              />
            </label>
          )}
          <Link to="/books/library"
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-glow hover:bg-brand-500">
            Browse the library
          </Link>
        </div>
      </div>

      {(adding === "sending" || adding === "storing") && (
        <div className="mb-3 rounded-lg border border-brand-500/40 bg-brand-500/10 p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="font-semibold text-brand-100">
              {adding === "storing" ? "Sent — storing the book…" : "Uploading…"}
            </span>
            <span className="tabular-nums text-xs text-ink-300">
              {total > 0 && adding === "sending"
                ? `${(sent / 1048576).toFixed(1)} of ${(total / 1048576).toFixed(1)} MB · ${Math.round((sent / total) * 100)}%`
                : "almost there"}
            </span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-ink-800">
            <div
              className={`h-full rounded-full bg-brand-500 transition-[width] duration-200 ${adding === "storing" ? "animate-pulse" : ""}`}
              style={{ width: adding === "storing" || !total ? "100%" : `${Math.max(2, Math.round((sent / total) * 100))}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-xs text-ink-400">
              A big book takes a while on a phone. Keep this page open.
            </span>
            {adding === "sending" && (
              <button type="button" onClick={cancelUpload}
                className="rounded border border-ink-600 px-2 py-1 text-xs font-semibold text-ink-300 hover:bg-ink-800">
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {addMsg && (
        <div className={`mb-3 rounded-lg border p-3 text-sm ${
          adding === "failed" ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
            : "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"}`}>
          {addMsg}
        </div>
      )}

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

      {/* Filter by author. Shown only once a shelf holds more than one — a coach
          with three books does not need a filter. 38% of books yield no author we
          would trust, so "Unknown" is a real group rather than a failure. */}
      {(() => {
        const counts = new Map<string, number>();
        for (const b of books ?? []) {
          const a = (b.author || "").trim() || UNKNOWN_AUTHOR;
          counts.set(a, (counts.get(a) ?? 0) + 1);
        }
        if (counts.size < 2) return null;
        const names = [...counts.entries()].sort((x, y) =>
          x[0] === UNKNOWN_AUTHOR ? 1 : y[0] === UNKNOWN_AUTHOR ? -1
            : y[1] - x[1] || x[0].localeCompare(y[0]));
        return (
          <div className="mb-3 flex flex-wrap gap-1.5">
            <button onClick={() => setAuthor("")}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${author === "" ? "bg-emerald-500 text-black" : "bg-ink-800 text-ink-300 hover:bg-ink-700"}`}>
              All authors <span className="opacity-60">{(books ?? []).length}</span>
            </button>
            {names.map(([a, n]) => (
              <button key={a} onClick={() => setAuthor(a === author ? "" : a)}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${author === a ? "bg-emerald-500 text-black" : "bg-ink-800 text-ink-300 hover:bg-ink-700"}`}
                title={a === UNKNOWN_AUTHOR ? "The filename gave no author we could trust" : a}>
                {a} <span className="opacity-60">{n}</span>
              </button>
            ))}
          </div>
        );
      })()}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {(books ?? [])
          .filter((b) => !author || ((b.author || "").trim() || UNKNOWN_AUTHOR) === author)
          .filter((b) => b.title.toLowerCase().includes(q.trim().toLowerCase())
                      || (b.author || "").toLowerCase().includes(q.trim().toLowerCase()))
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
          {/* One line, never two. On a phone "854 pages · 829 positions" plus a
              status chip wrapped, which made that card taller than its
              neighbours and the whole shelf go ragged — the Learn library keeps
              its author-and-year on a single line and stays even. */}
          <div className="mb-1 flex min-w-0 items-center gap-2 text-xs text-ink-400">
            <span className="truncate whitespace-nowrap">
              {b.pages} pages <span className="text-brand-300">· {b.diagrams} positions</span>
            </span>
            {reading ? (
              <span className="ml-auto shrink-0 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-200">{pct}%</span>
            ) : (
              <span className="ml-auto shrink-0 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-200">ready</span>
            )}
          </div>
          <Link to={`/books/read/${encodeURIComponent(b.id)}`}
            className="line-clamp-3 font-semibold text-white group-hover:text-brand-200">
            {b.title}
          </Link>
          {b.author && <div className="mt-0.5 text-[11px] text-ink-400">{b.author}</div>}
          {/* Waiting its turn: where in line, and roughly how long — so nobody
              re-uploads a book that is already on its way. */}
          {b.state === "queued" && (b.queuePosition ?? 0) > 0 && (
            <div className="mt-0.5 text-[11px] text-amber-200">
              #{b.queuePosition} in queue
              {(b.etaSeconds ?? 0) > 0 && ` · about ${Math.max(1, Math.round((b.etaSeconds as number) / 60))} min`}
            </div>
          )}
          <div className="flex-1" />
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
