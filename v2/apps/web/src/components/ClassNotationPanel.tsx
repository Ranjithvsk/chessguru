// Dream Meet class notation panel — moved verbatim out of ClassV2.tsx so a
// second page can render the identical component. Pure mechanical move;
// see git history on ClassV2.tsx for authorship of the moved code below.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Chess } from "chess.js";
import { findOpeningForLine } from "../lib/openings";
import { addRepertoire, shareRepertoire, type RepMoveNode } from "../lib/repertoire-api";
import { activateRepertoireEntry } from "../lib/cards";
import { OpeningIdeaPanel } from "./OpeningIdeaPanel";
import {
  useClassMoveList, triggerClassSeek, triggerClassBoardAction, triggerClassPromoteVariation,
  triggerClassMakeMainline, triggerClassDeleteFrom, triggerClassAnnotateMove, type SharedTreeNode,
} from "./SharedClassBoard";

// /openings-style two-column mainline notation with inline variation branches.
// Rebuilds SAN client-side from startFen + the class-ws room's tree so
// numbering respects a Setup Position (a coach who loaded a mid-game FEN
// with 15 full-moves + black to move sees "15... Kb8" not "1. Kb8"). Coach
// clicks any ply to seek every client to that path; students see it as a
// read-only ledger. Playing a new move at a rewound cursor now creates a
// variation branch (server-side tree semantics, dd67193 → this commit).
type EnrichedNode = {
  san: string;
  path: number[];
  ply: number;         // 0-indexed from startFen
  moveNo: number;      // full-move counter
  turn: "w" | "b";     // whose move BEFORE this ply
  nag?: string;        // annotation glyph (!, ?, ±, +=, …) — appended to SAN when rendered
  comment?: string;    // coach's text comment shown under the move
  children: EnrichedNode[];
};
function pathsEqual(a: number[], b: number[]) { return a.length === b.length && a.every((v, i) => v === b[i]); }

// NAG glyph presets (PGN-standard annotation symbols). The right-click
// menu's "Annotation" grid uses this list. Colour maps to move quality
// so the coach's intent reads at a glance in the notation panel.
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

