import { useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import type { Key } from "chessground/types";
import { destsFromChess } from "../components/Board";

/** One SAN move in the recorded tree. `children[0]` is the mainline
 *  continuation from THIS node; additional children are branch variations.
 *  nag = short PGN glyph appended to the SAN (!, ?, ±, +=, …).
 *  comment = free-form text under the move.
 *  Both optional; preserved through promote/mainline/delete/loadTree. */
export interface MoveNode {
  san: string;
  nag?: string;
  comment?: string;
  children: MoveNode[];
}

// LocalStorage key for the free-play move tree + cursor. Namespaced per key so
// different callers (default explorer, board editor, …) can keep separate
// state — omit the arg for the shared default. Empty tree = don't persist
// (avoids a stale empty write clobbering a real session on quick remounts).
const STORAGE_KEY = "cg_freeplay_v1";
function loadPersisted(): { tree: MoveNode[]; path: number[]; startFen?: string } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (!Array.isArray(j?.tree) || !Array.isArray(j?.path)) return null;
    return { tree: j.tree, path: j.path, startFen: typeof j.startFen === "string" ? j.startFen : undefined };
  } catch { return null; }
}
function savePersisted(tree: MoveNode[], path: number[], startFen: string) {
  try {
    if (tree.length === 0 && path.length === 0 && !startFen) { localStorage.removeItem(STORAGE_KEY); return; }
    const body: any = { tree, path };
    if (startFen) body.startFen = startFen;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(body));
  } catch { /* quota / disabled — silent */ }
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
  // Rehydrate persisted tree/path on first mount — only when there's no
  // caller-supplied initialFen (that's how the BoardEditor seeds a specific
  // position and it must WIN over stale saved play). Owner report 2026-08-19:
  // "when i refresh, all the moves vanishes". Now they don't.
  const persisted = useMemo(() => (initialFen ? null : loadPersisted()), [initialFen]);
  // Seed chess.js from initialFen > persisted.startFen > standard. So a
  // reload after Setup Position lands on the same custom board, not the
  // standard start (paired with startFen state below).
  const seededStart = initialFen ?? persisted?.startFen ?? "";
  const game = useRef(seededStart ? new Chess(seededStart) : new Chess());
  const [fen, setFen] = useState(() => {
    if (!persisted) return game.current.fen();
    // Replay the persisted path so fen matches the saved cursor position.
    for (let i = 0; i < persisted.path.length; i++) {
      const idx = persisted.path[i]!;
      let cur = persisted.tree;
      for (let j = 0; j < i; j++) cur = cur[persisted.path[j]!]!.children;
      const node = cur[idx];
      if (!node) break;
      try { if (!game.current.move(node.san)) break; } catch { break; }
    }
    return game.current.fen();
  });
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [tree, setTree] = useState<MoveNode[]>(persisted?.tree ?? []);
  const [path, setPath] = useState<number[]>(persisted?.path ?? []);
  // Custom starting FEN (Setup Position). Empty = standard start. onMove +
  // applySans use this as their base so a mid-game position stays intact
  // across navigation (owner bug 2026-09-02 "after position setup, i can't
  // play the 2nd move and can't navigate moves front and back"). Was previously
  // hard-coded to `new Chess()` — which reset the board to the standard start
  // on every replay.
  // Hydrate from persisted.startFen too — otherwise the first persist-effect
  // fires with "" and overwrites the stored setup FEN, losing it on refresh
  // (owner bug 2026-09-02 "when i refresh, set up position is getting lost").
  const [startFen, setStartFen] = useState<string>(initialFen ?? persisted?.startFen ?? "");
  const startFenRef = useRef<string>(startFen);
  useEffect(() => { startFenRef.current = startFen; }, [startFen]);
  const freshChess = () => (startFenRef.current ? new Chess(startFenRef.current) : new Chess());
  // Persist on every tree/path/startFen change (fire-and-forget, quota-safe).
  useEffect(() => { savePersisted(tree, path, startFen); }, [tree, path, startFen]);

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

  // Replay a SAN move list from the current startFen and sync fen + chess ref.
  // Uses startFenRef (not startFen state) so callers inside setTree/setPath
  // updates see the latest value without stale-closure surprises.
  const applySans = (sans: string[]) => {
    if (startFenRef.current) { try { game.current.load(startFenRef.current); } catch { game.current.reset(); } }
    else game.current.reset();
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
    // freshChess honours a custom startFen (Setup Position) so replaying to
    // the cursor stays on the SAME position — previously hard-coded to
    // standard start, which stripped the setup after the first move.
    const rewind = freshChess();
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
      next[idx] = { san: child.san, nag: child.nag, comment: child.comment, children: cloneAppend(child.children, depth + 1) };
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
    goTo([...path, 0]);                                    // first-child = mainline of current line
  };
  // Cycle between sibling branches at the CURRENT ply — Lichess ↑/↓ keys.
  // If cursor is at [0,0,1] (branch), goSibling(+1) tries [0,0,2] etc; wraps.
  const goSibling = (dir: 1 | -1) => {
    if (path.length === 0) return;
    const parent = path.slice(0, -1);
    const { children } = childrenAtCursor(tree, parent);
    if (children.length < 2) return;
    const curIdx = path[path.length - 1]!;
    const nextIdx = (curIdx + dir + children.length) % children.length;
    goTo([...parent, nextIdx]);
  };
  // Legacy undo — was "step back one move" (still is; doesn't discard).
  const undo = () => goPrev();
  const reset = () => {
    game.current.reset();
    setFen(game.current.fen());
    setTree([]);
    setPath([]);
    setStartFen("");
    startFenRef.current = "";
  };
  const load = (f: string): boolean => {
    try {
      game.current.load(f);
      setFen(game.current.fen());
      setTree([]);
      setPath([]);
      const loaded = game.current.fen();
      setStartFen(loaded);
      startFenRef.current = loaded;
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
      const loaded = game.current.fen();
      setStartFen(loaded);
      startFenRef.current = loaded;
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
  // Replay a FULL MoveNode tree from the start position — preserves every
  // sideline that was recorded, unlike loadSans which flattens to a single
  // mainline. Used by the Repertoire loader when a saved entry ships its
  // whole tree (added 2026-08-19: owner report "save also side lines while
  // saving, now only main lines are saved even when sidelines are there").
  // Cursor lands on the mainline leaf so ArrowUp/Down can switch into
  // sibling variations from any node.
  const loadTree = (newTree: MoveNode[], newStartFen?: string): boolean => {
    if (!Array.isArray(newTree) || newTree.length === 0) return false;
    // Apply the entry's saved startFen FIRST so applySans replays SAN
    // moves from the right base. Loader passes entry.startFen when the
    // saved line was captured from a Setup Position; standard-start
    // entries call without it and startFen resets to "".
    if (typeof newStartFen === "string" && newStartFen) {
      try { game.current.load(newStartFen); setStartFen(newStartFen); startFenRef.current = newStartFen; }
      catch { setStartFen(""); startFenRef.current = ""; }
    } else {
      setStartFen(""); startFenRef.current = "";
    }
    // Walk children[0] to the mainline leaf and record the cursor path.
    const newPath: number[] = [];
    let cur: MoveNode | undefined = newTree[0];
    if (cur) {
      newPath.push(0);
      while (cur.children.length > 0) {
        newPath.push(0);
        cur = cur.children[0];
        if (!cur) break;
      }
    }
    const mainlineSans = walk(newTree, newPath).sans;
    setTree(newTree);
    setPath(newPath);
    applySans(mainlineSans);
    return true;
  };
  // Convenience: does the cursor have somewhere to go forward?
  const hasNext = childrenAtCursor(tree, path).children.length > 0;

  // Structural clone of `tree` down to `p` — every ancestor is a fresh
  // object so React sees a new reference and re-renders. Returns both the
  // new tree and a handle to the parent-children array that owns `p[last]`.
  const cloneToParent = (t: MoveNode[], p: number[]): { tree: MoveNode[]; parentChildren: MoveNode[] | null } => {
    if (p.length === 0) return { tree: t, parentChildren: null };
    const nextTop = [...t];
    let parentArr = nextTop;
    for (let i = 0; i < p.length - 1; i++) {
      const idx = p[i]!;
      const child = parentArr[idx]!;
      // Preserve nag/comment on cloned ancestors so promote/mainline/delete
      // don't strip annotations from any node on the walk path.
      const newChild: MoveNode = { san: child.san, nag: child.nag, comment: child.comment, children: [...child.children] };
      parentArr[idx] = newChild;
      parentArr = newChild.children;
    }
    return { tree: nextTop, parentChildren: parentArr };
  };

  // Move the child at `p` up one position among its siblings (swap with the
  // sibling to its left). Lichess "Promote variation" — one step toward
  // mainline for THIS branch point. Only meaningful when `p.length > 0` and
  // the last index > 0. Cursor follows the moved node.
  const promoteVariation = (p: number[]) => {
    if (p.length === 0) return;
    const k = p[p.length - 1]!;
    if (k <= 0) return;
    const { tree: nextTree, parentChildren } = cloneToParent(tree, p);
    if (!parentChildren) return;
    [parentChildren[k - 1], parentChildren[k]] = [parentChildren[k]!, parentChildren[k - 1]!];
    setTree(nextTree);
    // Cursor: keep pointing to the SAME node, which is now at k-1. Later
    // indices in path (if any) stay the same because they index into the
    // moved node's own children array (unchanged).
    const nextPath = [...p.slice(0, -1), k - 1, ...path.slice(p.length)];
    setPath(nextPath);
  };

  // Fully mainline the branch: for every ancestor along `p` whose index is
  // > 0, swap it into position 0 at that ancestor. Cursor follows.
  const makeMainLine = (p: number[]) => {
    if (p.length === 0) return;
    // Fresh clone of the top-level array; we'll walk & rebuild each ancestor
    // that needs its children[0] swapped with children[k].
    const nextTop = [...tree];
    let arr = nextTop;
    const nextPath: number[] = [];
    for (let i = 0; i < p.length; i++) {
      const k = p[i]!;
      if (k > 0) {
        [arr[0], arr[k]] = [arr[k]!, arr[0]!];
      }
      nextPath.push(0);
      // Descend into the (now-mainline) node's children with a structural copy.
      const child = arr[0]!;
      if (i < p.length - 1) {
        const newChild: MoveNode = { san: child.san, nag: child.nag, comment: child.comment, children: [...child.children] };
        arr[0] = newChild;
        arr = newChild.children;
      }
    }
    setTree(nextTop);
    // Extend cursor with any suffix beyond p (if the user's cursor was
    // deeper inside the moved subtree, keep pointing at the same node —
    // suffix indices are relative to the moved node's own children which
    // aren't shuffled).
    setPath([...nextPath, ...path.slice(p.length)]);
  };

  // Set / clear the NAG glyph or the text comment on the node at `p`.
  // Passing `null` clears the field; a string sets it. Both are optional,
  // preserved through all other tree mutations. Owner ask 2026-09-02:
  // port from Dream Meet's class notation panel.
  const setNodeAnnotation = (p: number[], patch: { nag?: string | null; comment?: string | null }) => {
    if (p.length === 0) return;
    // Structural clone along p, mutating the leaf.
    const cloneAndPatch = (nodes: MoveNode[], depth: number): MoveNode[] => {
      const idx = p[depth]!;
      const next = [...nodes];
      const child = next[idx]!;
      if (depth === p.length - 1) {
        const patched: MoveNode = { san: child.san, children: child.children };
        // Preserve existing fields; then apply patch.
        if (child.nag !== undefined) patched.nag = child.nag;
        if (child.comment !== undefined) patched.comment = child.comment;
        if (patch.nag === null || patch.nag === "") delete patched.nag;
        else if (typeof patch.nag === "string") patched.nag = patch.nag.slice(0, 4);
        if (patch.comment === null || patch.comment === "") delete patched.comment;
        else if (typeof patch.comment === "string") patched.comment = patch.comment.slice(0, 500);
        next[idx] = patched;
      } else {
        next[idx] = { san: child.san, nag: child.nag, comment: child.comment, children: cloneAndPatch(child.children, depth + 1) };
      }
      return next;
    };
    setTree(cloneAndPatch(tree, 0));
  };

  // Remove the node at `p` and everything below it. Cursor jumps to the
  // parent (or to root if we removed a top-level entry). No-op for empty p.
  const deleteFrom = (p: number[]) => {
    if (p.length === 0) return;
    const { tree: nextTree, parentChildren } = cloneToParent(tree, p);
    if (!parentChildren) return;
    parentChildren.splice(p[p.length - 1]!, 1);
    // Prune any ancestors that became empty from the delete (rare — happens
    // if you delete the only child of the only child …). Simpler: leave them,
    // since an empty children[] is harmless.
    setTree(nextTree);
    // Cursor moves to the parent of the deleted node.
    const parentPath = p.slice(0, -1);
    setPath(parentPath);
    applySans(walk(nextTree, parentPath).sans);
  };

  return {
    game, fen, orientation, turnColor,
    tree, path, history, line, ply, hasNext,
    dests, onMove, undo, goPrev, goNext, goTo, goSibling, reset, load, loadPermissive, loadSans, loadTree, flip,
    promoteVariation, makeMainLine, deleteFrom, setNodeAnnotation,
  };
}
