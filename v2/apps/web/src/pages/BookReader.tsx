// "My Books" reader — a book on the left, a playable board on the right.
//
// The whole design rests on one fact: a book is read ONCE at ingest (~115s for
// 29 pages) and every diagram is already stored with its page, its bounding box
// and its FEN. So turning a page is a static image fetch and tapping a diagram
// is instant. Nothing here scans anything.
//
// Owner asked for "modern, colourful, interactive and nice user friendly".
// Concretely that means: no modals, tap a diagram and it is on the board and
// playable; hotspots glow rather than outline; a filmstrip of every position in
// the book so it reads like a puzzle set; confidence shown honestly in colour
// rather than implying every read is perfect.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import Board from "../components/Board";
import { useFreePlay } from "../hooks/useFreePlay";

const API_BASE = (import.meta as any).env?.VITE_API_BASE ?? "";

type Diagram = { n: number; page: number; bbox: number[] | null; fen: string; conf?: number };
type BookDetail = {
  id: string; title: string; pages: number; state: string; done: number;
  seconds: number | null; diagrams: Diagram[];
};

/** A scanned position knows nothing about castling or the clock, so fill the
 *  fields a diagram cannot carry. chess.js rejects a bare board field. */
function fullFen(board: string): string {
  const parts = (board || "").trim().split(/\s+/);
  return parts.length >= 6 ? board.trim() : `${parts[0] ?? ""} w - - 0 1`;
}

