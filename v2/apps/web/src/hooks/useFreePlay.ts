import { useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import type { Key } from "chessground/types";
import { destsFromChess } from "../components/Board";

/** One SAN move in the recorded tree. `children[0]` is the mainline
 *  continuation from THIS node; additional children are branch variations. */
export interface MoveNode {
  san: string;
  children: MoveNode[];
}

/** Free-play board state (both sides movable) with Lichess-analysis semantics:
 *  * a MoveNode TREE (not a flat list) so playing a new move while rewound
 *    creates a variation branch instead of truncating the future
 *  * a cursor `path` = array of child indices from root, e.g. [0,0,1] means
 *    "mainline → mainline → 2nd sibling" (the branch)
 *  * derived `history` / `line` compat fields so downstream consumers
 *    (opening-name matcher, Memorize handoff, BoardEditor) don't need changes.
 *  Shared by Opening Explorer & Board Editor. */
export function useFreePlay(initialFen?: string) {
  const game = useRef(initialFen ? new Chess(initialFen) : new Chess());
  const [fen, setFen] = useState(game.current.fen());
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [tree, setTree] = useState<MoveNode[]>([]);        // root's children
  const [path, setPath] = useState<number[]>([]);          // cursor

  // Walk the tree along `path`, collecting the SAN moves currently applied
  // to the board. Also returns the node objects for downstream rendering.
  const walk = (root: MoveNode[], p: number[]) => {
    const sans: string[] = [];
    const nodes: MoveNode[] = [];
    let cur = root;
    for (const idx of p) {
      const n = cur[idx];
      if (!n) break;
      sans.push(n.san);
      nodes.push(n);
      cur = n.children;
    }
    return { sans, nodes };
  };
  const history = useMemo(() => walk(tree, path).sans, [tree, path]);
  const ply = path.length;

  // The FULL mainline (first-child at every step) from root — used for the
  // ⏭ "jump to end" button and any legacy consumer that still reads `line`
  // as a flat move list.
  const line = useMemo(() => {
    const out: string[] = [];
    let cur = tree;
    while (cur.length > 0) { out.push(cur[0]!.san); cur = cur[0]!.children; }
    return out;
  }, [tree]);

  const dests = useMemo(() => destsFromChess(game.current as any), [fen]);
  const turnColor: "white" | "black" = game.current.turn() === "w" ? "white" : "black";

  // Replay a SAN move list from scratch and sync the fen + chess ref.
  const applySans = (sans: string[]) => {
    game.current.reset();
    for (const s of sans) { try { if (!game.current.move(s)) break; } catch { break; } }
    setFen(game.current.fen());
  };

  // Pull the children list at the cursor's position — helper for onMove /
  // hasNext / goNext.
  const childrenAtCursor = (t: MoveNode[], p: number[]): { parentRef: MoveNode[]; children: MoveNode[] } => {
    let parent = t;
    let cur = t;
    for (const idx of p) {
      const n = cur[idx];
      if (!n) return { parentRef: parent, children: [] };
      parent = n.children;
      cur = n.children;
    }
    return { parentRef: parent, children: cur };
  };

  const onMove = (from: Key, to: Key) => {
    // Play the move on a fresh clone at the cursor position to compute SAN.
    const rewind = new Chess();
    for (const s of history) rewind.move(s);
    let san: string;
    try {
      const mv = rewind.move({ from, to, promotion: "q" });
      if (!mv) return;
      san = mv.san;
    } catch { return; }

    // If a child at this node already has this SAN, just descend into it —
    // no duplicate branch.
    const { children } = childrenAtCursor(tree, path);
    const existingIdx = children.findIndex((c) => c.san === san);
    if (existingIdx !== -1) {
      const nextPath = [...path, existingIdx];
      setPath(nextPath);
      applySans([...history, san]);
      return;
    }
    // Otherwise APPEND a new child to the cursor node (branch or extension —
    // same code path). Structural clone along the path so React sees a new
    // tree reference at every ancestor.
    const cloneAppend = (nodes: MoveNode[], depth: number): MoveNode[] => {
      if (depth === path.length) {
        return [...nodes, { san, children: [] }];
      }
      const idx = path[depth]!;
      const next = [...nodes];
      const child = next[idx]!;
      next[idx] = { san: child.san, children: cloneAppend(child.children, depth + 1) };
      return next;
    };
    const nextTree = cloneAppend(tree, 0);
    const newChildIdx = childrenAtCursor(nextTree, path).children.length - 1;
    const nextPath = [...path, newChildIdx];
    setTree(nextTree);
    setPath(nextPath);
    applySans([...history, san]);
  };

  const goTo = (nextPath: number[]) => {
    // Validate the path by walking the tree — if any step is missing, stop
    // where we lose track so goTo can't strand the cursor on a phantom node.
    const clean: number[] = [];
    let cur = tree;
    for (const idx of nextPath) {
      const n = cur[idx];
      if (!n) break;
      clean.push(idx);
      cur = n.children;
    }
    setPath(clean);
    applySans(walk(tree, clean).sans);
  };
  const goPrev = () => goTo(path.slice(0, -1));
  const goNext = () => {
    const { children } = childrenAtCursor(tree, path);
    if (!children.length) return;
    goTo([...path, 0]);                                    // first-child = mainline
  };
  // Legacy undo — was "step back one move" (still is; doesn't discard).
  const undo = () => goPrev();
  const reset = () => {
    game.current.reset();
    setFen(game.current.fen());
    setTree([]);
    setPath([]);
  };
  const load = (f: string): boolean => {
    try {
      game.current.load(f);
      setFen(game.current.fen());
      setTree([]);
      setPath([]);
      return true;
    } catch { return false; }
  };
  const loadPermissive = (f: string): boolean => {
    if (load(f)) return true;
    const boardPart = (f || "").split(" ")[0] || "";
    if (!/^[rnbqkpRNBQKP1-8/]+$/.test(boardPart)) return false;
    if (load(`${boardPart} w - - 0 1`)) return true;
    try {
      game.current.clear();
      const ranks = boardPart.split("/");
      for (let r = 0; r < Math.min(8, ranks.length); r++) {
        let file = 0;
        for (const ch of ranks[r]!) {
          if (ch >= "1" && ch <= "8") { file += ch.charCodeAt(0) - 48; continue; }
          const color = ch === ch.toUpperCase() ? "w" : "b";
          const type = ch.toLowerCase() as "p" | "n" | "b" | "r" | "q" | "k";
          const square = String.fromCharCode(97 + file) + String(8 - r);
          try { game.current.put({ type, color }, square as any); } catch { /* skip bad square */ }
          file++;
        }
      }
      setFen(game.current.fen());
      setTree([]);
      setPath([]);
      return true;
    } catch { return false; }
  };
  const flip = () => setOrientation((o) => (o === "white" ? "black" : "white"));
  // Replay a SAN move list from the start position — replaces the whole
  // recorded tree with a single mainline. Used when the Openings finder
  // picks a variation.
  const loadSans = (sans: string[]): boolean => {
    // Build a linear tree from the sans list.
    let root: MoveNode[] = [];
    if (sans.length) {
      let cur: MoveNode | null = null;
      for (const s of sans) {
        const node: MoveNode = { san: s, children: [] };
        if (!cur) root = [node];
        else cur.children = [node];
        cur = node;
      }
    }
    const newPath = sans.map((_, i) => (i === 0 ? 0 : 0));
    setTree(root);
    setPath(newPath);
    applySans(sans);
    return true;
  };
  // Convenience: does the cursor have somewhere to go forward?
  const hasNext = childrenAtCursor(tree, path).children.length > 0;

  return {
    game, fen, orientation, turnColor,
    tree, path, history, line, ply, hasNext,
    dests, onMove, undo, goPrev, goNext, goTo, reset, load, loadPermissive, loadSans, flip,
  };
}
