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
// The SAME palette button the class Setup editor uses, so the pieces you pick
// are the identical cburnett SVGs sitting on the board — not unicode glyphs
// beside SVG pieces. Owner on that component, 2026-08-12: "edit piece make it
// same like pieces on board".
import { PalettePieceBtn } from "../components/SharedClassBoard";

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

/** Turn the board through 180 degrees.
 *  A scan cannot tell which way up a diagram was printed — nothing in the
 *  picture says which side is White — so a position read upside down is a real
 *  and common outcome. FLIPPING THE VIEW DOES NOT FIX IT: that changes which
 *  side you look from, while the pieces stay on the wrong squares. This moves
 *  the pieces, a1 to h8, which is what the reader actually needs.
 *  Ranks are reversed and each rank string reversed; FEN run-lengths are always
 *  a single digit 1-8, so reversing the characters stays valid. */
function rotate180(fen: string): string {
  const [board = "", ...rest] = fullFen(fen).split(" ");
  const flipped = board.split("/").reverse()
    .map((r) => r.split("").reverse().join("")).join("/");
  return [flipped, ...rest].join(" ");
}

// White on top, black below — the order the class editor uses.
const PALETTE_W = ["K", "Q", "R", "B", "N", "P"] as const;
const PALETTE_B = ["k", "q", "r", "b", "n", "p"] as const;

/** Put one piece on one square (or clear it) and hand back a FEN.
 *  Kept here rather than reusing the class Setup modal: that one is a fixed
 *  viewport overlay, and covering the page defeats the purpose — the reason to
 *  edit at all is to fix a square the scan misread WHILE the printed diagram is
 *  visible beside it. */
function setSquare(fen: string, square: string, piece: string): string {
  const parts = fullFen(fen).split(" ");
  const ranks = (parts[0] || "").split("/");
  const file = square.charCodeAt(0) - 97;          // a..h -> 0..7
  const rank = 8 - Number(square[1]);              // "8".."1" -> 0..7
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return fullFen(fen);
  const cells: string[] = [];
  for (const ch of ranks[rank] || "8") {
    if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) cells.push("");
    else cells.push(ch);
  }
  while (cells.length < 8) cells.push("");
  cells[file] = piece;                              // "" clears it
  let row = "", blanks = 0;
  for (const c of cells.slice(0, 8)) {
    if (!c) { blanks++; continue; }
    if (blanks) { row += String(blanks); blanks = 0; }
    row += c;
  }
  if (blanks) row += String(blanks);
  ranks[rank] = row;
  parts[0] = ranks.join("/");
  return parts.join(" ");
}

/** What stands on a square right now, "" for empty. */
function pieceAt(fen: string, square: string): string {
  const ranks = (fullFen(fen).split(" ")[0] || "").split("/");
  const file = square.charCodeAt(0) - 97;
  const rank = 8 - Number(square[1]);
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return "";
  const cells: string[] = [];
  for (const ch of ranks[rank] || "8") {
    if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) cells.push("");
    else cells.push(ch);
  }
  return cells[file] || "";
}

/** Swap whose turn it is. A diagram says "White to move" in prose we may not
 *  have read, so the reader has to be able to say so. */
