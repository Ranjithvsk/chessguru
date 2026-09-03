// Chapter editor — the workhorse of the study module.
// Route: /studies/:sid/edit/:cid
//
// Layout:
//   ┌────────────────────┬────────────────────────┐
//   │                    │  Move list             │
//   │      Board         │  1. e4    e5           │
//   │                    │  2. Nf3 ← current      │
//   │                    │                        │
//   ├────────────────────┼────────────────────────┤
//   │  Nav + SAN input   │  Undo / Save / Flip    │
//   └────────────────────┴────────────────────────┘
//
// Move entry:
//   • Click a piece then click destination (chessground onMove fires)
//   • Type SAN in the input ("Nf3", "O-O", "Bxf7+")
//   • Click any past move in the list → jump to that position
//   • Playing a move from a NON-tip position creates a variation (branch)
//
// Right-click drag on board → arrow; right-click a square → circle.
// Shapes attach to the "current move" (the last node in currentPath).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Chess } from "chess.js";
import type { Key } from "chessground/types";
import type { DrawShape } from "chessground/draw";
import Board from "../components/Board";
import { api } from "../lib/api";
import { studiesApi, type MoveNode, type Shape } from "../lib/studies-api";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// nanoid-lite: a stable random id for a move node (6 chars is plenty at study scale).
function nid(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

// NAG (Numeric Annotation Glyph) presets — mirror the /openings + Dream Meet
// class-board notation. Values are the standard PGN NAG codes 1-6 which the
// server's cleanHeaders passes through unchanged.
const NAG_PRESETS: { text: string; label: string; nag: number }[] = [
  { text: "!",  label: "Good move",       nag: 1 },
  { text: "?",  label: "Mistake",         nag: 2 },
  { text: "!!", label: "Brilliant",       nag: 3 },
  { text: "??", label: "Blunder",         nag: 4 },
  { text: "!?", label: "Interesting",     nag: 5 },
  { text: "?!", label: "Dubious",         nag: 6 },
];
const NAG_TEXT: Record<number, string> = { 1: "!", 2: "?", 3: "!!", 4: "??", 5: "!?", 6: "?!" };
const NAG_COLOR: Record<number, string> = {
  1: "text-emerald-400", 2: "text-amber-300", 3: "text-emerald-300",
  4: "text-rose-400", 5: "text-blue-300", 6: "text-orange-300",
};
const nagToText = (n?: number): string => (n && NAG_TEXT[n]) || "";

/** Build a chess.js game by replaying from startingFen through a path of nodes. */
function replayTo(startingFen: string, path: MoveNode[]): Chess {
  const g = new Chess(startingFen);
  for (const n of path) g.move({ from: n.uci.slice(0, 2), to: n.uci.slice(2, 4), promotion: n.uci.slice(4) || undefined } as any);
  return g;
}

/** Chessground `dests` map for the current position — every legal move. */
function destsFor(g: Chess): Map<Key, Key[]> {
  const dests = new Map<Key, Key[]>();
  const squares = ["a", "b", "c", "d", "e", "f", "g", "h"].flatMap((f) => [1, 2, 3, 4, 5, 6, 7, 8].map((r) => `${f}${r}`));
  for (const from of squares) {
    const moves = g.moves({ square: from as any, verbose: true }) as any[];
    if (moves.length) dests.set(from as Key, moves.map((m) => m.to as Key));
  }
  return dests;
}

/** From a flat moves array, compute the CHILDREN of a given nodeId (null = root). */
function childrenOf(moves: MoveNode[], parentId: string | null): MoveNode[] {
  return moves.filter((m) => m.parentId === parentId);
}

/** Follow the main line from a given node down to a leaf, returning the tail. */
function followMainLine(moves: MoveNode[], fromId: string | null): MoveNode[] {
  const tail: MoveNode[] = [];
  let pid = fromId;
  while (true) {
    const kids = childrenOf(moves, pid);
    if (!kids.length) break;
    const main = kids.find((k) => k.isMainLine) ?? kids[0];
    tail.push(main);
    pid = main.id;
  }
  return tail;
}

/** Path from root to a given nodeId (inclusive), or [] if id is null. */
function pathTo(moves: MoveNode[], nodeId: string | null): MoveNode[] {
  if (!nodeId) return [];
  const byId = new Map(moves.map((m) => [m.id, m]));
  const out: MoveNode[] = [];
  let cur = byId.get(nodeId);
  while (cur) {
    out.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return out;
}

export default function StudyChapterEditPage() {
  const { sid = "", cid = "" } = useParams<{ sid: string; cid: string }>();
  const qc = useQueryClient();
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const q = useQuery({
    queryKey: ["chapter", sid, cid],
    queryFn: () => studiesApi.getChapter(sid, cid),
    enabled: !!auth?.loggedIn && !!sid && !!cid,
  });

  // Local editable state, seeded from server response.
  const [title, setTitle] = useState("");
  const [startingFen, setStartingFen] = useState(START_FEN);
  const [moves, setMoves] = useState<MoveNode[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [sanInput, setSanInput] = useState("");
  const [sanError, setSanError] = useState("");
  const [dirty, setDirty] = useState(false);
  const seededRef = useRef(false);

  useEffect(() => {
    if (!q.data || seededRef.current) return;
    setTitle(q.data.title);
    setStartingFen(q.data.startingFen);
    setMoves(q.data.moves || []);
    // Land on the last main-line move so re-opening a chapter feels resumable.
    const tail = followMainLine(q.data.moves || [], null);
    setCurrentId(tail.length ? tail[tail.length - 1]!.id : null);
    seededRef.current = true;
  }, [q.data]);

  const currentPath = useMemo(() => pathTo(moves, currentId), [moves, currentId]);
  const board = useMemo(() => replayTo(startingFen, currentPath), [startingFen, currentPath]);
  const dests = useMemo(() => destsFor(board), [board]);
  const fen = board.fen();
  const turnColor: "white" | "black" = board.turn() === "w" ? "white" : "black";
  const isCheck = board.inCheck();
  const lastMove: [Key, Key] | undefined = currentPath.length
    ? [currentPath[currentPath.length - 1]!.uci.slice(0, 2) as Key, currentPath[currentPath.length - 1]!.uci.slice(2, 4) as Key]
    : undefined;

  const shapes: DrawShape[] = useMemo(() => {
    if (!currentPath.length) return [];
    const s = currentPath[currentPath.length - 1]!.shapes || [];
    return s.map((sh) => ({ brush: sh.brush, orig: sh.orig as Key, dest: sh.dest as Key | undefined }));
  }, [currentPath]);

  // Play a move — either extending main line, extending a variation, or
  // creating a new variation if the played move doesn't match the existing
  // main-line child.
  const playMove = (uci: string, san: string) => {
    setSanError("");
    setDirty(true);
    const parentId: string | null = currentId;
    // Does the parent already have a child with the same uci?
    const kids = childrenOf(moves, parentId);
    const existing = kids.find((k) => k.uci === uci);
    if (existing) {
      // Just move focus to the existing node — no dup.
      setCurrentId(existing.id);
      return;
    }
    // Simulate to get fenAfter.
    const sim = replayTo(startingFen, currentPath);
    const played = sim.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined } as any);
    if (!played) { setSanError("illegal move"); return; }
    const isMain = kids.length === 0; // first move from this position is main; branches are variations
    const node: MoveNode = {
      id: nid(),
      parentId,
      ply: currentPath.length + 1,
      san,
      uci,
      fenAfter: sim.fen(),
      isMainLine: isMain,
    };
    setMoves((prev) => [...prev, node]);
    setCurrentId(node.id);
  };

  const onBoardMove = (from: Key, to: Key) => {
    const sim = replayTo(startingFen, currentPath);
    // chess.js needs promotion — default to queen if the pawn lands on the last rank
    const piece = sim.get(from as any);
    let promotion: string | undefined = undefined;
    if (piece && piece.type === "p" && ((piece.color === "w" && to[1] === "8") || (piece.color === "b" && to[1] === "1"))) {
      promotion = "q";
    }
    const m = sim.move({ from, to, promotion } as any);
    if (!m) return;
    playMove(m.from + m.to + (m.promotion || ""), m.san);
  };

  const submitSan = () => {
    const s = sanInput.trim();
    if (!s) return;
    const sim = replayTo(startingFen, currentPath);
    const m = sim.move(s, { strict: false } as any);
    if (!m) { setSanError(`can't play "${s}" here`); return; }
    playMove(m.from + m.to + (m.promotion || ""), m.san);
    setSanInput("");
  };

  const onShapesChange = (newShapes: DrawShape[]) => {
    if (!currentPath.length) return; // shapes only stick to a move, not the starting position
    const s: Shape[] = newShapes.map((sh) => ({
      brush: (["green", "red", "blue", "yellow"].includes(sh.brush as any) ? sh.brush : "green") as any,
      orig: sh.orig,
      dest: sh.dest,
    }));
    const last = currentPath[currentPath.length - 1]!;
    setMoves((prev) => prev.map((m) => m.id === last.id ? { ...m, shapes: s } : m));
    setDirty(true);
  };

  const goBack = () => {
    if (!currentPath.length) return;
    const parent = currentPath.length >= 2 ? currentPath[currentPath.length - 2]!.id : null;
    setCurrentId(parent);
  };
  const goForward = () => {
    const kids = childrenOf(moves, currentId);
    if (!kids.length) return;
    const main = (kids.find((k) => k.isMainLine) ?? kids[0])!;
    setCurrentId(main.id);
  };
  const goStart = () => setCurrentId(null);
  const goEnd = () => {
    const tail = followMainLine(moves, currentId);
    if (tail.length) setCurrentId(tail[tail.length - 1]!.id);
  };

  // Delete the current subtree (this move + everything descending from it).
  const deleteFromHere = () => {
    if (!currentId) return;
    if (!confirm("Delete this move and all subsequent moves in this line?")) return;
    const doomed = new Set<string>();
    const collect = (id: string) => {
      doomed.add(id);
      for (const k of childrenOf(moves, id)) collect(k.id);
    };
    collect(currentId);
    const parent = currentPath.length >= 2 ? currentPath[currentPath.length - 2]!.id : null;
    setMoves((prev) => prev.filter((m) => !doomed.has(m.id)));
    setCurrentId(parent);
    setDirty(true);
  };

  // ⭐ toggle "revise this position" on the current move.
  const toggleRevise = () => {
    if (!currentId) return;
    setMoves((prev) => prev.map((m) => m.id === currentId ? { ...m, isRevisePoint: !m.isRevisePoint } : m));
    setDirty(true);
  };

  // Comment on current move.
  const setCurrentComment = (val: string) => {
    if (!currentId) return;
    setMoves((prev) => prev.map((m) => m.id === currentId ? { ...m, comment: val || undefined } : m));
    setDirty(true);
  };

  // ── Right-click menu mutations (parity with /openings notation panel) ──
  // Owner ask 2026-09-02: "all" — full parity plus keep ⭐/💬 icons.

  // Set nag / comment on a specific node (not the current node — the right-
  // clicked one). Overwrite semantics: nag=null clears, comment=null clears.
  const setNodeAnnotation = (nodeId: string, patch: { nag?: number | null; comment?: string | null }) => {
    setMoves((prev) => prev.map((m) => {
      if (m.id !== nodeId) return m;
      const next = { ...m };
      if ("nag" in patch) { if (patch.nag == null) delete next.nag; else next.nag = patch.nag; }
      if ("comment" in patch) { if (!patch.comment) delete next.comment; else next.comment = patch.comment.slice(0, 500); }
      return next;
    }));
    setDirty(true);
  };

  // Promote a variation up one level: swap isMainLine between the target and
  // whichever of its siblings currently owns isMainLine (at the same parent).
  const promoteVariation = (nodeId: string) => {
    const node = moves.find((m) => m.id === nodeId);
    if (!node) return;
    const siblings = childrenOf(moves, node.parentId);
    if (siblings.length < 2) return;                   // no sibling to swap with
    const currentMain = siblings.find((s) => s.isMainLine);
    if (!currentMain || currentMain.id === nodeId) return;
    setMoves((prev) => prev.map((m) => {
      if (m.id === nodeId) return { ...m, isMainLine: true };
      if (m.id === currentMain.id) return { ...m, isMainLine: false };
      return m;
    }));
    setDirty(true);
  };

  // Make this node the main line all the way to the root — walk up demoting
  // each ancestor's mainline sibling in favour of the path from root to here.
  const makeMainLine = (nodeId: string) => {
    let cur: MoveNode | undefined = moves.find((m) => m.id === nodeId);
    if (!cur) return;
    const wantMain = new Set<string>();
    while (cur) {
      wantMain.add(cur.id);
      cur = cur.parentId ? moves.find((m) => m.id === cur!.parentId) : undefined;
    }
    // Any sibling of a want-main node that's currently main must be demoted.
    setMoves((prev) => prev.map((m) => {
      if (wantMain.has(m.id) && !m.isMainLine) return { ...m, isMainLine: true };
      if (!wantMain.has(m.id) && m.isMainLine) {
        // Only demote if a sibling in wantMain took over — otherwise leave.
        const sibs = prev.filter((s) => s.parentId === m.parentId && s.id !== m.id);
        if (sibs.some((s) => wantMain.has(s.id))) return { ...m, isMainLine: false };
      }
      return m;
    }));
    setDirty(true);
  };

  // Delete node + subtree (used by right-click menu — same collect logic as
  // the current deleteFromHere but for an arbitrary node, not just currentId).
  const deleteSubtree = (nodeId: string) => {
    const doomed = new Set<string>();
    const collect = (id: string) => {
      doomed.add(id);
      for (const k of childrenOf(moves, id)) collect(k.id);
    };
    collect(nodeId);
    // If the current cursor is inside the doomed subtree, hop it up to the parent.
    const node = moves.find((m) => m.id === nodeId);
    const parent = node?.parentId ?? null;
    if (currentId && doomed.has(currentId)) setCurrentId(parent);
    setMoves((prev) => prev.filter((m) => !doomed.has(m.id)));
    setDirty(true);
  };

  // Build a PGN string from the FULL move tree (all mainlines + variations).
  // Follows the same format the /openings save uses so a copied PGN pastes
  // cleanly into any other analysis tool.
  const buildPgn = useCallback((rootMoves: MoveNode[]): string => {
    // startTurn/startNum derived from startingFen so mid-game positions get
    // the right ply numbers.
    let startTurn: "w" | "b" = "w", startNum = 1;
    if (startingFen) {
      const parts = startingFen.split(" ");
      startTurn = parts[1] === "b" ? "b" : "w";
      startNum = parseInt(parts[5] || "1", 10) || 1;
    }
    const walk = (parentId: string | null, plyBase: number, isVariation: boolean): string => {
      const kids = childrenOf(rootMoves, parentId);
      if (!kids.length) return "";
      const main = (kids.find((k) => k.isMainLine) ?? kids[0])!;
      const siblings = kids.filter((k) => k.id !== main.id);
      const isWhite = startTurn === "w" ? plyBase % 2 === 0 : plyBase % 2 === 1;
      const moveNum = Math.floor(plyBase / 2) + startNum;
      const parts: string[] = [];
      if (isWhite) parts.push(`${moveNum}.${main.san}${main.nag ? " " + nagToText(main.nag) : ""}`);
      else parts.push((isVariation || plyBase === 0) ? `${moveNum}...${main.san}${main.nag ? " " + nagToText(main.nag) : ""}` : `${main.san}${main.nag ? " " + nagToText(main.nag) : ""}`);
      if (main.comment) parts.push(`{${main.comment.replace(/[{}]/g, "")}}`);
      for (const s of siblings) {
        const sHead = isWhite ? `${moveNum}.${s.san}${s.nag ? " " + nagToText(s.nag) : ""}` : `${moveNum}...${s.san}${s.nag ? " " + nagToText(s.nag) : ""}`;
        const sTail = walk(s.id, plyBase + 1, true);
        const sCmt = s.comment ? ` {${s.comment.replace(/[{}]/g, "")}}` : "";
        parts.push(`(${sHead}${sCmt}${sTail ? " " + sTail : ""})`);
      }
      const rest = walk(main.id, plyBase + 1, false);
      if (rest) parts.push(rest);
      return parts.join(" ");
    };
    return walk(null, 0, false);
  }, [startingFen]);

  const copyPgnAt = async (nodeId: string) => {
    // Whole-tree PGN — same format as /openings save. Node-specific slicing
    // is a Phase 2 nice-to-have.
    void nodeId;
    const pgn = buildPgn(moves);
    try { await navigator.clipboard.writeText(pgn); }
    catch { /* fallback: open a prompt so the user can copy manually */
      window.prompt("Copy PGN:", pgn);
    }
  };

  // Right-click menu state (fixed-position at viewport coords).
  const [moveMenu, setMoveMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const openMoveMenu = (id: string, x: number, y: number) => setMoveMenu({ id, x, y });
  const closeMoveMenu = () => setMoveMenu(null);
  useEffect(() => {
    if (!moveMenu) return;
    const onDown = () => closeMoveMenu();
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") closeMoveMenu(); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onEsc);
    window.addEventListener("scroll", onDown, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onEsc);
      window.removeEventListener("scroll", onDown, true);
    };
  }, [moveMenu]);

  // Mouse-wheel over the board scrubs the move list — matches /openings +
  // Lichess analysis convention. Throttled at 120 ms so a trackpad flick
  // doesn't jump five moves.
  const boardBoxRef = useRef<HTMLDivElement>(null);
  const lastWheelTs = useRef(0);
  useEffect(() => {
    const el = boardBoxRef.current?.querySelector(".cg-board-wrap") as HTMLElement | null;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) < 4) return;
      const now = Date.now();
      if (now - lastWheelTs.current < 120) { e.preventDefault(); return; }
      lastWheelTs.current = now;
      e.preventDefault();
      if (e.deltaY > 0) goForward(); else goBack();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [moves, currentId]);

  const save = useMutation({
    mutationFn: () => studiesApi.saveChapter(sid, cid, { title, startingFen, moves }),
    onSuccess: () => { setDirty(false); qc.invalidateQueries({ queryKey: ["chapter", sid, cid] }); },
  });

  // Keyboard: arrow keys navigate the tree
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); goBack(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); goForward(); }
      else if (e.key === "Home") { e.preventDefault(); goStart(); }
      else if (e.key === "End") { e.preventDefault(); goEnd(); }
      else if (e.key === "f") { setOrientation((o) => o === "white" ? "black" : "white"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moves, currentId, currentPath]);

  if (auth && !auth.loggedIn) return <Navigate to={`/login?back=/studies/${encodeURIComponent(sid)}/edit/${encodeURIComponent(cid)}`} replace />;
  if (q.isLoading) return <div className="mx-auto max-w-5xl px-3 py-8 text-sm text-ink-400">Loading…</div>;
  if (q.error) return <div className="mx-auto max-w-5xl px-3 py-8 rounded border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{String((q.error as any)?.message || q.error)}</div>;

  const currentNode = currentId ? moves.find((m) => m.id === currentId) : null;

  return (
    <div className="mx-auto max-w-6xl px-3 py-4">
      <Link to={`/studies/${encodeURIComponent(sid)}`} className="mb-2 inline-block text-xs text-ink-400 hover:text-ink-200">← Back to study</Link>

      {/* Chapter title (editable) */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true); }}
          maxLength={140}
          className="flex-1 min-w-[200px] rounded-lg border border-ink-700 bg-ink-900 px-3 py-1.5 font-display text-lg text-white outline-none focus:border-brand-500" />
        <button onClick={() => save.mutate()} disabled={!dirty || save.isPending}
          className={`rounded-lg px-4 py-1.5 text-sm font-semibold text-white ${dirty ? "bg-brand-600 hover:bg-brand-500" : "bg-ink-800 text-ink-500"} disabled:opacity-50`}>
          {save.isPending ? "Saving…" : dirty ? "💾 Save" : "✓ Saved"}
        </button>
      </div>

      {save.error && <div className="mb-3 rounded border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-200">{String((save.error as any)?.message || save.error)}</div>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,540px)_1fr]">
        {/* Board column — wrapped in boardBoxRef so the wheel-scrub listener
         *  can attach to .cg-board-wrap specifically (matches /openings). */}
        <div ref={boardBoxRef}>
          <Board fen={fen}
            orientation={orientation}
            turnColor={turnColor}
            movableColor={turnColor}
            dests={dests}
            lastMove={lastMove}
            check={isCheck}
            shapes={shapes}
            onShapesChange={onShapesChange}
            onMove={onBoardMove}
          />
          <div className="mt-2 flex flex-wrap items-center gap-1 text-xs">
            <button onClick={goStart}  className="rounded border border-ink-700 px-2 py-1 hover:bg-ink-800" title="First position (Home)">⏮</button>
            <button onClick={goBack}   className="rounded border border-ink-700 px-2 py-1 hover:bg-ink-800" title="Previous move (←)">◀</button>
            <button onClick={goForward} className="rounded border border-ink-700 px-2 py-1 hover:bg-ink-800" title="Next move (→)">▶</button>
            <button onClick={goEnd}    className="rounded border border-ink-700 px-2 py-1 hover:bg-ink-800" title="Last move (End)">⏭</button>
            <button onClick={() => setOrientation((o) => o === "white" ? "black" : "white")}
              className="rounded border border-ink-700 px-2 py-1 hover:bg-ink-800" title="Flip board (f)">↕ Flip</button>
            <button onClick={toggleRevise} disabled={!currentId}
              className={`rounded border px-2 py-1 disabled:opacity-40 ${currentNode?.isRevisePoint ? "border-amber-500 bg-amber-500/20 text-amber-100" : "border-ink-700 hover:bg-ink-800"}`}
              title="Mark this position for spaced-repetition review">
              {currentNode?.isRevisePoint ? "⭐ Revising" : "☆ Revise"}
            </button>
            <button onClick={deleteFromHere} disabled={!currentId}
              className="rounded border border-rose-500/40 px-2 py-1 text-rose-300 hover:bg-rose-500/10 disabled:opacity-40" title="Delete this move + everything after">
              🗑 Delete line
            </button>
          </div>

          {/* SAN input */}
          <form onSubmit={(e) => { e.preventDefault(); submitSan(); }} className="mt-3 flex gap-2">
            <input value={sanInput} onChange={(e) => { setSanInput(e.target.value); setSanError(""); }}
              placeholder="Type move: e4, Nf3, O-O, Bxf7+"
              className="flex-1 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 font-mono text-sm text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
            <button type="submit" className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-500">Play</button>
          </form>
          {sanError && <div className="mt-1 text-xs text-rose-300">{sanError}</div>}
        </div>

        {/* Move list + comment */}
        <div className="rounded-xl border border-ink-700 bg-ink-900/60 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Moves</div>
          <MoveTree moves={moves} currentId={currentId} onJump={setCurrentId} onContext={openMoveMenu} />

          {/* Comment on current position */}
          <div className="mt-4">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">
              Comment on this move {currentNode ? `(${currentNode.san})` : "(no move selected)"}
            </label>
            <textarea rows={3} disabled={!currentId}
              value={currentNode?.comment || ""}
              onChange={(e) => setCurrentComment(e.target.value)}
              placeholder="Your notes about this position — students will read this."
              className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none disabled:opacity-50" />
          </div>

          <div className="mt-4 rounded bg-ink-800/70 p-2 text-[10px] text-ink-500">
            <div>💡 <b>Enter moves</b>: click on board or type SAN (like <code>Nf3</code>).</div>
            <div>💡 <b>Arrows/circles</b>: right-click drag on the board.</div>
            <div>💡 <b>Variations</b>: jump back to an old move, then play a different one.</div>
            <div>💡 <b>Keys</b>: ← / → navigate, <b>f</b> flips the board.</div>
          </div>
        </div>
      </div>

      {/* Right-click menu on any move in the notation panel — Lichess-analysis
       *  parity with /openings + Dream Meet class board. Promote/Make main
       *  line only show for variation nodes (those whose parent has more
       *  than one child, and this isn't the current mainline sibling). NAG
       *  picker + comment always available. Positioned in fixed viewport
       *  coords so it doesn't scroll away. */}
      {moveMenu && (() => {
        const node = moves.find((m) => m.id === moveMenu.id);
        if (!node) return null;
        const siblings = childrenOf(moves, node.parentId);
        const isVariation = siblings.length > 1 && !node.isMainLine;
        const doAndClose = (fn: () => void) => { fn(); closeMoveMenu(); };
        const menuW = 280, menuH = 340;
        const x = Math.min(moveMenu.x, window.innerWidth - menuW - 8);
        const y = Math.min(moveMenu.y, window.innerHeight - menuH - 8);
        return (
          <div role="menu"
            onMouseDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
            className="fixed z-50 min-w-[260px] max-w-[300px] rounded-md border border-ink-700 bg-ink-900 py-1 text-sm text-ink-200 shadow-xl"
            style={{ left: x, top: y }}>
            <div className="px-3 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-500">
              {node.san} (ply {node.ply})
            </div>
            {isVariation && (
              <>
                <button role="menuitem"
                  onClick={() => doAndClose(() => promoteVariation(moveMenu.id))}
                  className="block w-full px-3 py-1.5 text-left hover:bg-ink-800">
                  ⬆ Promote variation
                </button>
                <button role="menuitem"
                  onClick={() => doAndClose(() => makeMainLine(moveMenu.id))}
                  className="block w-full px-3 py-1.5 text-left hover:bg-ink-800">
                  ⭐ Make main line
                </button>
                <div className="my-1 border-t border-ink-800" />
              </>
            )}
            {/* NAG (move-quality glyph) picker — grid layout so all 6 fit in one row. */}
            <div className="px-3 py-1">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-ink-500">Annotation glyph</div>
              <div className="grid grid-cols-6 gap-1">
                {NAG_PRESETS.map((p) => (
                  <button key={p.nag} role="menuitem" title={p.label}
                    onClick={() => doAndClose(() => setNodeAnnotation(moveMenu.id, { nag: p.nag }))}
                    className={`rounded border border-ink-700 py-1 font-mono text-xs hover:bg-ink-800 ${node.nag === p.nag ? "bg-ink-800 " + (NAG_COLOR[p.nag] ?? "text-amber-300") : ""}`}>
                    {p.text}
                  </button>
                ))}
              </div>
              {node.nag && (
                <button role="menuitem"
                  onClick={() => doAndClose(() => setNodeAnnotation(moveMenu.id, { nag: null }))}
                  className="mt-1 block w-full rounded py-1 text-left text-[11px] text-ink-400 hover:bg-ink-800">
                  Clear glyph
                </button>
              )}
            </div>
            <div className="my-1 border-t border-ink-800" />
            <button role="menuitem"
              onClick={() => doAndClose(() => {
                const existing = node.comment ?? "";
                const next = window.prompt("Comment on this move (up to 500 chars). Empty = no change; type '-' to clear.", existing);
                if (next === null) return;                     // cancel
                if (next === "") return;                       // no change
                if (next === "-") { setNodeAnnotation(moveMenu.id, { comment: null }); return; }
                setNodeAnnotation(moveMenu.id, { comment: next });
              })}
              className="block w-full px-3 py-1.5 text-left hover:bg-ink-800">
              💬 {node.comment ? "Edit comment" : "Add comment"}
            </button>
            {node.comment && (
              <button role="menuitem"
                onClick={() => doAndClose(() => setNodeAnnotation(moveMenu.id, { comment: null }))}
                className="block w-full px-3 py-1.5 text-left text-ink-400 hover:bg-ink-800">
                Clear comment
              </button>
            )}
            <div className="my-1 border-t border-ink-800" />
            <button role="menuitem"
              onClick={() => doAndClose(() => copyPgnAt(moveMenu.id))}
              className="block w-full px-3 py-1.5 text-left hover:bg-ink-800">
              📋 Copy PGN
            </button>
            <button role="menuitem"
              onClick={() => doAndClose(() => {
                if (confirm(`Delete "${node.san}" and every move after it in this line?`)) deleteSubtree(moveMenu.id);
              })}
              className="block w-full px-3 py-1.5 text-left text-rose-300 hover:bg-rose-500/10">
              🗑 Delete from here
            </button>
          </div>
        );
      })()}
    </div>
  );
}

