// Extracted from pages/Opening.tsx so the Explorer can be embedded inline on
// the Openings hub (/openings) instead of hiding behind a card that opens a
// separate page (owner ask 2026-08-19: "show opening explorer open in
// opening, not in a box").
//
// The standalone route /opening still uses this component — it just wraps it
// in a page layout.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { Key } from "chessground/types";
import Board from "./Board";
import { useFreePlay, type MoveNode } from "../hooks/useFreePlay";
import { fetchExplorer } from "../lib/explorer";
import { OPENING_HANDOFF_KEY } from "../lib/openingMemory";
import { findOpeningForLine } from "../lib/openings";
import { OpeningIdeaPanel } from "./OpeningIdeaPanel";
import { AnnotationToolbar, applyAnnotationClick, computeAttackShapes, computePinShapes, useAnnotationTool, type AnnotShape } from "./AnnotationToolbar";
import { PositionEditorModal } from "./SharedClassBoard";
import { addRepertoire, type RepMoveNode } from "../lib/repertoire-api";
import { Chess } from "chess.js";

// NAG glyph presets — mirror the class notation panel (ClassV2.tsx). Coach
// picks one from the right-click menu → glyph renders inline next to the SAN.
const NAG_PRESETS: Array<{ text: string; hint: string }> = [
  { text: "!",  hint: "Good move" },
  { text: "?",  hint: "Mistake" },
  { text: "!!", hint: "Brilliant" },
  { text: "??", hint: "Blunder" },
  { text: "!?", hint: "Interesting" },
  { text: "?!", hint: "Dubious" },
  { text: "±",  hint: "White clear advantage" },
  { text: "∓",  hint: "Black clear advantage" },
  { text: "+-", hint: "White winning" },
  { text: "-+", hint: "Black winning" },
  { text: "+=", hint: "White slight edge" },
  { text: "=+", hint: "Black slight edge" },
  { text: "=",  hint: "Equal" },
  { text: "∞",  hint: "Unclear" },
];
const NAG_CLASS: Record<string, string> = {
  "!":  "text-emerald-400",
  "!!": "text-emerald-400",
  "?":  "text-rose-400",
  "??": "text-rose-500",
  "!?": "text-amber-300",
  "?!": "text-amber-500",
  "±":  "text-sky-300",
  "∓":  "text-sky-300",
  "+-": "text-sky-400",
  "-+": "text-sky-400",
  "+=": "text-sky-200",
  "=+": "text-sky-200",
  "=":  "text-ink-400",
  "∞":  "text-purple-300",
};

function WdlBar({ w, d, b, className = "" }: { w: number; d: number; b: number; className?: string }) {
  const t = w + d + b || 1;
  const pct = (n: number) => `${(n / t) * 100}%`;
  return (
    <div className={`flex h-full w-full overflow-hidden rounded-[3px] ${className}`} title={`+${w} =${d} -${b}`}>
      <div style={{ width: pct(w) }} className="bg-[#e8e8e8]" />
      <div style={{ width: pct(d) }} className="bg-[#6b7280]" />
      <div style={{ width: pct(b) }} className="bg-[#15181f]" />
    </div>
  );
}

/** Optional prop lets the Openings hub share ONE freeplay state between the
 *  Explorer and the Family/Opening/Variation drilldown — picking a variation
 *  updates the board here without a second useFreePlay instance.
 *  * `preBoardExtra` renders in a NEW LEFT column BEFORE the board (owner
 *    ask 2026-08-20 — used by the hub to slot "Find an opening" left of
 *    the board). Board size is preserved because the board's CSS caps it
 *    at `min(100%, calc(100dvh - 10.5rem))`, and the 3-col layout still
 *    gives the middle column enough room on desktop widths.
 *  * `asideExtra` renders in the RIGHT rail below the Opening explorer
 *    (Repertoire panel etc.). */