export default function BookReaderPage() {
  const { id = "" } = useParams();
  const [book, setBook] = useState<BookDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  /** Natural pixel size of each rendered page, learned when the image loads.
   *  Hotspots are stored in page pixels, so they are positioned as a PERCENTAGE
   *  of that. An earlier version cached a scale factor on load instead, which
   *  was captured at whatever width the window happened to be and never
   *  recomputed — resize the window and every hotspot drifted off its diagram. */
  const [pageSize, setPageSize] = useState<Record<number, [number, number]>>({});
  const fp = useFreePlay();

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/api/user-books/${encodeURIComponent(id)}`, { credentials: "include" });
        if (r.status === 401) throw new Error("Please sign in to read your books.");
        if (!r.ok) throw new Error("Book not found.");
        const j = (await r.json()) as BookDetail;
        if (!dead) setBook(j);
      } catch (e) { if (!dead) setErr((e as Error).message); }
    })();
    return () => { dead = true; };
  }, [id]);

  /** Diagrams grouped by page, so each page draws only its own hotspots. */
  const byPage = useMemo(() => {
    const m: Record<number, Diagram[]> = {};
    for (const d of book?.diagrams ?? []) (m[d.page] ||= []).push(d);
    return m;
  }, [book]);

  const open = useCallback((d: Diagram) => {
    setActive(d.n);
    fp.load(fullFen(d.fen));
    setPage(d.page);
  }, [fp]);

  const jumpToPage = (p: number) => {
    setPage(p);
    pageRefs.current[p]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (err) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center">
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6 text-rose-100">{err}</div>
      </div>
    );
  }
  if (!book) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center text-ink-400">
        <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
        Opening your book…
      </div>
    );
  }

  const activeDiagram = book.diagrams.find((d) => d.n === active) ?? null;

  return (
    <div className="mx-auto max-w-[1600px] px-3 pb-40 pt-4">
      {/* Header */}
      <div className="mb-4 rounded-2xl bg-gradient-to-r from-brand-600/20 via-fuchsia-600/10 to-transparent p-4 ring-1 ring-brand-500/20">
        <h1 className="text-lg font-bold text-ink-50">{book.title}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-400">
          <span>{book.pages} pages</span>
          <span className="text-brand-300">{book.diagrams.length} playable positions</span>
          {book.seconds != null && <span>read in {book.seconds}s</span>}
          {book.state !== "done" && (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-200">
              still reading — page {book.done} of {book.pages}
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* Pages */}
        <div className="space-y-6">
          {Array.from({ length: book.pages }, (_, p) => (
            <div
              key={p}
              ref={(el) => { pageRefs.current[p] = el; }}
              className="relative overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-ink-700/40"
            >
              <img
                src={`${API_BASE}/api/user-books/${encodeURIComponent(book.id)}/page/${p}`}
                alt={`Page ${p + 1}`}
                loading="lazy"
                className="block w-full"
                onLoad={(e) => {
                  const img = e.currentTarget;
                  if (img.naturalWidth && img.naturalHeight) {
                    setPageSize((m) => (m[p] ? m : { ...m, [p]: [img.naturalWidth, img.naturalHeight] }));
                  }
                }}
              />
              {(byPage[p] ?? []).map((d) => {
                if (!d.bbox || d.bbox.length < 4) return null;
                const size = pageSize[p];
                if (!size) return null;            // wait until we know the page's real size
                const [nw, nh] = size;
                const [x1, y1, x2, y2] = d.bbox as [number, number, number, number];
                const unsure = (d.conf ?? 1) < 0.9;
                return (
                  <button
                    key={d.n}
                    onClick={() => open(d)}
                    title={`Position ${d.n}${unsure ? " — low confidence, check it" : ""}`}
                    className={`group absolute rounded-lg transition
                      ${active === d.n
                        ? "ring-4 ring-brand-400 bg-brand-400/10"
                        : unsure
                          ? "ring-2 ring-amber-400/70 hover:bg-amber-300/15"
                          : "ring-2 ring-brand-400/50 hover:bg-brand-400/15"}`}
                    style={{
                      left: `${(x1 / nw) * 100}%`,
                      top: `${(y1 / nh) * 100}%`,
                      width: `${((x2 - x1) / nw) * 100}%`,
                      height: `${((y2 - y1) / nh) * 100}%`,
                    }}
                  >
                    <span className="absolute -left-1 -top-1 rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-bold text-white shadow group-hover:bg-brand-500">
                      ▶ {d.n}
                    </span>
                  </button>
                );
              })}
              <div className="absolute bottom-2 right-3 rounded-full bg-black/50 px-2 py-0.5 text-[10px] text-white">
                {p + 1}
              </div>
            </div>
          ))}
        </div>

        {/* Board — sticky so it stays with you as the book scrolls */}
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="rounded-2xl border border-ink-700 bg-ink-900 p-3">
            {activeDiagram ? (
              <>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold text-ink-100">Position {activeDiagram.n}</span>
                  <span className="text-[11px] text-ink-400">page {activeDiagram.page + 1}</span>
                </div>
                <Board fen={fp.fen} orientation={fp.orientation} dests={fp.dests} onMove={fp.onMove} />
                <div className="mt-2 flex flex-wrap gap-2">
                  <button onClick={fp.flip} className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-ink-300 hover:bg-ink-800">⇅ Flip</button>
                  <button onClick={() => navigator.clipboard?.writeText(fp.fen)} className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-ink-300 hover:bg-ink-800">Copy FEN</button>
                  <a href={`/board-editor?fen=${encodeURIComponent(fp.fen)}`} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-500">Analyse ↗</a>
                </div>
                {(activeDiagram.conf ?? 1) < 0.9 && (
                  <p className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-100">
                    This one was read with low confidence. Check it against the page before using it.
                  </p>
                )}
              </>
            ) : (
              <div className="py-10 text-center text-sm text-ink-400">
                Tap any <span className="rounded-full bg-brand-600 px-1.5 py-0.5 text-[10px] font-bold text-white">▶</span> on the page
                <div className="mt-1 text-xs text-ink-500">The position lands here, ready to play.</div>
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Filmstrip — every position in the book, at a glance */}
      {book.diagrams.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-ink-700 bg-ink-950/95 px-3 py-2 backdrop-blur">
          <div className="mb-1 flex items-center gap-2 pl-44 text-[11px] text-ink-400 sm:pl-48">
            <span className="font-semibold text-ink-200">{book.diagrams.length} positions</span>
            <span>· tap to jump</span>
          </div>
          {/* left padding clears the global "Scan position" button, which sits bottom-left */}
            <div className="flex gap-1.5 overflow-x-auto pb-1 pl-44 sm:pl-48">
            {book.diagrams.map((d) => (
              <button
                key={d.n}
                onClick={() => { open(d); jumpToPage(d.page); }}
                className={`shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold transition
                  ${active === d.n
                    ? "bg-brand-600 text-white"
                    : (d.conf ?? 1) < 0.9
                      ? "bg-amber-500/15 text-amber-200 hover:bg-amber-500/25"
                      : "bg-ink-800 text-ink-300 hover:bg-ink-700"}`}
                title={`Position ${d.n} · page ${d.page + 1}`}
              >
                {d.n}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