// Lichess-analysis-style notation panel (2026-09-02 rewrite — owner ask
// "all" for parity with the /openings + Dream Meet board panel). Mainline
// flows as inline text with move numbers, variations render as INDENTED
// BLOCKS with a left border and progressively deeper indent. Every move is
// right-clickable → context menu (promote / make main / NAG / comment /
// copy PGN / delete). ⭐ (revise point) + 💬 (comment) icons preserved so
// the study-specific affordances survive.
function MoveTree({
  moves, currentId, onJump, onContext,
}: {
  moves: MoveNode[];
  currentId: string | null;
  onJump: (id: string) => void;
  onContext: (id: string, x: number, y: number) => void;
}) {
  if (moves.length === 0) return <div className="text-xs text-ink-500">No moves yet — play one on the board or type SAN.</div>;
  // Root call — pick the mainline root child, all others render as sibling
  // variations under it. Everything below uses the "emit this node then
  // descend into its mainline child" pattern.
  const rootKids = childrenOf(moves, null);
  const rootMain = rootKids.find((k) => k.isMainLine) ?? rootKids[0];
  return (
    <div className="font-mono text-sm leading-relaxed break-words">
      <MoveTreeLine moves={moves} firstNodeId={rootMain?.id ?? null}
        siblingsOfFirst={rootKids.filter((k) => k.id !== rootMain?.id)}
        currentId={currentId} onJump={onJump} onContext={onContext}
        depth={0} openedWithVariationBlock={false} />
    </div>
  );
}