export default function OpeningExplorer(
  { fp: externalFp, asideExtra, preBoardExtra }: {
    fp?: ReturnType<typeof useFreePlay>;
    asideExtra?: React.ReactNode;
    preBoardExtra?: React.ReactNode;
  } = {},
) {
  const ownFp = useFreePlay();
  const fp = externalFp ?? ownFp;
  const navigate = useNavigate();
  // Annotation tool state (Phase 1 — owner ask 2026-09-02). Local only —
  // /openings isn't shared. Shapes are keyed by FEN so each position
  // keeps its own annotations when you step through the tree.
  const annotTool = useAnnotationTool();
  // Persist annotation shapes per position (owner ask 2026-09-02 "arrow save
  // option"). Keyed by FEN so each position keeps its own annotations across
  // reloads + variation navigation. localStorage cap: skip writing when the
  // map grows past ~2 MB stringified to stay well under the 5 MB quota.
  const SHAPES_KEY = "cg_openings_shapes_v1";
  const [shapesByFen, setShapesByFen] = useState<Record<string, AnnotShape[]>>(() => {
    try {
      const raw = localStorage.getItem(SHAPES_KEY);
      if (!raw) return {};
      const j = JSON.parse(raw);
      return j && typeof j === "object" ? j : {};
    } catch { return {}; }
  });
  const shapes = shapesByFen[fp.fen] ?? [];
  const setShapes = (next: AnnotShape[]) => {
    setShapesByFen((prev) => {
      // Drop the key entirely when empty so unused positions don't bloat storage.
      const merged = { ...prev };
      if (next.length === 0) delete merged[fp.fen];
      else merged[fp.fen] = next;
      try {
        const s = JSON.stringify(merged);
        if (s.length < 2_000_000) localStorage.setItem(SHAPES_KEY, s);
      } catch { /* quota — silent */ }
      return merged;
    });
  };
  const { data, isError } = useQuery({
    queryKey: ["explorer", fp.fen],
    queryFn: () => fetchExplorer(fp.fen, "masters"),
    // Keep the previous position's moves visible while the new position's
    // moves are being fetched — otherwise the table blanks for ~200ms on
    // every click and looks like a flicker (owner report 2026-08-19).
    placeholderData: (prev) => prev,
  });

  const [opening, setOpening] = useState<{ eco: string; name: string } | null>(null);
  useEffect(() => { if (data?.opening) setOpening(data.opening); }, [data?.opening]);
  useEffect(() => { if (fp.fen.startsWith("rnbqkbnr/pppppppp")) setOpening(null); }, [fp.fen]);

  // Wiki-book panel: the longest-prefix match against our corpus tells us
  // which named opening the current line falls under, so the panel can show
  // the curated idea (pillars) or Wikibooks excerpt (generated) from ply 1
  // onward — matches the Lichess analysis-page book behaviour the owner
  // asked for on 2026-08-19. Empty line (starting position) → no panel.
  const bookOpening = useMemo(() => (fp.history.length ? findOpeningForLine(fp.history) : null), [fp.history]);

  const memorize = () => {
    if (!fp.history.length) return;
    const name = opening ? `${opening.eco} ${opening.name}` : "Explored line";
    try { sessionStorage.setItem(OPENING_HANDOFF_KEY, JSON.stringify({ name, sans: fp.history })); } catch { /* */ }
    navigate("/study/opening-memory");
  };

  // Setup Position modal — port from Dream Meet. Loads an arbitrary FEN
  // via useFreePlay's loadPermissive (accepts board-only strings + full
  // FENs; falls back to piece-placement parse for board-editor pastes).
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupErr, setSetupErr] = useState<string | null>(null);
  const applySetup = (f: string) => {
    if (!fp.loadPermissive(f)) { setSetupErr("Could not parse that position"); return; }
    setSetupErr(null);
  };

  // 💾 Save to repertoire — light version of Dream Meet's dialog. Prompts
  // for a name (auto-suggests via findOpeningForLine), builds a plain
  // RepMoveNode tree (strips nag/comment — the repertoire API doesn't
  // persist them yet), POSTs to /api/my/repertoire. Includes the full
  // variation tree, not just the current mainline, so sidelines survive.
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  useEffect(() => { if (!saveMsg) return; const t = setTimeout(() => setSaveMsg(null), 2200); return () => clearTimeout(t); }, [saveMsg]);
  const saveToRepertoire = () => {
    if (!fp.tree.length) return;
    const suggestedName = opening ? `${opening.eco} ${opening.name}` : "Explored line";
    const raw = window.prompt("Save this line + variations to your repertoire. Name:", suggestedName);
    if (raw === null) return;
    const name = raw.trim() || suggestedName;
    // Round-trip nag + comment via the repertoire API (schema updated
    // 2026-09-02 to persist both). Structural map so hidden fields don't
    // sneak into the wire body.
    const carry = (nodes: MoveNode[]): RepMoveNode[] => nodes.map((n) => {
      const r: RepMoveNode = { san: n.san, children: carry(n.children) };
      if (n.nag) r.nag = n.nag;
      if (n.comment) r.comment = n.comment;
      return r;
    });
    const body: any = { name, kind: "line" as const, tree: carry(fp.tree), sans: fp.line };
    // If the user started from a custom setup, persist the start FEN
    // (so reloading the saved entry lands on that same position).
    if (fp.fen && fp.line.length === 0) body.startFen = fp.fen;
    void addRepertoire(body).then(() => setSaveMsg(`💾 Saved "${name}" to your repertoire`))
      .catch((e) => setSaveMsg(`Could not save (${e?.message ?? "unknown"})`));
  };

  const total = data ? data.white + data.draws + data.black : 0;
  const playUci = (uci: string) => fp.onMove(uci.slice(0, 2) as Key, uci.slice(2, 4) as Key);

  // Mouse-wheel over the board scrubs the move list (Lichess analysis
  // convention — scroll up = prev, scroll down = next). Throttled at 120 ms
  // so a single trackpad flick doesn't jump five moves. Uses a native
  // non-passive listener so preventDefault actually blocks page scroll —
  // React's synthetic onWheel is passive by default.
  const boardBoxRef = useRef<HTMLDivElement>(null);
  const moveListBoxRef = useRef<HTMLDivElement>(null);
  const activeMoveRef = useRef<HTMLButtonElement>(null);
  // Right-click menu on a move (Lichess analysis parity): Promote variation
  // / Make main line / Delete from here / Copy PGN. Position stored as
  // viewport coords; a fixed-position <div> renders at (x, y).
  const [moveMenu, setMoveMenu] = useState<{ path: number[]; x: number; y: number } | null>(null);
  const openMoveMenu = useCallback((nodePath: number[], x: number, y: number) => {
    setMoveMenu({ path: nodePath, x, y });
  }, []);
  const closeMoveMenu = useCallback(() => setMoveMenu(null), []);
  // Close on outside click / Escape / scroll.
  useEffect(() => {
    if (!moveMenu) return;
    const onDown = () => closeMoveMenu();
    const onKey2 = (e: KeyboardEvent) => { if (e.key === "Escape") closeMoveMenu(); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey2);
    window.addEventListener("scroll", onDown, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey2);
      window.removeEventListener("scroll", onDown, true);
    };
  }, [moveMenu, closeMoveMenu]);
  // Walk fp.tree along a path, gather SAN moves — used by "Copy PGN".
  const sansAtPath = useCallback((p: number[]): string[] => {
    const out: string[] = [];
    let cur: MoveNode[] = fp.tree;
    for (const idx of p) {
      const n = cur[idx];
      if (!n) break;
      out.push(n.san);
      cur = n.children;
    }
    return out;
  }, [fp.tree]);
  const formatPgn = (sans: string[]): string => {
    const parts: string[] = [];
    for (let i = 0; i < sans.length; i++) {
      const isWhite = i % 2 === 0;
      if (isWhite) parts.push(`${Math.floor(i / 2) + 1}.`);
      parts.push(sans[i]!);
    }
    return parts.join(" ");
  };
  const lastWheelTs = useRef(0);

  // Scroll the currently-active move into view whenever the cursor changes
  // (keyboard nav, wheel scroll, or a click elsewhere). Only scrolls the move
  // list's own scroll container so the page itself doesn't jump.
  useEffect(() => {
    const row = activeMoveRef.current;
    const box = moveListBoxRef.current;
    if (!row || !box) return;
    const rowTop = row.offsetTop - (box.offsetTop || 0);
    const rowBottom = rowTop + row.offsetHeight;
    if (rowTop < box.scrollTop || rowBottom > box.scrollTop + box.clientHeight) {
      box.scrollTo({ top: rowTop - box.clientHeight / 2, behavior: "smooth" });
    }
  }, [fp.path]);
  useEffect(() => {
    // Attach the scrub listener to the actual .cg-board-wrap square, not
    // the wrapping div — otherwise wheeling over the empty slack next to
    // the board (visible in the 3-col layout when the board is left-
    // aligned) also scrubs, which surprised the owner (2026-08-20:
    // "scroll should move pieces only cursor inside the board").
    const el = boardBoxRef.current?.querySelector(".cg-board-wrap") as HTMLElement | null;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) < 4) return;
      const now = Date.now();
      if (now - lastWheelTs.current < 120) { e.preventDefault(); return; }
      lastWheelTs.current = now;
      e.preventDefault();
      if (e.deltaY > 0) fp.goNext(); else fp.goPrev();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [fp]);

  // Left/Right arrow keys navigate the move list — matches Lichess analysis.
  // Ignored while an input/textarea has focus so typing in the finder search
  // doesn't accidentally scrub the board.
  const onKey = useCallback((e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement | null)?.isContentEditable) return;
    if (e.key === "ArrowLeft")  { e.preventDefault(); fp.goPrev(); }
    if (e.key === "ArrowRight") { e.preventDefault(); fp.goNext(); }
    if (e.key === "ArrowUp")    { e.preventDefault(); fp.goSibling(-1); }
    if (e.key === "ArrowDown")  { e.preventDefault(); fp.goSibling(1); }
    if (e.key === "Home") { e.preventDefault(); fp.goTo([]); }
    if (e.key === "End")  {
      e.preventDefault();
      const to = [...fp.path];
      let cur = fp.tree;
      for (const idx of fp.path) cur = cur[idx]!.children;
      while (cur.length > 0) { to.push(0); cur = cur[0]!.children; }
      fp.goTo(to);
    }
  }, [fp]);
  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  // 3-col layout: give the finder more room (owner report 2026-08-20:
  // "find the opening is small, names only half visible") and cap the
  // middle column at the board's own 552px CSS cap so the right aside
  // sits flush next to the board with just the grid-gap between them.
  // `minmax(0, 552px)` lets the middle shrink on narrower lg viewports
  // (the board follows via its 100% width).
  const gridCols = preBoardExtra
    ? "lg:grid-cols-[280px_minmax(0,552px)_360px]"
    : "lg:grid-cols-[minmax(0,1fr)_400px]";
  const gap = preBoardExtra ? "gap-2" : "gap-6";
  // Center the whole 3-col group within the viewport-wide section — the
  // columns sum to ~1200px; without justify-center the extra viewport
  // width piles up on the right and the layout hangs to the left edge
  // (owner report 2026-08-20: "all went left side, center it").
  const justify = preBoardExtra ? "lg:justify-center" : "";
  return (
    <div className={`grid ${gap} ${justify} ${gridCols}`}>
      {preBoardExtra && (
        <aside className="flex flex-col gap-4">
          {preBoardExtra}
        </aside>
      )}
      <section>
        {/* In the 3-col hub layout, left-align the board within its column
            so the visible gap between the Find-opening card and the board
            is just the grid gap (no extra centering slack). Without this,
            `.cg-board-wrap { margin-inline: auto }` splits the leftover
            slack in half and adds ~12px on each side. Owner report
            2026-08-20: "so much gap between board and left/right panel". */}
        <div ref={boardBoxRef} className={preBoardExtra ? "[&>.cg-board-wrap]:mx-0" : ""}>
          <Board fen={fp.fen} orientation={fp.orientation} turnColor={fp.turnColor}
            movableColor={annotTool.tool !== "cursor" ? undefined : "both"} dests={fp.dests} onMove={fp.onMove}
            shapes={[
              ...shapes,
              ...(annotTool.attackMode && annotTool.attackShownFrom ? computeAttackShapes(fp.fen, annotTool.attackShownFrom) : []),
              ...(annotTool.pinsMode ? computePinShapes(fp.fen) : []),
            ] as any}
            onShapesChange={(s) => setShapes(s as any)}
            onSelect={(key) => {
              const sq = String(key);
              if (annotTool.tool === "cursor" && annotTool.attackMode) {
                try {
                  const c = new Chess(fp.fen);
                  const piece = c.get(sq as any);
                  annotTool.setAttackShownFrom(!piece ? null : (annotTool.attackShownFrom === sq ? null : sq));
                } catch { /* */ }
                return;
              }
              if (annotTool.tool === "cursor") return;
              const next = applyAnnotationClick(sq, shapes, annotTool);
              if (next) setShapes(next);
            }}
          />
        </div>
        {/* Annotation toolbar (Phase 1, 2026-09-02) — sits directly below
         *  the board so it doesn't crowd the analysis panel on the right. */}
        <AnnotationToolbar
          tool={annotTool.tool}
          brush={annotTool.brush}
          onToolChange={annotTool.setTool}
          onBrushChange={annotTool.setBrush}
          onClear={() => setShapes([])}
          hasShapes={shapes.length > 0}
          attackMode={annotTool.attackMode}
          onAttackModeChange={annotTool.setAttackMode}
          textLabel={annotTool.textLabel}
          onTextLabelChange={annotTool.setTextLabel}
          pinsMode={annotTool.pinsMode}
          onPinsModeChange={annotTool.setPinsMode}
        />
        {annotTool.tool === "arrow" && annotTool.pendingArrowFrom && (
          <div className="mt-1 text-center text-[11px] font-medium text-brand-300">
            → Click the arrow's target square (or click <b>{annotTool.pendingArrowFrom}</b> again to cancel)
          </div>
        )}
        {/* Nav row: ⏮ start · ◀ prev · ▶ next · ⏭ end · Reset · Flip · Memorize.
            Prev/Next are enabled only when there's somewhere to go on the
            recorded line (Lichess analysis semantics — rewinding doesn't
            discard the future). */}
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => fp.goTo([])} disabled={fp.ply === 0}
            className="rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800 disabled:opacity-40"
            title="Jump to start">⏮</button>
          <button onClick={fp.goPrev} disabled={fp.ply === 0}
            className="rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800 disabled:opacity-40"
            title="Previous move (←)">◀</button>
          <button onClick={fp.goNext} disabled={!fp.hasNext}
            className="rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800 disabled:opacity-40"
            title="Next move (→)">▶</button>
          <button onClick={() => {
            // Walk first-child from cursor to leaf, extend path with each 0.
            const to = [...fp.path];
            let cur = fp.tree;
            for (const idx of fp.path) cur = cur[idx]!.children;
            while (cur.length > 0) { to.push(0); cur = cur[0]!.children; }
            fp.goTo(to);
          }} disabled={!fp.hasNext}
            className="rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800 disabled:opacity-40"
            title="Jump to end">⏭</button>
          <button onClick={fp.reset} className="rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800">Reset</button>
          <button onClick={fp.flip} className="rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800">⇅ Flip</button>
          <button onClick={() => setSetupOpen(true)}
            className="rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800"
            title="Load an arbitrary position — mid-game tactic, endgame, book puzzle">📋 Setup</button>
          <button onClick={saveToRepertoire} disabled={fp.history.length === 0}
            className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100 hover:bg-emerald-500/25 disabled:opacity-40"
            title="Save this line + variations to your repertoire (survives across devices)">💾 Save</button>
          <button onClick={memorize} disabled={!fp.tree.length}
            className="ml-auto rounded-lg bg-accent-600 px-3 py-2 text-sm font-semibold text-white hover:bg-accent-500 disabled:opacity-40"
            title="Send this line to the Memory Training opening trainer">🧠 Memorize</button>
        </div>

      </section>

      <aside className="flex flex-col gap-4">
        {/* Clickable PGN move list with variations — sits ABOVE the Opening
            explorer in the right rail (owner ask 2026-08-20: "moves showed
            in bottom, need that in right before opening explorer"). When
            the user rewinds and plays a new move, useFreePlay branches
            instead of truncating — each sibling renders as an indented
            variation block. Path is the array of child-indices from root;
            clicking a move jumps the board to that exact node. */}
        <div className="rounded-lg border border-ink-700 bg-ink-950 px-3 py-2">
          <div className="mb-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-ink-500">
            <span>Moves</span>
            <span className="normal-case tracking-normal text-ink-600">← → walk · ↑ ↓ switch branch</span>
          </div>
          <div ref={moveListBoxRef} className="max-h-[240px] overflow-y-auto pr-1">
            {fp.tree.length === 0 ? (
              <div className="font-mono text-xs text-ink-500">Play a move on the board to start the line…</div>
            ) : (
              <>
                <MainMoveTable root={fp.tree[0]!} rootPath={[0]}
                  cursor={fp.path} onPick={fp.goTo} onContext={openMoveMenu}
                  activeRef={activeMoveRef} />
                {fp.tree.slice(1).map((n, i) => (
                  <div key={i} className="my-1 border-l-2 border-ink-700 pl-2 text-[13px]">
                    <MoveTreeLine startNode={n} startNodePath={[i + 1]}
                      startPly={0} cursor={fp.path} onPick={fp.goTo} onContext={openMoveMenu}
                      depth={1} activeRef={activeMoveRef} />
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        {/* Explorer moves table, then the "Find an opening" tree
            (asideExtra). Halved max-height on the moves table so both fit
            side-by-side without either scrolling for pages. */}
        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-xl text-white">Opening explorer</h2>
            <span className="rounded-md border border-ink-700 px-2 py-0.5 text-xs text-ink-400">Masters</span>
          </div>

          {opening && (
            <p className="mb-3 text-sm">
              <span className="font-mono text-ink-400">{opening.eco}</span>{" "}
              <span className="text-brand-300">{opening.name}</span>
            </p>
          )}

          {total > 0 && (
            <div className="mb-1 flex items-center gap-2">
              <div className="h-3 flex-1"><WdlBar w={data!.white} d={data!.draws} b={data!.black} /></div>
              <span className="w-20 text-right text-xs text-ink-400">{total.toLocaleString()} games</span>
            </div>
          )}
          <div className="mb-3 flex justify-between text-[11px] text-ink-500">
            <span>White {total ? Math.round((data!.white / total) * 100) : 0}%</span>
            <span>Draw {total ? Math.round((data!.draws / total) * 100) : 0}%</span>
            <span>Black {total ? Math.round((data!.black / total) * 100) : 0}%</span>
          </div>

          {isError && <p className="text-sm text-rose-400">Explorer unavailable.</p>}

          <div className="max-h-[220px] divide-y divide-ink-800/70 overflow-y-auto">
            {(data?.moves ?? []).map((m) => {
              const t = m.white + m.draws + m.black;
              return (
                <button key={m.uci} onClick={() => playUci(m.uci)}
                  className="grid w-full grid-cols-[3rem_4.5rem_1fr] items-center gap-3 px-1 py-2 text-left hover:bg-ink-800">
                  <span className="font-semibold text-white">{m.san}</span>
                  <span className="text-xs text-ink-400">
                    {t.toLocaleString()}
                    <span className="ml-1 text-ink-500">{total ? Math.round((t / total) * 100) : 0}%</span>
                  </span>
                  <span className="h-3.5"><WdlBar w={m.white} d={m.draws} b={m.black} /></span>
                </button>
              );
            })}
            {data && data.moves.length === 0 && (
              <p className="py-3 text-sm text-ink-400">No master games from this position yet.</p>
            )}
          </div>
        </div>

        {/* Inline wiki-book panel — ECO name + curated idea / Wikibooks
            excerpt + White/Black plans. Appears from ply 1 onward, updates
            on every move (findOpeningForLine keeps the longest-prefix
            match). Compact variant so the aside stays scannable. */}
        {bookOpening && (
          <OpeningIdeaPanel opening={bookOpening} compact />
        )}

        {asideExtra}
      </aside>

      {/* Right-click context menu on any move in the Moves tree. Options
          mirror lichess.org/analysis: Promote variation / Make main line
          are shown only when the move sits in a variation (any path index
          > 0). Delete + Copy PGN are always available. Owner ask
          2026-08-20. */}
      {moveMenu && (() => {
        const isVariation = moveMenu.path.some((k) => k > 0);
        const doAndClose = (fn: () => void) => { fn(); closeMoveMenu(); };
        // Walk fp.tree along moveMenu.path to find the current node (used
        // by the NAG grid + comment button to show existing values).
        let targetNode: MoveNode | null = null;
        {
          let arr: MoveNode[] = fp.tree;
          for (const k of moveMenu.path) {
            const n = arr[k];
            if (!n) { targetNode = null; break; }
            targetNode = n;
            arr = n.children;
          }
        }
        const menuW = 280, menuH = 320;
        const x = Math.min(moveMenu.x, window.innerWidth - menuW - 8);
        const y = Math.min(moveMenu.y, window.innerHeight - menuH - 8);
        return (
          <div
            role="menu"
            onMouseDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
            className="fixed z-50 min-w-[270px] max-w-[300px] rounded-md border border-ink-700 bg-ink-900 py-1 text-sm text-ink-200 shadow-xl"
            style={{ left: x, top: y }}>
            {isVariation && (
              <button role="menuitem"
                onClick={() => doAndClose(() => fp.promoteVariation(moveMenu.path))}
                className="block w-full px-3 py-1.5 text-left hover:bg-ink-800">
                Promote variation
              </button>
            )}
            {isVariation && (
              <button role="menuitem"
                onClick={() => doAndClose(() => fp.makeMainLine(moveMenu.path))}
                className="block w-full px-3 py-1.5 text-left hover:bg-ink-800">
                Make main line
              </button>
            )}
            {isVariation && <div className="my-1 border-t border-ink-800" />}
            <button role="menuitem"
              onClick={() => doAndClose(() => fp.deleteFrom(moveMenu.path))}
              className="block w-full px-3 py-1.5 text-left text-rose-300 hover:bg-ink-800">
              Delete from here
            </button>
            <div className="my-1 border-t border-ink-800" />
            <button role="menuitem"
              onClick={() => doAndClose(() => {
                const pgn = formatPgn(sansAtPath(moveMenu.path));
                try { navigator.clipboard?.writeText(pgn); } catch { /* clipboard blocked — noop */ }
              })}
              className="block w-full px-3 py-1.5 text-left hover:bg-ink-800">
              Copy PGN to here
            </button>
            <div className="my-1 border-t border-ink-800" />
            {/* Annotation grid + comment editor — mirrors the class notation
             *  panel. Persists to the free-play tree (localStorage) so glyphs
             *  and comments survive reload + variation navigation. */}
            <div className="px-2 pt-1 pb-0.5 text-[10px] uppercase tracking-wide text-ink-500">Annotation</div>
            <div className="grid grid-cols-4 gap-1 px-2 pb-1">
              {NAG_PRESETS.map((p) => {
                const active = targetNode?.nag === p.text;
                return (
                  <button
                    key={p.text}
                    role="menuitem"
                    onClick={() => doAndClose(() => fp.setNodeAnnotation(moveMenu.path, { nag: p.text }))}
                    title={p.hint}
                    className={`grid h-7 place-items-center rounded font-mono text-[13px] font-bold transition ${active ? "bg-brand-500 text-white" : `${NAG_CLASS[p.text] ?? "text-ink-200"} bg-ink-800 hover:bg-ink-700`}`}
                  >
                    {p.text}
                  </button>
                );
              })}
            </div>
            {targetNode?.nag && (
              <button role="menuitem"
                onClick={() => doAndClose(() => fp.setNodeAnnotation(moveMenu.path, { nag: null }))}
                className="block w-full px-3 py-1 text-left text-[11px] text-ink-400 hover:bg-ink-800">
                × Clear annotation ({targetNode.nag})
              </button>
            )}
            <div className="my-1 border-t border-ink-800" />
            <button role="menuitem"
              onClick={() => doAndClose(() => {
                const existing = targetNode?.comment ?? "";
                const next = window.prompt("Comment on this move (up to 500 chars). Empty = no change; type '-' to clear.", existing);
                if (next === null) return;
                if (next === "-") { fp.setNodeAnnotation(moveMenu.path, { comment: null }); return; }
                if (next === "") return;
                fp.setNodeAnnotation(moveMenu.path, { comment: next.slice(0, 500) });
              })}
              className="block w-full px-3 py-1.5 text-left hover:bg-ink-800">
              {targetNode?.comment ? "💬 Edit comment" : "💬 Add comment"}
            </button>
            {targetNode?.comment && (
              <button role="menuitem"
                onClick={() => doAndClose(() => fp.setNodeAnnotation(moveMenu.path, { comment: null }))}
                className="block w-full px-3 py-1 text-left text-[11px] text-ink-400 hover:bg-ink-800">
                × Clear comment
              </button>
            )}
          </div>
        );
      })()}
      {setupOpen && (
        <PositionEditorModal
          initialFen={fp.fen}
          onApply={applySetup}
          onClose={() => setSetupOpen(false)}
          error={setupErr}
        />
      )}
      {saveMsg && (
        <div className="pointer-events-none fixed bottom-4 left-1/2 z-[80] -translate-x-1/2 rounded-lg border border-emerald-500/40 bg-ink-900/95 px-4 py-2 text-sm text-emerald-100 shadow-2xl">
          {saveMsg}
        </div>
      )}
    </div>
  );
}

/** Lichess-analysis-style two-column notation table for the MAINLINE.
 *
 *  Rows are `[moveNo, white, black]`. Any variations that branch off a
 *  mainline move (extra siblings at `node.children[1..]`) render as an
 *  indented block ON THE ROW BELOW the ply that spawned them, spanning
 *  both move columns — matching lichess.org/analysis (white left, black
 *  right, variations flow inline underneath).
 *
 *  Nested/deeper variations keep using `MoveTreeLine` (inline flow), so
 *  only the top-level mainline gets the table treatment — sub-variations
 *  read more naturally as wrapping prose. Owner ask 2026-08-20. */
function MainMoveTable({
  root, rootPath, cursor, onPick, onContext, activeRef,
}: {
  root: MoveNode; rootPath: number[]; cursor: number[];
  onPick: (path: number[]) => void;
  onContext: (nodePath: number[], clientX: number, clientY: number) => void;
  activeRef?: React.RefObject<HTMLButtonElement | null>;
}) {
  // Walk the mainline once, collecting per-row data. rootPath[0] indexes
  // into the outer tree array (usually [0] for the primary mainline).
  type Cell = { node: MoveNode; path: number[]; vars: { node: MoveNode; path: number[] }[] } | null;
  type Row = { moveNo: number; white: Cell; black: Cell };
  const rows: Row[] = [];
  let iterNode: MoveNode | undefined = root;
  let iterPath = rootPath;
  let iterPly = 0;
  let curRow: Row | null = null;
  while (iterNode) {
    const node = iterNode;
    const nodePath = iterPath;
    const ply = iterPly;
    const isWhite = ply % 2 === 0;
    const vars: { node: MoveNode; path: number[] }[] = [];
    for (let vi = 1; vi < node.children.length; vi++) {
      vars.push({ node: node.children[vi]!, path: [...nodePath, vi] });
    }
    if (isWhite) {
      curRow = { moveNo: Math.floor(ply / 2) + 1, white: { node, path: nodePath, vars }, black: null };
      rows.push(curRow);
    } else {
      if (!curRow) {
        // Line starts on black — pad with an empty white cell so the columns still line up.
        curRow = { moveNo: Math.floor(ply / 2) + 1, white: null, black: { node, path: nodePath, vars } };
        rows.push(curRow);
      } else {
        curRow.black = { node, path: nodePath, vars };
      }
    }
    const nextMain = node.children[0];
    if (!nextMain) break;
    iterPath = [...nodePath, 0];
    iterNode = nextMain;
    iterPly = ply + 1;
  }

  const cellClass = (active: boolean, side: "w" | "b") =>
    `rounded px-1.5 py-0.5 text-left font-mono text-sm transition ${active
      ? "bg-brand-500/60 text-white"
      : side === "w"
        ? "text-ink-100 hover:bg-ink-800"
        : "text-ink-200 hover:bg-ink-800"}`;

  return (
    <div>
      {rows.map((row, i) => {
        const wActive = row.white ? pathsEqual(row.white.path, cursor) : false;
        const bActive = row.black ? pathsEqual(row.black.path, cursor) : false;
        return (
          <div key={i}>
            <div className="grid grid-cols-[2rem_1fr_1fr] items-baseline gap-1">
              <span className="text-right font-mono text-[11px] text-ink-500">{row.moveNo}.</span>
              {row.white ? (
                <button ref={wActive ? activeRef : undefined}
                  onClick={() => onPick(row.white!.path)}
                  onContextMenu={(e) => { e.preventDefault(); onContext(row.white!.path, e.clientX, e.clientY); }}
                  className={cellClass(wActive, "w")}>
                  {row.white.node.san}{row.white.node.nag ? <span className={NAG_CLASS[row.white.node.nag] ?? "text-amber-300"}>{row.white.node.nag}</span> : null}
                </button>
              ) : <span />}
              {row.black ? (
                <button ref={bActive ? activeRef : undefined}
                  onClick={() => onPick(row.black!.path)}
                  onContextMenu={(e) => { e.preventDefault(); onContext(row.black!.path, e.clientX, e.clientY); }}
                  className={cellClass(bActive, "b")}>
                  {row.black.node.san}{row.black.node.nag ? <span className={NAG_CLASS[row.black.node.nag] ?? "text-amber-300"}>{row.black.node.nag}</span> : null}
                </button>
              ) : <span />}
            </div>
            {/* Text comment(s) — italic subtext below the move row. */}
            {(row.white?.node.comment || row.black?.node.comment) && (
              <div className="ml-9 mb-1 space-y-0.5 text-[11px] italic text-ink-400">
                {row.white?.node.comment && <div>{row.moveNo}. {row.white.node.comment}</div>}
                {row.black?.node.comment && <div>{row.moveNo}… {row.black.node.comment}</div>}
              </div>
            )}
            {/* Variations spawning from white's move (Black-to-move sidelines):
                render on the row underneath, spanning both move columns. */}
            {row.white?.vars.map((v, vi) => (
              <div key={`wv${vi}`} className="col-span-3 my-1 ml-8 border-l-2 border-ink-700 pl-2 text-[13px]">
                <MoveTreeLine startNode={v.node} startNodePath={v.path}
                  startPly={(row.moveNo - 1) * 2 + 1} cursor={cursor}
                  onPick={onPick} onContext={onContext}
                  depth={1} activeRef={activeRef} />
              </div>
            ))}
            {/* Variations spawning from black's move (White-to-move sidelines). */}
            {row.black?.vars.map((v, vi) => (
              <div key={`bv${vi}`} className="col-span-3 my-1 ml-8 border-l-2 border-ink-700 pl-2 text-[13px]">
                <MoveTreeLine startNode={v.node} startNodePath={v.path}
                  startPly={row.moveNo * 2} cursor={cursor}
                  onPick={onPick} onContext={onContext}
                  depth={1} activeRef={activeRef} />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** Lichess-style PGN move-tree renderer.
 *
 *  Mainline flows inline as wrapping text. When a ply has additional
 *  siblings, each sibling variation renders as its own INDENTED BLOCK
 *  below the mainline move that spawned it — bordered on the left,
 *  darker text — matching how lichess.org/analysis displays PGN.
 *  Deeper nested variations get progressively deeper indentation.
 *  Every SAN is a clickable button that jumps the board to that node. */
function MoveTreeLine({
  startNode, startNodePath, startPly, cursor, onPick, onContext, depth = 0, activeRef,
}: {
  startNode: MoveNode; startNodePath: number[]; startPly: number; cursor: number[];
  onPick: (path: number[]) => void;
  onContext: (nodePath: number[], clientX: number, clientY: number) => void;
  depth?: number;
  activeRef?: React.RefObject<HTMLButtonElement | null>;
}) {
  // Walk the mainline starting at startNode. At each ply: emit the move,
  // then emit any sibling variations that spawn from the same POSITION as
  // this move's children[0] mainline (i.e., additional children beyond
  // children[0] of the CURRENT node). Variations recurse with their own
  // known path so clicks always jump to the exact node.
  const parts: React.ReactNode[] = [];
  let iterPly = startPly;
  let iterNode: MoveNode | undefined = startNode;
  let iterPath = startNodePath;
  let openedWithVariationBlock = false;                    // whether next black move needs "N..." prefix
  while (iterNode) {
    // Per-iteration `const`s — the closures below capture THESE, not the
    // outer `let`s (which get reassigned each loop). Without this, every
    // mainline button's onClick would fire with the LAST iteration's path
    // (owner report 2026-08-19: "clicking sub-variation shows last move").
    const nodePath = iterPath;
    const node = iterNode;
    const ply = iterPly;
    const isWhite = ply % 2 === 0;
    const moveNo = Math.floor(ply / 2) + 1;
    const needsMoveNo = isWhite || openedWithVariationBlock;
    const active = pathsEqual(nodePath, cursor);
    parts.push(
      <span key={`m${nodePath.join(".")}`} className="inline-flex items-baseline">
        {needsMoveNo && (
          <span className="mr-0.5 text-ink-500">{moveNo}{isWhite ? "." : "…"}</span>
        )}
        <button ref={active ? activeRef : undefined} onClick={() => onPick(nodePath)}
          onContextMenu={(e) => { e.preventDefault(); onContext(nodePath, e.clientX, e.clientY); }}
          className={`rounded px-1.5 py-0.5 transition ${active
            ? "bg-brand-500/60 text-white"
            : depth === 0 ? "text-ink-100 hover:bg-ink-800" : "text-ink-300 hover:bg-ink-800"}`}>
          {node.san}{node.nag ? <span className={NAG_CLASS[node.nag] ?? "text-amber-300"}>{node.nag}</span> : null}
        </button>
        {node.comment && (
          <span className="ml-1 italic text-[11px] text-ink-400">{node.comment}</span>
        )}
      </span>
    );
    openedWithVariationBlock = false;

    // Variations spawn from the position AFTER curNode was played — i.e.,
    // from node.children[1..]. children[0] is the mainline continuation
    // we'll descend into next.
    const kids = node.children;
    for (let vi = 1; vi < kids.length; vi++) {
      const vPath = [...nodePath, vi];
      parts.push(
        <div key={`v${vPath.join(".")}`}
          className="my-1 border-l-2 border-ink-700 pl-2 text-[13px]"
          style={{ marginLeft: `${Math.min(depth + 1, 3) * 8}px` }}>
          <MoveTreeLine startNode={kids[vi]!} startNodePath={vPath}
            startPly={ply + 1} cursor={cursor} onPick={onPick} onContext={onContext}
            depth={depth + 1} activeRef={activeRef} />
        </div>
      );
      openedWithVariationBlock = true;                     // next black move must print "N..."
    }

    // Descend to mainline continuation.
    const nextMain = kids[0];
    if (!nextMain) break;
    iterPath = [...nodePath, 0];
    iterNode = nextMain;
    iterPly = ply + 1;
  }
  return (
    <div className={`font-mono ${depth === 0 ? "text-sm" : ""} leading-relaxed`}>
      {parts.map((p, i) => (
        <span key={i}>{p}{typeof p === "object" && (p as any).type === "span" ? " " : ""}</span>
      ))}
    </div>
  );
}

function pathsEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