function withSideToMove(fen: string, side: "w" | "b"): string {
  const parts = fullFen(fen).split(" ");
  parts[1] = side;
  return parts.join(" ");
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
  const [editing, setEditing] = useState(false);
  const [brush, setBrush] = useState<string>("P");
  const [saving, setSaving] = useState<"" | "saving" | "saved" | "failed">("");
  const [saveErr, setSaveErr] = useState<string>("");
  // Remembered per browser: a reader who collapses the strip means it, and
  // having it spring back open on every page is the annoyance they were
  // collapsing away from. Wrapped because storage throws in private mode.
  const [stripOpen, setStripOpen] = useState<boolean>(() => {
    try { return localStorage.getItem("cg.bookStrip") !== "0"; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem("cg.bookStrip", stripOpen ? "1" : "0"); } catch { /* private mode */ }
  }, [stripOpen]);
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
    // Saved/failed state belongs to the diagram it happened on. Leaving it set
    // made every position you opened afterwards claim "✓ Saved · edit again",
    // which is both wrong and alarming — it reads as though you had already
    // edited a board you have not looked at yet.
    setSaving(""); setSaveErr(""); setEditing(false);
  }, [fp]);

  /** Paint one square, Dream Meet's rules: the selected piece on a square that
   *  already holds it REMOVES it, anything else places or replaces. Without the
   *  toggle there is no way to clear a square except switching to the eraser,
   *  which is two taps for the commonest correction of all — the scan seeing a
   *  piece on an empty square. */
  const paintSquare = useCallback((sq: string) => {
    const cur = pieceAt(fp.fen, sq);
    const next = brush && cur === brush ? "" : brush;
    fp.loadPermissive(setSquare(fp.fen, sq, next));
  }, [fp, brush]);

  /** Tell the server what this diagram really is. Three answers, not one:
   *  it is right, it is wrong and here is the fix, or it is not a board at all.
   *  The third is a NEGATIVE example for the extractor — a different model from
   *  the one that reads the squares — and there was no way to say it before. */
  const sendFeedback = useCallback(async (
    action: "correct" | "confirm" | "reject", d: Diagram,
  ) => {
    setSaving("saving"); setSaveErr("");
    const boardOnly = fp.fen.split(" ")[0] ?? "";
    try {
      const r = await fetch(
        `${API_BASE}/api/user-books/${encodeURIComponent(book!.id)}/diagram/${d.n}`,
        { method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fen: boardOnly, action }) });
      if (!r.ok) {
        let why = `HTTP ${r.status}`;
        try { const j = await r.json(); if (j?.message) why = String(j.message); } catch { /* not json */ }
        throw new Error(why);
      }
      setSaving("saved");
      setBook((b) => {
        if (!b) return b;
        if (action === "reject") {
          // Gone from the book, so renumber and let go of the selection.
          const left = b.diagrams.filter((x) => x.n !== d.n).map((x, i) => ({ ...x, n: i + 1 }));
          setActive(null);
          return { ...b, diagrams: left };
        }
        return { ...b, diagrams: b.diagrams.map((x) =>
          x.n === d.n ? { ...x, fen: action === "correct" ? boardOnly : x.fen, conf: 1 } : x) };
      });
      if (action !== "reject") setEditing(false);
    } catch (e) { setSaving("failed"); setSaveErr((e as Error).message || ""); }
  }, [fp, book]);

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
                    {/* OUTSIDE the board, not on it. Sitting at -top-1/-left-1
                        the badge covered a8/b8 — the reader could not check the
                        very squares most likely to be misread, which defeats
                        the point of showing the printed diagram at all. Now it
                        hangs just above the top-left corner and fades until the
                        diagram is hovered or active. */}
                    <span className="pointer-events-none absolute bottom-full left-0 mb-0.5 rounded-full bg-brand-600/80 px-1.5 py-0.5 text-[10px] font-bold text-white shadow transition-opacity group-hover:bg-brand-500 group-hover:opacity-100 opacity-70">
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

        {/* Board — sticky so it stays with you as the book scrolls.
         *  It must SCROLL WITHIN ITSELF: with the editor palette open the panel
         *  is taller than the viewport, and a sticky element simply clips —
         *  the buttons below the board became unreachable. Capped to the space
         *  between the header and the filmstrip, then scrollable. */}
        <aside className="lg:sticky lg:top-20 lg:self-start lg:max-h-[calc(100vh-7.5rem)] lg:overflow-y-auto lg:pr-1">
          <div className="rounded-2xl border border-ink-700 bg-ink-900 p-3 pb-4">
            {activeDiagram ? (
              <>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold text-ink-100">Position {activeDiagram.n}</span>
                  <span className="text-[11px] text-ink-400">page {activeDiagram.page + 1}</span>
                </div>
                {/* movableColor is REQUIRED for the board to accept a move —
                    chessground's own default is "nobody", and without it the
                    reader looked playable and silently refused every move.
                    Owner: "white to play is there, i cant play white directly".
                    turnColor follows the side-to-move toggle above, so setting
                    it to White really does let White move. */}
                <Board
                  fen={fp.fen}
                  orientation={fp.orientation}
                  turnColor={fp.turnColor}
                  movableColor={editing ? undefined : fp.turnColor}
                  dests={editing ? new Map() : fp.dests}
                  onMove={fp.onMove}
                  onSelect={editing ? paintSquare : undefined}
                  showDests
                />

                {editing && (
                  <div className="mt-2 rounded-xl border border-brand-500/40 bg-brand-500/5 p-2">
                    <div className="mb-1 text-[11px] text-brand-200">
                      Pick a piece, then tap squares. Tapping the same piece again clears that square.
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="flex flex-wrap gap-1">
                        {PALETTE_W.map((pc) => (
                          <PalettePieceBtn key={pc} p={pc} selected={brush === pc} onClick={() => setBrush(pc)} />
                        ))}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {PALETTE_B.map((pc) => (
                          <PalettePieceBtn key={pc} p={pc} selected={brush === pc} onClick={() => setBrush(pc)} />
                        ))}
                        <button onClick={() => setBrush("")}
                          className={`grid h-11 w-11 place-items-center rounded-lg border text-[11px] font-semibold transition ${
                            brush === "" ? "border-rose-400 bg-rose-600 text-white ring-2 ring-rose-300" : "border-ink-700 bg-ink-800 text-ink-300 hover:bg-ink-700"}`}
                          title="Erase a square">✕</button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Whose move. A diagram never states it in the pieces, so this
                    has to be settable — and it changes what is playable. */}
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[11px] text-ink-400">To play</span>
                  <div className="inline-flex overflow-hidden rounded-lg border border-ink-700">
                    {(["w", "b"] as const).map((side) => (
                      <button
                        key={side}
                        onClick={() => fp.load(withSideToMove(fp.fen, side))}
                        className={`px-3 py-1 text-xs font-semibold transition ${
                          fp.fen.split(" ")[1] === side
                            ? "bg-brand-600 text-white"
                            : "bg-ink-900 text-ink-300 hover:bg-ink-800"}`}
                      >
                        {side === "w" ? "♔ White" : "♚ Black"}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap gap-2">
                  <button onClick={() => fp.load(rotate180(fp.fen))}
                    title="The scan could not tell which way up the diagram was printed"
                    className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-ink-300 hover:bg-ink-800">↻ Rotate 180°</button>
                  <button onClick={fp.flip} className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-ink-300 hover:bg-ink-800">⇅ Flip view</button>
                  <button onClick={() => activeDiagram && fp.load(fullFen(activeDiagram.fen))}
                    title="Undo your moves and go back to the printed position"
                    className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-ink-300 hover:bg-ink-800">⟲ Reset</button>
                  <button onClick={() => navigator.clipboard?.writeText(fp.fen)} className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-ink-300 hover:bg-ink-800">Copy FEN</button>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {/* Edit HERE, not on another page. Sending the reader away to
                      /board-editor lost their place in the book — and the whole
                      point is fixing a square the scan misread while looking at
                      the printed diagram right next to it. */}
                  {/* ONE key, not two. "Done editing" and "Save correction"
                      were separate, which invites the worst outcome available:
                      a coach fixes a square, presses Done, and loses the fix
                      because Save was a different button. Finishing an edit IS
                      saving it. Edit mode only closes once the save succeeds —
                      on failure it stays open with the position intact so the
                      work is never silently thrown away. */}
                  <button
                    disabled={saving === "saving"}
                    onClick={async () => {
                      if (!editing) { setEditing(true); setSaving(""); return; }
                      if (!activeDiagram) { setEditing(false); return; }
                      await sendFeedback("correct", activeDiagram);
                    }}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60 ${
                      saving === "failed" ? "bg-rose-600 hover:bg-rose-500"
                        : editing ? "bg-emerald-600 hover:bg-emerald-500"
                        : "bg-brand-600 hover:bg-brand-500"}`}>
                    {!editing ? "✏️ Edit position"
                      : saving === "saving" ? "Saving…"
                      : saving === "failed" ? "✕ Save failed · retry"
                      : "💾 Save & done"}
                  </button>
                  {saving === "failed" && saveErr && (
                    <p className="w-full text-[11px] text-rose-300">{saveErr}</p>
                  )}
                  {/* Confirming a GOOD read matters as much as fixing a bad
                      one. It is 64 human-verified squares — the same training
                      value as a correction — and it is the only way to measure
                      real accuracy rather than guess at it. Posts the position
                      unchanged, so the record shows was == now. */}
                  {!editing && activeDiagram && (
                    <button
                      disabled={saving === "saving"}
                      onClick={async () => {
                        await sendFeedback("confirm", activeDiagram);
                      }}
                      className="rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-60">
                      ✓ This one is correct
                    </button>
                  )}
                  {!editing && activeDiagram && (
                    <button
                      disabled={saving === "saving"}
                      onClick={() => {
                        if (confirm("Remove this from the book? Tell us it is not a chess position at all.")) {
                          void sendFeedback("reject", activeDiagram);
                        }
                      }}
                      title="The scanner found a board here, but there isn't one"
                      className="rounded-lg border border-rose-500/50 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/20 disabled:opacity-60">
                      ✕ Not a position
                    </button>
                  )}
                </div>
                <p className="mt-2 text-[11px] text-ink-500">
                  Move the pieces on the board above to play from this position — Reset puts the printed one back.
                </p>
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
          {/* Collapsible: on a long book this strip is hundreds of buttons
           *  pinned across the bottom of every page, eating screen the reader
           *  wants for the book itself. Collapsed it keeps one line, so you can
           *  still see how many positions there are and reopen it in a tap. */}
          <button
            onClick={() => setStripOpen((v) => !v)}
            className="mb-1 flex w-full items-center gap-2 pl-44 text-left text-[11px] text-ink-400 hover:text-ink-200 sm:pl-48"
            aria-expanded={stripOpen}
          >
            <span className="font-semibold text-ink-200">{book.diagrams.length} positions</span>
            <span>· {stripOpen ? "tap to jump" : "hidden"}</span>
            <span className="ml-auto pr-2 text-ink-300">{stripOpen ? "▾ hide" : "▴ show"}</span>
          </button>
          {/* left padding clears the global "Scan position" button, which sits bottom-left */}
            <div className={`${stripOpen ? "flex" : "hidden"} gap-1.5 overflow-x-auto pb-1 pl-44 sm:pl-48`}>
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