/** Emits `firstNodeId` as the first move, then walks its mainline chain of
 *  descendants. At each ply, sibling variations render as indented blocks
 *  that recurse. `siblingsOfFirst` covers sibling variations of the first
 *  node itself (used for root-level branches — Kh5 mainline with Kf5 as a
 *  sibling variation both hang off parentId=null). */
function MoveTreeLine({
  moves, firstNodeId, siblingsOfFirst, currentId, onJump, onContext, depth, openedWithVariationBlock,
}: {
  moves: MoveNode[];
  firstNodeId: string | null;
  siblingsOfFirst?: MoveNode[];
  currentId: string | null;
  onJump: (id: string) => void;
  onContext: (id: string, x: number, y: number) => void;
  depth: number;
  openedWithVariationBlock: boolean;
}) {
  if (!firstNodeId) return null;
  const parts: React.ReactNode[] = [];
  let curId: string | null = firstNodeId;
  let extraSiblings: MoveNode[] | undefined = siblingsOfFirst;   // only fires on first iteration
  let forceBlackPrefix = openedWithVariationBlock;
  const emitMove = (m: MoveNode) => {
    const isWhite = m.ply % 2 === 1;
    const moveNum = Math.ceil(m.ply / 2);
    const needsNo = isWhite || forceBlackPrefix;
    const active = currentId === m.id;
    parts.push(
      <span key={`m${m.id}`} className="inline-flex items-baseline">
        {needsNo && <span className="mr-0.5 text-ink-500">{moveNum}{isWhite ? "." : "…"}</span>}
        <button
          onClick={() => onJump(m.id)}
          onContextMenu={(e) => { e.preventDefault(); onContext(m.id, e.clientX, e.clientY); }}
          className={`rounded px-1.5 py-0.5 transition ${active
            ? "bg-brand-500/60 text-white"
            : depth === 0 ? "text-ink-100 hover:bg-ink-800" : "text-ink-300 hover:bg-ink-800"}`}>
          {m.san}
          {m.nag ? <span className={"ml-0.5 " + (NAG_COLOR[m.nag] ?? "text-amber-300")}>{NAG_TEXT[m.nag]}</span> : null}
          {m.isRevisePoint && <span className="ml-0.5 text-amber-300">⭐</span>}
          {m.comment && <span className="ml-0.5 text-blue-300" title={m.comment}>💬</span>}
        </button>{" "}
      </span>
    );
    forceBlackPrefix = false;
  };
  const emitSiblings = (siblings: MoveNode[]) => {
    for (const s of siblings) {
      const sSiblings = childrenOf(moves, s.parentId).filter((k) => k.id !== s.id && k.id !== firstNodeId);
      // (sSiblings will be empty for a normal sibling — kept for symmetry)
      void sSiblings;
      parts.push(
        <div key={`v${s.id}`}
          className="my-1 border-l-2 border-ink-700 pl-2 text-[13px]"
          style={{ marginLeft: `${Math.min(depth + 1, 3) * 8}px` }}>
          <MoveTreeLine moves={moves} firstNodeId={s.id}
            currentId={currentId} onJump={onJump} onContext={onContext}
            depth={depth + 1} openedWithVariationBlock={false} />
        </div>
      );
      forceBlackPrefix = true;
    }
  };
  while (curId) {
    const node = moves.find((m) => m.id === curId);
    if (!node) break;
    emitMove(node);
    // On the FIRST iteration, siblings-of-first from the caller take
    // precedence (they're the root branches when curId is a root move).
    if (extraSiblings && extraSiblings.length) { emitSiblings(extraSiblings); extraSiblings = undefined; }
    // Then descend: mainline continuation is the isMainLine child; other
    // children of this node become sibling variations at this depth.
    const kids = childrenOf(moves, node.id);
    const nextMain = kids.find((k) => k.isMainLine) ?? kids[0];
    const nextSiblings = kids.filter((k) => k.id !== nextMain?.id);
    if (nextSiblings.length) emitSiblings(nextSiblings);
    curId = nextMain?.id ?? null;
  }
  return (
    <span className={depth === 0 ? undefined : "font-mono leading-relaxed"}>
      {parts}
    </span>
  );
}
