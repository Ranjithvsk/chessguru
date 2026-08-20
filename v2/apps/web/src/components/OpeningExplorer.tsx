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
 *  `asideExtra` renders ABOVE the masters table (used by the hub to slot the
 *  name drilldown into the right rail so the board stays Lichess-analysis-big). */
export default function OpeningExplorer(
  { fp: externalFp, asideExtra }: { fp?: ReturnType<typeof useFreePlay>; asideExtra?: React.ReactNode } = {},
) {
  const ownFp = useFreePlay();
  const fp = externalFp ?? ownFp;
  const navigate = useNavigate();
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
    const el = boardBoxRef.current;
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

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
      <section>
        <div ref={boardBoxRef}>
          <Board fen={fp.fen} orientation={fp.orientation} turnColor={fp.turnColor}
            movableColor="both" dests={fp.dests} onMove={fp.onMove} />
        </div>
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
                <MoveTreeLine startNode={fp.tree[0]!} startNodePath={[0]}
                  startPly={0} cursor={fp.path} onPick={fp.goTo} onContext={openMoveMenu}
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
        // Clamp inside the viewport with a rough menu size guess.
        const menuW = 220, menuH = 180;
        const x = Math.min(moveMenu.x, window.innerWidth - menuW - 8);
        const y = Math.min(moveMenu.y, window.innerHeight - menuH - 8);
        return (
          <div
            role="menu"
            onMouseDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
            className="fixed z-50 min-w-[210px] rounded-md border border-ink-700 bg-ink-900 py-1 text-sm text-ink-200 shadow-xl"
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
          </div>
        );
      })()}
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
          {node.san}
        </button>
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