// Compute the ply / moveNo / turn for the CURRENT node given the parent
// board state — needed for correct row numbering when the pack begins mid-game.
export function ClassNotationPanel({ room, role }: { room: string; role: "coach" | "student" }) {
  const { startFen, tree, cursorPath } = useClassMoveList();
  // Save-to-repertoire dialog — whole tree from header chip OR sub-tree
  // from right-click "Save from here". Coach only.
  const [saveDialog, setSaveDialog] = useState<{ fromPath: number[] } | null>(null);
  const [ideaOpen, setIdeaOpen] = useState(false);
  const [memoToast, setMemoToast] = useState<string | null>(null);
  useEffect(() => { if (!memoToast) return; const t = setTimeout(() => setMemoToast(null), 2000); return () => clearTimeout(t); }, [memoToast]);

  // Opening name lookup — match the CURRENT-CURSOR line against the corpus so
  // the header shows "ECO · Name" as the coach explores. Uses the same
  // findOpeningForLine helper as /openings.
  const currentSans = useMemo(() => {
    try {
      const c = new Chess(startFen);
      const sans: string[] = [];
      let nodes = tree;
      for (const idx of cursorPath) {
        const n = nodes[idx];
        if (!n) break;
        const applied = c.move({ from: n.move.from, to: n.move.to, promotion: (n.move.promotion as any) || "q" });
        if (!applied) break;
        sans.push(applied.san);
        nodes = n.children;
      }
      return sans;
    } catch { return []; }
  }, [startFen, tree, cursorPath]);
  const matchedOpening = useMemo(() => currentSans.length > 0 ? findOpeningForLine(currentSans) : null, [currentSans]);
  // True only when the class board's tree begins at the standard opening —
  // repertoire is opening-focused; setup positions (endgames, mid-game
  // tactics) go through 📤 Send position → Notebook instead.
  const isOpeningStart = startFen === STANDARD_START_FEN;

  // Keyboard nav (coach only): ← → walk mainline; ↑ ↓ switch variation
  // at current branch. Mirrors /openings keyboard shortcuts.
  useEffect(() => {
    if (role !== "coach") return;
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable)) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); triggerClassBoardAction("stepBack"); }
      else if (e.key === "ArrowRight") { e.preventDefault(); triggerClassBoardAction("stepForward"); }
      else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        // Sibling switch: replace last cursor index with prev / next sibling.
        if (cursorPath.length === 0) return;
        let parentArr = tree;
        for (let i = 0; i < cursorPath.length - 1; i++) parentArr = parentArr[cursorPath[i]!]!.children;
        const k = cursorPath[cursorPath.length - 1]!;
        const dir = e.key === "ArrowUp" ? -1 : 1;
        const nk = k + dir;
        if (nk < 0 || nk >= parentArr.length) return;
        e.preventDefault();
        triggerClassSeek([...cursorPath.slice(0, -1), nk]);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [role, tree, cursorPath]);

  const memorize = () => {
    if (currentSans.length === 0) return;
    const name = matchedOpening?.name || `Line from class ${new Date().toLocaleDateString()}`;
    // activateRepertoireEntry needs an entry-like object; craft a synthetic
    // client-side entry from the current mainline. Also POST to
    // /api/my/repertoire so it survives across devices.
    const body: any = { name, kind: "line" as const, sans: currentSans };
    if (startFen && startFen !== STANDARD_START_FEN) body.startFen = startFen;
    void addRepertoire(body).then((r) => {
      if (r?.entry) {
        activateRepertoireEntry(r.entry);
        setMemoToast(`🧠 Added "${r.entry.name}" to your Opening Trainer`);
      }
    }).catch(() => setMemoToast("Could not save to trainer"));
  };
  // Enrich the wire tree with SAN + ply metadata. All branches are rendered,
  // not just the current line — that's the whole point of "moves tree".
  const enriched = useMemo(() => {
    const startTurn: "w" | "b" = (startFen.split(" ")[1] === "b" ? "b" : "w");
    const startNum = Number(startFen.split(" ")[5] || "1");
    const startPly = (startNum - 1) * 2 + (startTurn === "b" ? 1 : 0);
    const walk = (nodes: SharedTreeNode[], parentFen: string, prefix: number[], plyBase: number): EnrichedNode[] => {
      const out: EnrichedNode[] = [];
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]!;
        let san = "??";
        let nextFen = parentFen;
        try {
          const c = new Chess(parentFen);
          const applied = c.move({ from: n.move.from, to: n.move.to, promotion: (n.move.promotion as any) || "q" });
          if (applied) { san = applied.san; nextFen = c.fen(); }
        } catch { /* leave "??" */ }
        const ply = plyBase;
        const moveNo = Math.floor(ply / 2) + 1;
        const turn: "w" | "b" = ply % 2 === 0 ? "w" : "b";
        const childPath = [...prefix, i];
        out.push({
          san, path: childPath, ply, moveNo, turn,
          nag: n.nag, comment: n.comment,
          children: walk(n.children, nextFen, childPath, plyBase + 1),
        });
      }
      return out;
    };
    return { nodes: walk(tree, startFen, [], startPly), startPly, startNum, startTurn };
  }, [startFen, tree]);

  const clickable = role === "coach";
  const activeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [cursorPath]);

  const isActive = (path: number[]) => pathsEqual(path, cursorPath);
  const onPick = (path: number[]) => { if (clickable) triggerClassSeek(path); };

  // Right-click context menu — Promote variation / Make main line / Delete /
  // Copy PGN. Mirrors OpeningExplorer's move-menu. Coach-only; students'
  // right-clicks fall through to browser default.
  const [ctxMenu, setCtxMenu] = useState<{ path: number[]; x: number; y: number } | null>(null);
  const closeCtx = () => setCtxMenu(null);
  useEffect(() => {
    if (!ctxMenu) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("[data-notation-ctxmenu]")) return;
      closeCtx();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeCtx(); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [ctxMenu]);
  const onContext = (path: number[], e: React.MouseEvent) => {
    if (!clickable) return;
    e.preventDefault();
    setCtxMenu({ path, x: e.clientX, y: e.clientY });
  };
  // Copy PGN of the current line up to `path` — reuses the SAN we already
  // computed in `enriched.nodes`. Walk the mainline path down to the target.
  const sansAtPath = (target: number[]): string[] => {
    const out: string[] = [];
    let nodes = enriched.nodes;
    for (const idx of target) {
      const n = nodes[idx];
      if (!n) break;
      out.push(n.san);
      nodes = n.children;
    }
    return out;
  };
  const formatPgn = (sans: string[], startTurn: "w" | "b", startNum: number): string => {
    const parts: string[] = [];
    let num = startNum, whiteToMove = startTurn === "w";
    for (let i = 0; i < sans.length; i++) {
      if (whiteToMove) parts.push(`${num}. ${sans[i]}`);
      else if (i === 0) parts.push(`${num}... ${sans[i]}`);
      else parts.push(sans[i]!);
      if (!whiteToMove) num++;
      whiteToMove = !whiteToMove;
    }
    return parts.join(" ");
  };

  // Render one INLINE variation line (recursive): `1. e4 e5 (variation) 2. Nf3`.
  // Any node with siblings [1..] gets its own nested block below.
  const renderInline = (n: EnrichedNode, includeNumber: boolean) => {
    const active = isActive(n.path);
    return (
      <span key={n.path.join("-")} className="inline">
        {includeNumber && n.turn === "w" && (
          <span className="ml-1 mr-0.5 text-[11px] text-ink-500">{n.moveNo}.</span>
        )}
        {includeNumber && n.turn === "b" && (
          <span className="ml-1 mr-0.5 text-[11px] text-ink-500">{n.moveNo}…</span>
        )}
        <button
          type="button"
          ref={active ? activeRef : undefined}
          onClick={() => onPick(n.path)}
          onContextMenu={(e) => onContext(n.path, e)}
          disabled={!clickable}
          className={`rounded px-1 py-0.5 font-mono text-sm ${active ? "bg-brand-500/60 text-white" : "text-ink-100 hover:bg-ink-800"} ${clickable ? "cursor-pointer" : "cursor-default"}`}
        >{n.san}{n.nag ? <span className={NAG_CLASS[n.nag] ?? "text-amber-300"}>{n.nag}</span> : null}</button>
        {n.comment && (
          <span className="ml-1 italic text-[11px] text-ink-400">{n.comment}</span>
        )}
      </span>
    );
  };
  const renderVariationLine = (root: EnrichedNode) => {
    const out: any[] = [];
    let cur: EnrichedNode | undefined = root;
    let first = true;
    while (cur) {
      // Force a number every time turn switches OR this is the first node.
      out.push(renderInline(cur, first || cur.turn === "w"));
      first = false;
      // Any sibling variations on this cur's children need a nested block.
      if (cur.children.length > 1) {
        for (let vi = 1; vi < cur.children.length; vi++) {
          const v = cur.children[vi]!;
          out.push(
            <span key={"nested-" + v.path.join("-")} className="ml-1 inline-block rounded border-l-2 border-ink-700 pl-1 text-[12px] text-ink-300">
              ({renderVariationLine(v)})
            </span>
          );
        }
      }
      cur = cur.children[0];
    }
    return out;
  };

  // Build a Lichess-style two-column table for the MAINLINE (child[0] chain).
  //
  // vars for a cell must be alternatives AT THAT PLY — i.e., the SIBLINGS of
  // the mainline node in the current level of the tree. Owner report
  // 2026-09-03: 'after 4th move of black, branch opens, its showing after
  // 4th move, it should show after 5th move'. Old code used
  // node.children.slice(1) which are alternatives for the NEXT ply (e.g.,
  // alternatives for white 5 attached to black 4's row instead of white 5's).
  // Now we walk with a `siblings` pointer at each depth so the vars land in
  // the correct row.
  const mainRows = useMemo(() => {
    type Cell = { node: EnrichedNode; vars: EnrichedNode[] } | null;
    type Row = { moveNo: number; white: Cell; black: Cell };
    const rows: Row[] = [];
    let siblingArr: EnrichedNode[] = enriched.nodes;
    let node: EnrichedNode | undefined = siblingArr[0];
    let curRow: Row | null = null;
    while (node) {
      const vars = siblingArr.slice(1);
      if (node.turn === "w") {
        curRow = { moveNo: node.moveNo, white: { node, vars }, black: null };
        rows.push(curRow);
      } else {
        if (!curRow) {
          curRow = { moveNo: node.moveNo, white: null, black: { node, vars } };
          rows.push(curRow);
        } else {
          curRow.black = { node, vars };
        }
      }
      // Descend into the mainline continuation — siblings at the next depth
      // are node.children[1..] (kids of the current mainline that aren't the
      // mainline continuation itself).
      siblingArr = node.children;
      node = siblingArr[0];
    }
    return rows;
  }, [enriched.nodes]);

  // Rewind-to-start + jump-to-live pills.
  const atStart = cursorPath.length === 0;
  const atLive = useMemo(() => {
    // "Live" = end of current mainline branch. Walk child[0] from cursor
    // and check we can't extend further.
    let cur = tree;
    for (const idx of cursorPath) cur = (cur[idx]?.children) ?? [];
    return cur.length === 0;
  }, [tree, cursorPath]);

  if (enriched.nodes.length === 0) {
    return (
      <div className="shrink-0 border-t border-ink-800 bg-ink-950/60 px-3 py-2 text-[11px] text-ink-500">
        No moves yet — <span className="text-ink-400">notation appears here as the game unfolds.</span>
      </div>
    );
  }

  const cellClass = (active: boolean) =>
    `rounded px-1.5 py-0.5 text-left font-mono text-sm transition ${active ? "bg-brand-500/60 text-white" : "text-ink-100 hover:bg-ink-800"}`;

  return (
    // Fixed max-height so the notation panel NEVER pushes the board
    // smaller as moves accumulate. Owner report 2026-08-27 (mobile/tab):
    // "board size keeps shrinking until in-scroll comes for moves" — cap
    // total panel height to a fixed ~5rem on phones, ~14rem on desktop.
    // Overflow inside the scroll region takes over immediately.
    <div className="flex h-full shrink-0 flex-col overflow-hidden bg-ink-950/60 max-h-24 md:max-h-60 lg:max-h-none">
      {/* Header row 1 — Moves label + Start/Live pills + repertoire actions. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-ink-800/70 px-3 py-1 text-[10px] uppercase tracking-widest text-ink-500">
        <span>Moves</span>
        <span className="text-ink-600">·</span>
        <button
          type="button"
          onClick={() => onPick([])}
          disabled={!clickable}
          className={`rounded px-1.5 py-0.5 ${atStart ? "bg-brand-500/30 text-brand-100" : "text-ink-500 hover:text-ink-200"} ${clickable ? "cursor-pointer" : "cursor-default"}`}
          title={clickable ? "Rewind to the starting position" : "Starting position"}
        >⏮ Start</button>
        <button
          type="button"
          onClick={() => {
            // Walk mainline from cursor to leaf and seek there.
            let path = [...cursorPath];
            let cur = tree;
            for (const idx of path) cur = cur[idx]!.children;
            while (cur.length > 0) { path.push(0); cur = cur[0]!.children; }
            onPick(path);
          }}
          disabled={!clickable || atLive}
          className={`rounded px-1.5 py-0.5 ${atLive ? "bg-emerald-500/30 text-emerald-100" : "text-ink-500 hover:text-ink-200"} ${clickable && !atLive ? "cursor-pointer" : "cursor-default"}`}
          title={clickable ? "Jump to end of this line" : "End of line"}
        >⏭ Live</button>
        <div className="ml-auto flex items-center gap-1">
          {/* Repertoire actions are opening-only: hide 💾 Save + 🧠 Memorize
           *  when a Setup Position (custom start FEN) is loaded. Setup packs
           *  are one-off tactics / endgame studies — they're captured via
           *  📤 Send position → Notebook, not the opening repertoire.
           *  Owner ask 2026-08-28. */}
          {isOpeningStart && tree.length > 0 && currentSans.length > 0 && (
            <button
              type="button"
              onClick={memorize}
              className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-fuchsia-300 hover:bg-fuchsia-500/15 hover:text-fuchsia-100"
              title="Add this line to your personal Opening Trainer for spaced-repetition drill"
            >🧠 Memorize</button>
          )}
          {isOpeningStart && clickable && tree.length > 0 && (
            <button
              type="button"
              onClick={() => setSaveDialog({ fromPath: [] })}
              className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300 hover:bg-emerald-500/15 hover:text-emerald-100"
              title="Save the current tree to your repertoire (with option to share with class)"
            >💾 Save</button>
          )}
        </div>
      </div>
      {/* Header row 2 — Opening name banner (full-width, always visible when
       *  the current line matches a corpus opening). Kept on its OWN row so
       *  the ECO+name never gets truncated by the nav pills. */}
      {matchedOpening && (
        <button
          type="button"
          onClick={() => setIdeaOpen(true)}
          className="group flex shrink-0 items-center gap-2 border-b border-ink-800/70 bg-sky-500/5 px-3 py-1.5 text-left text-[11px] hover:bg-sky-500/15"
          title="Show the opening's idea + Wikibooks excerpt"
        >
          <span className="rounded bg-sky-500/25 px-1.5 py-0.5 font-mono text-[10px] font-bold text-sky-100">{matchedOpening.eco}</span>
          <span className="min-w-0 flex-1 truncate font-semibold text-sky-100">{matchedOpening.name}</span>
          <span className="shrink-0 text-sky-300 opacity-70 group-hover:opacity-100">📚 ▸</span>
        </button>
      )}
      {/* Scrollable notation grid — flex-1 so it takes whatever height is
       *  left after the header, and scrolls INSIDE the fixed outer cap. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
        {mainRows.map((row, i) => {
          const wActive = row.white ? isActive(row.white.node.path) : false;
          const bActive = row.black ? isActive(row.black.node.path) : false;
          return (
            <div key={i}>
              <div className="grid grid-cols-[2rem_1fr_1fr] items-baseline gap-1">
                <span className="text-right font-mono text-[11px] text-ink-500">{row.moveNo}.</span>
                {row.white ? (
                  <button
                    ref={wActive ? activeRef : undefined}
                    onClick={() => onPick(row.white!.node.path)}
                    onContextMenu={(e) => onContext(row.white!.node.path, e)}
                    disabled={!clickable}
                    className={cellClass(wActive)}
                  >{row.white.node.san}{row.white.node.nag ? <span className={NAG_CLASS[row.white.node.nag] ?? "text-amber-300"}>{row.white.node.nag}</span> : null}</button>
                ) : <span />}
                {row.black ? (
                  <button
                    ref={bActive ? activeRef : undefined}
                    onClick={() => onPick(row.black!.node.path)}
                    onContextMenu={(e) => onContext(row.black!.node.path, e)}
                    disabled={!clickable}
                    className={cellClass(bActive)}
                  >{row.black.node.san}{row.black.node.nag ? <span className={NAG_CLASS[row.black.node.nag] ?? "text-amber-300"}>{row.black.node.nag}</span> : null}</button>
                ) : <span />}
              </div>
              {/* Coach text comment — italic subtext below the move row. Wraps
               *  full-width so long comments don't push the row wider. */}
              {(row.white?.node.comment || row.black?.node.comment) && (
                <div className="ml-9 mb-1 space-y-0.5 text-[11px] italic text-ink-400">
                  {row.white?.node.comment && <div>{row.moveNo}. {row.white.node.comment}</div>}
                  {row.black?.node.comment && <div>{row.moveNo}… {row.black.node.comment}</div>}
                </div>
              )}
              {/* Variations from white's move (Black-to-move sidelines). */}
              {row.white?.vars.map((v, vi) => (
                <div key={`wv${vi}`} className="my-1 ml-8 border-l-2 border-ink-700 pl-2 text-[13px] text-ink-300">
                  {renderVariationLine(v)}
                </div>
              ))}
              {/* Variations from black's move (White-to-move sidelines). */}
              {row.black?.vars.map((v, vi) => (
                <div key={`bv${vi}`} className="my-1 ml-8 border-l-2 border-ink-700 pl-2 text-[13px] text-ink-300">
                  {renderVariationLine(v)}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {ctxMenu && (() => {
        // isVariation = any index in the path > 0 (i.e., not the mainline
        // choice at some branch point). Mainline nodes only get Delete +
        // Copy PGN; variations get Promote / Make main line too.
        const isVariation = ctxMenu.path.some((k) => k > 0);
        // Locate the enriched node so the annotation submenu can show
        // current nag/comment (for pre-fill + Clear affordances).
        const findNode = (nodes: EnrichedNode[], path: number[]): EnrichedNode | null => {
          let arr: EnrichedNode[] = nodes;
          let cur: EnrichedNode | null = null;
          for (const k of path) { cur = arr[k] ?? null; if (!cur) return null; arr = cur.children; }
          return cur;
        };
        const targetNode = findNode(enriched.nodes, ctxMenu.path);
        const menuW = 280, menuH = 340;
        const x = Math.min(ctxMenu.x, window.innerWidth - menuW - 8);
        const y = Math.min(ctxMenu.y, window.innerHeight - menuH - 8);
        const doAndClose = (fn: () => void) => { fn(); closeCtx(); };
        return createPortal(
          <div
            data-notation-ctxmenu
            role="menu"
            className="fixed z-[80] min-w-[270px] max-w-[300px] rounded-md border border-ink-700 bg-ink-900 py-1 text-sm text-ink-200 shadow-2xl"
            style={{ left: x, top: y }}
          >
            {isVariation && (
              <button role="menuitem"
                onClick={() => doAndClose(() => triggerClassPromoteVariation(ctxMenu.path))}
                className="block w-full px-3 py-1.5 text-left hover:bg-ink-800">
                Promote variation
              </button>
            )}
            {isVariation && (
              <button role="menuitem"
                onClick={() => doAndClose(() => triggerClassMakeMainline(ctxMenu.path))}
                className="block w-full px-3 py-1.5 text-left hover:bg-ink-800">
                Make main line
              </button>
            )}
            {isVariation && <div className="my-1 border-t border-ink-800" />}
            <button role="menuitem"
              onClick={() => doAndClose(() => {
                if (confirm("Delete this move and everything after it for the whole class?")) {
                  triggerClassDeleteFrom(ctxMenu.path);
                }
              })}
              className="block w-full px-3 py-1.5 text-left text-rose-300 hover:bg-ink-800">
              Delete from here
            </button>
            <div className="my-1 border-t border-ink-800" />
            {/* Annotation grid + comment editor — coach-only (menu itself is
             *  coach-only, `clickable` gate on onContext). Server persists the
             *  glyph + comment on the tree node so every client's notation
             *  panel updates in real time. */}
            <div className="px-2 pt-1 pb-0.5 text-[10px] uppercase tracking-wide text-ink-500">Annotation</div>
            <div className="grid grid-cols-4 gap-1 px-2 pb-1">
              {NAG_PRESETS.map((p) => {
                const active = targetNode?.nag === p.text;
                return (
                  <button
                    key={p.text}
                    role="menuitem"
                    onClick={() => doAndClose(() => triggerClassAnnotateMove(ctxMenu.path, { nag: p.text }))}
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
                onClick={() => doAndClose(() => triggerClassAnnotateMove(ctxMenu.path, { nag: null }))}
                className="block w-full px-3 py-1 text-left text-[11px] text-ink-400 hover:bg-ink-800">
                × Clear annotation ({targetNode.nag})
              </button>
            )}
            <div className="my-1 border-t border-ink-800" />
            <button role="menuitem"
              onClick={() => doAndClose(() => {
                const existing = targetNode?.comment ?? "";
                const next = window.prompt("Coach's comment on this move (up to 500 chars). Empty = no change; type '-' to clear.", existing);
                if (next === null) return;
                if (next === "-") { triggerClassAnnotateMove(ctxMenu.path, { comment: null }); return; }
                if (next === "") return;   // no change
                triggerClassAnnotateMove(ctxMenu.path, { comment: next.slice(0, 500) });
              })}
              className="block w-full px-3 py-1.5 text-left hover:bg-ink-800">
              {targetNode?.comment ? "💬 Edit comment" : "💬 Add comment"}
            </button>
            {targetNode?.comment && (
              <button role="menuitem"
                onClick={() => doAndClose(() => triggerClassAnnotateMove(ctxMenu.path, { comment: null }))}
                className="block w-full px-3 py-1 text-left text-[11px] text-ink-400 hover:bg-ink-800">
                × Clear comment
              </button>
            )}
            <div className="my-1 border-t border-ink-800" />
            <button role="menuitem"
              onClick={() => doAndClose(() => {
                const sans = sansAtPath(ctxMenu.path);
                const pgn = formatPgn(sans, enriched.startTurn, enriched.startNum);
                try { navigator.clipboard?.writeText(pgn); } catch { /* clipboard blocked — noop */ }
              })}
              className="block w-full px-3 py-1.5 text-left hover:bg-ink-800">
              Copy PGN to here
            </button>
            {isOpeningStart && (
              <button role="menuitem"
                onClick={() => doAndClose(() => setSaveDialog({ fromPath: ctxMenu.path }))}
                className="block w-full px-3 py-1.5 text-left text-emerald-300 hover:bg-ink-800">
                💾 Save from here to repertoire
              </button>
            )}
          </div>,
          document.body,
        );
      })()}
      {saveDialog && (
        <SaveToRepertoireDialog
          room={room}
          startFen={startFen}
          tree={tree}
          fromPath={saveDialog.fromPath}
          onClose={() => setSaveDialog(null)}
        />
      )}
      {ideaOpen && matchedOpening && createPortal(
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setIdeaOpen(false)}>
          <div className="w-full max-w-2xl overflow-y-auto rounded-2xl border border-sky-500/40 bg-ink-950 p-4 shadow-2xl max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-baseline justify-between">
              <div className="font-display text-base text-sky-200">📚 <span className="font-mono">{matchedOpening.eco}</span> · {matchedOpening.name}</div>
              <button onClick={() => setIdeaOpen(false)} className="rounded-md p-1 text-xl leading-none text-ink-400 hover:text-white">×</button>
            </div>
            <OpeningIdeaPanel opening={matchedOpening} compact={false} />
          </div>
        </div>,
        document.body,
      )}
      {memoToast && (
        <div className="pointer-events-none fixed left-1/2 top-6 z-[75] -translate-x-1/2 rounded-full border border-fuchsia-500/60 bg-fuchsia-500/25 px-4 py-2 text-sm font-semibold text-fuchsia-50 shadow-lg backdrop-blur">
          {memoToast}
        </div>
      )}
    </div>
  );
}

// Convert an active ws tree back to a repertoire tree (SAN-based) for saving.
// Walks the sub-tree starting at `fromPath` so the coach can save a specific
// variation via right-click "Save from here to repertoire".
export function wsTreeToRepTree(startFen: string, tree: SharedTreeNode[], fromPath: number[] = []): { startFen: string; sans: string[]; tree: RepMoveNode[] } {
  // First replay startFen + fromPath to get the base position for the save.
  let baseFen = startFen;
  let cur = tree;
  const sansToBase: string[] = [];
  try {
    const c = new Chess(startFen);
    for (const idx of fromPath) {
      const n = cur[idx];
      if (!n) break;
      const applied = c.move({ from: n.move.from, to: n.move.to, promotion: (n.move.promotion as any) || "q" });
      if (!applied) break;
      sansToBase.push(applied.san);
      cur = n.children;
    }
    baseFen = c.fen();
  } catch { /* leave as start */ }
  // Now walk cur (children at fromPath) recursively.
  const walk = (nodes: SharedTreeNode[], fen: string): RepMoveNode[] => {
    const out: RepMoveNode[] = [];
    for (const n of nodes) {
      try {
        const c = new Chess(fen);
        const applied = c.move({ from: n.move.from, to: n.move.to, promotion: (n.move.promotion as any) || "q" });
        if (!applied) continue;
        const rep: RepMoveNode = { san: applied.san, children: n.children?.length ? walk(n.children, c.fen()) : [] };
        if (n.nag) rep.nag = n.nag;
        if (n.comment) rep.comment = n.comment;
        out.push(rep);
      } catch { /* skip */ }
    }
    return out;
  };
  return { startFen: baseFen, sans: sansToBase, tree: walk(cur, baseFen) };
}

export const STANDARD_START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// Save-to-Repertoire dialog — shared by the notation-header chip + the
// right-click menu. `fromPath` chooses the sub-tree to save; empty [] saves
// the whole current tree from startFen.
function SaveToRepertoireDialog({ room, startFen, tree, fromPath, onClose }: { room: string; startFen: string; tree: SharedTreeNode[]; fromPath: number[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { startFen: repFen, sans, tree: repTree } = useMemo(() => wsTreeToRepTree(startFen, tree, fromPath), [startFen, tree, fromPath]);
  // Add-on A: auto-suggest name via findOpeningForLine.
  const suggested = useMemo(() => {
    const mainlineSuffix = (function walk(nodes: RepMoveNode[]): string[] {
      const out: string[] = [];
      let cur: RepMoveNode | undefined = nodes[0];
      while (cur) { out.push(cur.san); cur = cur.children[0]; }
      return out;
    })(repTree);
    const fullSans = [...sans, ...mainlineSuffix];
    const hit = findOpeningForLine(fullSans);
    return hit?.name ?? "";
  }, [sans, repTree]);
  const [name, setName] = useState<string>(suggested || "My line");
  useEffect(() => { if (suggested) setName(suggested); }, [suggested]);
  const [shareAfter, setShareAfter] = useState(true);
  const [forceTrain, setForceTrain] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setSaving(true); setErr(null);
    try {
      const body: any = { name: name.trim() || "My line", kind: "line" as const, tree: repTree };
      if (sans.length > 0 || repTree.length > 0) {
        // Flatten mainline SANs for legacy readers.
        const flat: string[] = [...sans];
        let cur: RepMoveNode | undefined = repTree[0];
        while (cur) { flat.push(cur.san); cur = cur.children[0]; }
        body.sans = flat;
      }
      // Persist the SETUP-position start fen when the coach saved from a
      // non-standard board (endgame study, mid-game tactic, etc.). Skip when
      // it's the standard opening so old clients don't get an unnecessary
      // field. `repFen` here is the fen AT the fromPath — which for save-
      // from-here is the position where the coach right-clicked.
      if (repFen && repFen !== STANDARD_START_FEN) body.startFen = repFen;
      const r = await addRepertoire(body);
      qc.invalidateQueries({ queryKey: ["my-repertoire"] });
      if (shareAfter && r?.entry?._id) {
        try {
          const klass = await fetch(`/v2api/api/class/schedule/${encodeURIComponent(room)}`, { credentials: "include" }).then((x) => x.ok ? x.json() : null);
          const studentIds: string[] = Array.isArray(klass?.batchStudentIds) ? klass.batchStudentIds : [];
          if (studentIds.length > 0) await shareRepertoire(r.entry._id, studentIds, forceTrain);
        } catch { /* toast still shows saved */ }
      }
      onClose();
    } catch (e: any) {
      setErr(e?.message || String(e));
      setSaving(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onKeyDown={(e) => { if (e.key === "Escape") onClose(); }} tabIndex={-1}>
      <div className="w-full max-w-md rounded-2xl border border-emerald-500/40 bg-gradient-to-br from-ink-900 to-ink-950 p-5 shadow-2xl">
        <div className="mb-3 flex items-baseline justify-between">
          <div className="font-display text-base font-bold text-white">💾 Save to repertoire</div>
          <button onClick={onClose} className="rounded-md p-1 text-xl leading-none text-ink-400 hover:text-white">×</button>
        </div>
        <div className="mb-3 text-xs text-ink-400">
          Saves {fromPath.length === 0 ? "the whole current tree" : `the sub-tree from move ${fromPath.length}`}
          {suggested && <> · auto-named <span className="text-brand-300">{suggested}</span></>}
        </div>
        {repFen && repFen !== STANDARD_START_FEN && (
          <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
            📋 <span className="font-semibold">Setup position</span> — the start FEN will be saved so you can reload this exact board later.
            <div className="mt-0.5 truncate font-mono text-[10px] text-amber-200/70" title={repFen}>{repFen}</div>
          </div>
        )}
        <label className="block text-[10px] font-bold uppercase tracking-widest text-ink-500">Name</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={140}
          className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
          autoFocus />
        <div className="mt-3 rounded-lg border border-ink-800 bg-ink-950/40 p-2 text-[11px]">
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={shareAfter} onChange={(e) => setShareAfter(e.target.checked)} className="h-3.5 w-3.5 accent-brand-500" />
            <span className="text-ink-200">Share with this class's students immediately</span>
          </label>
          {shareAfter && (
            <label className="mt-1 ml-6 flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={forceTrain} onChange={(e) => setForceTrain(e.target.checked)} className="h-3.5 w-3.5 accent-amber-500" />
              <span className="text-ink-300">⚡ Force into their Opening Trainer</span>
            </label>
          )}
        </div>
        {err && <div className="mt-2 text-[12px] text-rose-400">{err}</div>}
        <div className="mt-4 flex items-center gap-2">
          <button onClick={save} disabled={saving}
            className="flex-1 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-sm font-bold text-white shadow hover:brightness-110 disabled:opacity-60">
            {saving ? "Saving…" : "💾 Save"}
          </button>
          <button onClick={onClose} className="rounded-lg border border-ink-700 bg-ink-800 px-4 py-2 text-sm text-ink-200 hover:bg-ink-700">Cancel</button>
        </div>
      </div>
    </div>
  );
}
