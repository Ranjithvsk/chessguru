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

import { useEffect, useMemo, useRef, useState } from "react";
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
    setCurrentId(tail.length ? tail[tail.length - 1].id : null);
    seededRef.current = true;
  }, [q.data]);

  const currentPath = useMemo(() => pathTo(moves, currentId), [moves, currentId]);
  const board = useMemo(() => replayTo(startingFen, currentPath), [startingFen, currentPath]);
  const dests = useMemo(() => destsFor(board), [board]);
  const fen = board.fen();
  const turnColor: "white" | "black" = board.turn() === "w" ? "white" : "black";
  const isCheck = board.inCheck();
  const lastMove: [Key, Key] | undefined = currentPath.length
    ? [currentPath[currentPath.length - 1].uci.slice(0, 2) as Key, currentPath[currentPath.length - 1].uci.slice(2, 4) as Key]
    : undefined;

  const shapes: DrawShape[] = useMemo(() => {
    if (!currentPath.length) return [];
    const s = currentPath[currentPath.length - 1].shapes || [];
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
    const last = currentPath[currentPath.length - 1];
    setMoves((prev) => prev.map((m) => m.id === last.id ? { ...m, shapes: s } : m));
    setDirty(true);
  };

  const goBack = () => {
    if (!currentPath.length) return;
    const parent = currentPath.length >= 2 ? currentPath[currentPath.length - 2].id : null;
    setCurrentId(parent);
  };
  const goForward = () => {
    const kids = childrenOf(moves, currentId);
    if (!kids.length) return;
    const main = kids.find((k) => k.isMainLine) ?? kids[0];
    setCurrentId(main.id);
  };
  const goStart = () => setCurrentId(null);
  const goEnd = () => {
    const tail = followMainLine(moves, currentId);
    if (tail.length) setCurrentId(tail[tail.length - 1].id);
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
    const parent = currentPath.length >= 2 ? currentPath[currentPath.length - 2].id : null;
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
        {/* Board column */}
        <div>
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
          <MoveTree moves={moves} currentId={currentId} onJump={setCurrentId} />

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
    </div>
  );
}

/** Move-list rendering: main line inline, variations indented under their parent. */
function MoveTree({ moves, currentId, onJump }: { moves: MoveNode[]; currentId: string | null; onJump: (id: string) => void }) {
  if (moves.length === 0) return <div className="text-xs text-ink-500">No moves yet — play one on the board or type SAN.</div>;

  // Render the main line as pairs: "1. e4 e5 2. Nf3 Nc6 …" and inline variations after their parent.
  const nodes: React.ReactNode[] = [];
  const renderLine = (fromId: string | null, depth: number) => {
    const kids = childrenOf(moves, fromId);
    if (!kids.length) return;
    const main = kids.find((k) => k.isMainLine) ?? kids[0];
    const branches = kids.filter((k) => k.id !== main.id);

    // Move number: only white plays print "1." — black continues on same line.
    const num = Math.ceil(main.ply / 2);
    const isWhite = main.ply % 2 === 1;

    nodes.push(
      <span key={main.id + "-w"} className={`inline-block ${depth > 0 ? "text-xs" : ""}`}>
        {isWhite && <span className="mr-1 text-ink-500">{num}.</span>}
        <button onClick={() => onJump(main.id)}
          className={`rounded px-1 font-mono ${currentId === main.id ? "bg-brand-600 text-white" : "text-ink-100 hover:bg-ink-800"}`}>
          {main.san}
          {main.isRevisePoint && <span className="ml-0.5 text-amber-300">⭐</span>}
          {main.comment && <span className="ml-0.5 text-blue-300" title={main.comment}>💬</span>}
        </button>{" "}
      </span>
    );

    // Render branches (variations) as parenthetical inline lists on new lines.
    for (const b of branches) {
      nodes.push(
        <div key={b.id + "-var-wrap"} className={`ml-${Math.min(depth + 1, 4) * 4} my-1 border-l border-ink-700 pl-2 text-xs text-ink-400`}>
          <span className="text-ink-500">({Math.ceil(b.ply / 2)}{b.ply % 2 === 1 ? "." : "..."}</span>{" "}
          <button onClick={() => onJump(b.id)}
            className={`rounded px-1 font-mono ${currentId === b.id ? "bg-brand-600 text-white" : "hover:bg-ink-800"}`}>
            {b.san}
          </button>{" "}
          <VariationTail moves={moves} fromId={b.id} currentId={currentId} onJump={onJump} depth={depth + 1} />
          <span className="text-ink-500">)</span>
        </div>
      );
    }

    // Continue the main line.
    renderLine(main.id, depth);
  };
  renderLine(null, 0);
  return <div className="text-sm leading-7 break-words">{nodes}</div>;
}

/** Inline tail of a variation — just the moves, no comment column. */
function VariationTail({ moves, fromId, currentId, onJump, depth }: {
  moves: MoveNode[]; fromId: string; currentId: string | null; onJump: (id: string) => void; depth: number;
}) {
  const kids = childrenOf(moves, fromId);
  if (!kids.length) return null;
  const main = kids.find((k) => k.isMainLine) ?? kids[0];
  const num = Math.ceil(main.ply / 2);
  const isWhite = main.ply % 2 === 1;
  return (
    <>
      {isWhite && <span className="text-ink-500">{num}.</span>}{" "}
      <button onClick={() => onJump(main.id)}
        className={`rounded px-1 font-mono ${currentId === main.id ? "bg-brand-600 text-white" : "hover:bg-ink-800"}`}>
        {main.san}
      </button>{" "}
      <VariationTail moves={moves} fromId={main.id} currentId={currentId} onJump={onJump} depth={depth} />
    </>
  );
}
