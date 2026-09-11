// A LOOPBACK class-ws socket — the Dream Meet board with no network.
//
// SharedClassBoard is a thin view over the class-ws server: every user intent
// leaves through one `ws.send(JSON.stringify(frame))`, and every state change
// arrives through one `ws.onmessage`. That single seam is what this file
// exploits. Instead of forking the 1,895-line board (and the 560-line notation
// panel that reads its module hooks) to get an offline copy, we hand the board
// an object that LOOKS like a WebSocket and answers it locally.
//
// The result is 1:1 by construction rather than by careful copying: the same
// component, the same frames, the same reducer. The reducer below is a faithful
// port of apps/api/src/class/class-ws.ts — nodesAt / pathMoves / fenAtPath /
// recomputeFromTree / extendMainlineOnce / shapesAtCursor / setShapesAtCursor /
// syncShapesToPosition and every board-state frame handler. Keep the two in
// step: if class-ws's tree semantics change, change them here too.
//
// Deliberately NOT ported (they only mean something with other people in the
// room): hello/attendance, coach-vs-student roles, pointer broadcast, the
// challenge quiz flow, coach notices, room lifecycle. A local room has exactly
// one occupant and they are always the coach, so every coach-gated op is open.
import { Chess } from "chess.js";

export type LocalMove = { from: string; to: string; promotion?: string };
export type LocalShape = { orig: string; dest?: string; brush?: string };
export type LocalTreeNode = {
  move: LocalMove; nag?: string; comment?: string; shapes?: LocalShape[]; children: LocalTreeNode[];
  /** Passthrough fields the class board itself never reads. They exist so a
   *  saved study chapter survives a full round trip through this reducer:
   *  `id` keeps a node's identity stable across saves (the spaced-repetition
   *  queue references it) and `revise` is the ⭐ flag. Preserved by
   *  sanitizeTree; ignored everywhere else. */
  id?: string;
  revise?: boolean;
};
export type Orientation = "white" | "black";

export type LocalRoomState = {
  startFen: string;
  fen: string;
  lastMove: LocalMove | null;
  history: LocalMove[];
  cursorIdx: number;
  tree: LocalTreeNode[];
  cursorPath: number[];
  shapes: LocalShape[];
  startShapes: LocalShape[];
  locked: boolean;
  orientation: Orientation;
};

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export function emptyRoomState(startFen?: string): LocalRoomState {
  let fen = START_FEN;
  if (startFen) { try { fen = new Chess(startFen).fen(); } catch { fen = START_FEN; } }
  return {
    startFen: fen, fen, lastMove: null, history: [], cursorIdx: 0,
    tree: [], cursorPath: [], shapes: [], startShapes: [],
    locked: false, orientation: "white",
  };
}

/* ── pure tree helpers — ported verbatim from class-ws.ts ─────────────── */

function nodesAt(tree: LocalTreeNode[], path: number[]): LocalTreeNode[] {
  const out: LocalTreeNode[] = [];
  let cur = tree;
  for (const idx of path) {
    const n = cur[idx];
    if (!n) break;
    out.push(n);
    cur = n.children;
  }
  return out;
}

function pathMoves(tree: LocalTreeNode[], path: number[]): LocalMove[] {
  return nodesAt(tree, path).map((n) => n.move);
}

/** Fen after applying every move along cursorPath. Falls back to a fresh game
 *  if startFen is corrupt so a bad tree can't wedge the board. */
function fenAtPath(startFen: string, tree: LocalTreeNode[], path: number[]): { fen: string; last: LocalMove | null } {
  let c: Chess;
  try { c = new Chess(startFen); } catch { c = new Chess(); }
  let last: LocalMove | null = null;
  for (const n of nodesAt(tree, path)) {
    try {
      c.move({ from: n.move.from, to: n.move.to, promotion: (n.move.promotion as any) || "q" });
      last = n.move;
    } catch { break; }
  }
  return { fen: c.fen(), last };
}

function recomputeFromTree(room: LocalRoomState): void {
  const r = fenAtPath(room.startFen, room.tree, room.cursorPath);
  room.fen = r.fen;
  room.lastMove = r.last;
  const moves = pathMoves(room.tree, room.cursorPath);
  room.history = moves;
  room.cursorIdx = moves.length;
}

function extendMainlineOnce(tree: LocalTreeNode[], path: number[]): number[] | null {
  const nodes = nodesAt(tree, path);
  const parentChildren = nodes.length === 0 ? tree : nodes[nodes.length - 1]!.children;
  if (parentChildren.length === 0) return null;
  return [...path, 0];
}

/** Shapes for the position at cursorPath — startShapes at root, else the
 *  node's own. Arrows are saved PER POSITION so navigating back to a taught
 *  position brings its markup back (owner directive 2026-09-02). */
function shapesAtCursor(room: LocalRoomState): LocalShape[] {
  if (room.cursorPath.length === 0) return room.startShapes;
  let cur = room.tree;
  let target: LocalTreeNode | null = null;
  for (const idx of room.cursorPath) {
    const n = cur[idx];
    if (!n) return [];
    target = n;
    cur = n.children;
  }
  return target?.shapes ?? [];
}

function setShapesAtCursor(room: LocalRoomState, shapes: LocalShape[]): void {
  if (room.cursorPath.length === 0) { room.startShapes = shapes; return; }
  let cur = room.tree;
  let target: LocalTreeNode | null = null;
  for (const idx of room.cursorPath) {
    const n = cur[idx];
    if (!n) return;
    target = n;
    cur = n.children;
  }
  if (!target) return;
  if (shapes.length === 0) delete target.shapes;
  else target.shapes = shapes;
}

function sanitizeShapes(raw: any): LocalShape[] {
  const list = Array.isArray(raw) ? raw : [];
  const cleaned: LocalShape[] = [];
  for (const s of list) {
    if (cleaned.length >= 64) break;
    if (!s || typeof s.orig !== "string") continue;
    if (!/^[a-h][1-8]$/.test(s.orig)) continue;
    if (s.dest != null && !/^[a-h][1-8]$/.test(String(s.dest))) continue;
    cleaned.push({ orig: s.orig, dest: s.dest, brush: typeof s.brush === "string" ? s.brush : undefined });
  }
  return cleaned;
}

/** Sanitize + budget-cap an incoming tree (600 nodes) exactly as load-tree does
 *  server-side, preserving nag / comment / per-node shapes. */
export function sanitizeTree(rawTree: any): LocalTreeNode[] {
  let budget = 600;
  const clone = (nodes: any[]): LocalTreeNode[] => {
    const out: LocalTreeNode[] = [];
    for (const n of nodes) {
      if (budget <= 0) break;
      if (!n || typeof n !== "object") continue;
      const mv = n.move;
      if (!mv || typeof mv.from !== "string" || typeof mv.to !== "string") continue;
      if (!/^[a-h][1-8]$/.test(mv.from) || !/^[a-h][1-8]$/.test(mv.to)) continue;
      const promo = mv.promotion;
      const move: LocalMove = {
        from: mv.from, to: mv.to,
        promotion: (typeof promo === "string" && /^[qrbn]$/i.test(promo)) ? promo.toLowerCase() : undefined,
      };
      budget--;
      const kids = Array.isArray(n.children) ? clone(n.children) : [];
      const node: LocalTreeNode = { move, children: kids };
      if (typeof n.nag === "string" && n.nag) node.nag = n.nag.slice(0, 4);
      if (typeof n.comment === "string" && n.comment) node.comment = n.comment.slice(0, 500);
      const sh = sanitizeShapes(n.shapes);
      if (sh.length > 0) node.shapes = sh;
      if (typeof n.id === "string" && n.id) node.id = n.id.slice(0, 32);
      if (n.revise === true) node.revise = true;
      out.push(node);
    }
    return out;
  };
  return clone(Array.isArray(rawTree) ? rawTree : []);
}

/* ── the loopback socket ──────────────────────────────────────────────── */

/** The subset of the WebSocket interface SharedClassBoard actually touches:
 *  send / readyState / close / onopen / onmessage / onerror / onclose. */
export type LocalClassSocket = {
  readyState: number;
  onopen: ((ev?: any) => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onerror: ((ev?: any) => void) | null;
  onclose: ((ev?: any) => void) | null;
  send: (data: string) => void;
  close: () => void;
  /** Current board state — what a caller persists. */
  getState: () => LocalRoomState;
};

export type CreateLocalClassSocketOpts = {
  /** Seed the room (a saved study chapter, a puzzle FEN, an imported game). */
  initial?: Partial<LocalRoomState> | null;
  /** Fires after every state-mutating frame — drive autosave from this. */
  onChange?: (state: LocalRoomState) => void;
};

export function createLocalClassSocket(opts: CreateLocalClassSocketOpts = {}): LocalClassSocket {
  const room: LocalRoomState = { ...emptyRoomState(), ...(opts.initial || {}) };
  // A seeded tree needs fen/history/cursorIdx derived, exactly as the server
  // does on room load — otherwise the first paint shows the start position
  // while the notation panel shows a cursor deep in the tree.
  recomputeFromTree(room);
  room.shapes = shapesAtCursor(room);

  const sock: LocalClassSocket = {
    readyState: 1,            // WebSocket.OPEN
    onopen: null, onmessage: null, onerror: null, onclose: null,
    send: () => {}, close: () => {},
    getState: () => room,
  };

  // Frames are delivered out-of-band (like a real socket) so a send() can
  // never re-enter React mid-render.
  const emit = (frame: any) => {
    setTimeout(() => {
      if (sock.readyState !== 1) return;
      try { sock.onmessage?.({ data: JSON.stringify(frame) }); } catch { /* */ }
    }, 0);
  };
  const stateFrame = () => ({
    type: "state", fen: room.fen, startFen: room.startFen, lastMove: room.lastMove,
    history: room.history, cursorIdx: room.cursorIdx, tree: room.tree, cursorPath: room.cursorPath,
    participants: 1, locked: room.locked, shapes: room.shapes, startShapes: room.startShapes,
    orientation: room.orientation,
  });
  const changed = () => { try { opts.onChange?.(room); } catch { /* */ } };

  /** Mirror of the server's syncShapesToPosition: re-point room.shapes at the
   *  cursor and emit an annot frame only when the visible set actually moves. */
  const syncShapes = () => {
    const next = shapesAtCursor(room);
    const prev = room.shapes;
    const same = prev.length === next.length && prev.every((s, i) => {
      const q = next[i]!;
      return s.orig === q.orig && s.dest === q.dest && s.brush === q.brush;
    });
    room.shapes = next;
    if (same) return;
    emit({ type: "annot", shapes: room.shapes, participants: 1 });
  };

  sock.send = (data: string) => {
    if (sock.readyState !== 1) return;
    let frame: any;
    try { frame = JSON.parse(data); } catch { return; }
    if (!frame || typeof frame.type !== "string") return;

    switch (frame.type) {
      case "ping":
        emit({ type: "pong" });
        return;

      // Identity/attendance has no meaning offline. Claim coach immediately so
      // every coach-gated control (setup, tree edits, lock, flip) is live, then
      // hand over the opening snapshot.
      case "hello":
        emit({ type: "role", role: "coach" });
        emit(stateFrame());
        return;

      // Class-only frames — accepted and ignored so the board never errors.
      case "pointer": case "pointer-off":
      case "challenge:start": case "challenge:end":
      case "challenge:snapshot": case "challenge:move":
        return;

      case "move": {
        const mv = frame.move;
        if (!mv || typeof mv.from !== "string" || typeof mv.to !== "string") return;
        // chess.js is the tie-breaker, as server-side. Illegal moves are
        // dropped and the sender reconciles from the state frame.
        const c = new Chess(room.fen);
        let ok = false;
        try { ok = !!c.move({ from: mv.from, to: mv.to, promotion: (mv.promotion as any) || "q" }); }
        catch { ok = false; }
        if (!ok) { emit(stateFrame()); return; }
        // Tree semantics: append as a child of the node at cursorPath. An
        // identical existing child is reused rather than duplicated, so a move
        // played at a rewound cursor branches instead of truncating the future.
        const newMove: LocalMove = { from: mv.from, to: mv.to, promotion: mv.promotion };
        let parentChildren = room.tree;
        for (const idx of room.cursorPath) parentChildren = parentChildren[idx]!.children;
        const norm = (p?: string) => (p || "q").toLowerCase();
        let existingIdx = parentChildren.findIndex((n) =>
          n.move.from === newMove.from && n.move.to === newMove.to && norm(n.move.promotion) === norm(newMove.promotion));
        if (existingIdx < 0) {
          parentChildren.push({ move: newMove, children: [] });
          existingIdx = parentChildren.length - 1;
        }
        room.cursorPath = [...room.cursorPath, existingIdx];
        recomputeFromTree(room);
        emit({
          type: "move", move: room.lastMove, fen: room.fen, startFen: room.startFen,
          history: room.history, cursorIdx: room.cursorIdx, tree: room.tree,
          cursorPath: room.cursorPath, participants: 1, locked: room.locked,
        });
        syncShapes();
        changed();
        return;
      }

      case "reset": {
        room.fen = START_FEN; room.startFen = START_FEN; room.tree = []; room.cursorPath = [];
        room.lastMove = null; room.history = []; room.cursorIdx = 0; room.startShapes = [];
        emit({ type: "reset", fen: room.fen, participants: 1, locked: room.locked });
        emit(stateFrame());
        syncShapes();
        changed();
        return;
      }

      case "stepBack": case "stepForward": {
        if (frame.type === "stepBack") {
          if (room.cursorPath.length === 0) return;
          room.cursorPath = room.cursorPath.slice(0, -1);
        } else {
          const extended = extendMainlineOnce(room.tree, room.cursorPath);
          if (!extended) return;
          room.cursorPath = extended;
        }
        recomputeFromTree(room);
        emit(stateFrame());
        syncShapes();
        return;
      }

      case "seek": {
        let nextPath: number[] | null = null;
        const p = frame.path;
        if (Array.isArray(p)) {
          const cleaned: number[] = [];
          let cur = room.tree;
          for (const raw of p) {
            const idx = Math.trunc(Number(raw));
            if (!Number.isFinite(idx) || idx < 0 || idx >= cur.length) break;
            cleaned.push(idx);
            cur = cur[idx]!.children;
          }
          nextPath = cleaned;
        } else {
          const raw = Number(frame.cursorIdx);
          if (!Number.isFinite(raw)) return;
          const want = Math.max(0, Math.round(raw));
          const built: number[] = [];
          let cur = room.tree;
          for (let i = 0; i < want; i++) {
            if (cur.length === 0) break;
            built.push(0);
            cur = cur[0]!.children;
          }
          nextPath = built;
        }
        if (!nextPath) return;
        if (nextPath.length === room.cursorPath.length && nextPath.every((v, i) => v === room.cursorPath[i])) return;
        room.cursorPath = nextPath;
        recomputeFromTree(room);
        emit(stateFrame());
        syncShapes();
        return;
      }

      case "promote-variation": case "make-mainline": case "delete-from": {
        const p = frame.path;
        if (!Array.isArray(p) || p.length === 0) return;
        const cleaned: number[] = [];
        let cur = room.tree;
        for (const raw of p) {
          const idx = Math.trunc(Number(raw));
          if (!Number.isFinite(idx) || idx < 0 || idx >= cur.length) return;
          cleaned.push(idx);
          cur = cur[idx]!.children;
        }
        if (frame.type === "promote-variation") {
          const k = cleaned[cleaned.length - 1]!;
          if (k <= 0) return;
          let parentArr = room.tree;
          for (let i = 0; i < cleaned.length - 1; i++) parentArr = parentArr[cleaned[i]!]!.children;
          [parentArr[k - 1], parentArr[k]] = [parentArr[k]!, parentArr[k - 1]!];
          if (room.cursorPath.length >= cleaned.length &&
              cleaned.slice(0, -1).every((v, i) => v === room.cursorPath[i]) &&
              room.cursorPath[cleaned.length - 1] === k) {
            room.cursorPath = [...cleaned.slice(0, -1), k - 1, ...room.cursorPath.slice(cleaned.length)];
          }
        } else if (frame.type === "make-mainline") {
          let arr = room.tree;
          const nextCursor: number[] = [];
          for (let i = 0; i < cleaned.length; i++) {
            const k = cleaned[i]!;
            if (k > 0) {
              [arr[0], arr[k]] = [arr[k]!, arr[0]!];
              if (room.cursorPath.length > i && cleaned.slice(0, i).every((v, j) => v === room.cursorPath[j])) {
                const c = room.cursorPath[i]!;
                if (c === 0)      room.cursorPath = [...room.cursorPath.slice(0, i), k, ...room.cursorPath.slice(i + 1)];
                else if (c === k) room.cursorPath = [...room.cursorPath.slice(0, i), 0, ...room.cursorPath.slice(i + 1)];
              }
            }
            nextCursor.push(0);
            arr = arr[0]!.children;
          }
          if (room.cursorPath.length <= cleaned.length) room.cursorPath = nextCursor;
        } else {
          let parentArr = room.tree;
          for (let i = 0; i < cleaned.length - 1; i++) parentArr = parentArr[cleaned[i]!]!.children;
          const k = cleaned[cleaned.length - 1]!;
          parentArr.splice(k, 1);
          if (room.cursorPath.length >= cleaned.length &&
              cleaned.every((v, i) => v === room.cursorPath[i])) {
            room.cursorPath = cleaned.slice(0, -1);
          } else if (room.cursorPath.length >= cleaned.length &&
                     cleaned.slice(0, -1).every((v, i) => v === room.cursorPath[i]) &&
                     (room.cursorPath[cleaned.length - 1] ?? -1) > k) {
            room.cursorPath = [...cleaned.slice(0, -1), room.cursorPath[cleaned.length - 1]! - 1, ...room.cursorPath.slice(cleaned.length)];
          }
        }
        recomputeFromTree(room);
        emit(stateFrame());
        syncShapes();
        changed();
        return;
      }

      case "load-tree": {
        const cleanTree = sanitizeTree(frame.tree);
        if (!Array.isArray(frame.tree)) return;
        let cleanStartFen = room.startFen;
        if (typeof frame.startFen === "string" && frame.startFen.length > 0) {
          try { cleanStartFen = new Chess(frame.startFen).fen(); } catch { return; }
        }
        const cleanCursorPath: number[] = [];
        if (Array.isArray(frame.cursorPath)) {
          let cur = cleanTree;
          for (const raw of frame.cursorPath) {
            const idx = Math.trunc(Number(raw));
            if (!Number.isFinite(idx) || idx < 0 || idx >= cur.length) break;
            cleanCursorPath.push(idx);
            cur = cur[idx]!.children;
          }
        }
        room.startFen = cleanStartFen;
        room.tree = cleanTree;
        room.cursorPath = cleanCursorPath;
        room.startShapes = [];
        recomputeFromTree(room);
        emit(stateFrame());
        syncShapes();
        changed();
        return;
      }

      case "annotate-move": {
        const p = frame.path;
        if (!Array.isArray(p) || p.length === 0) return;
        let cur = room.tree;
        let target: LocalTreeNode | null = null;
        for (let i = 0; i < p.length; i++) {
          const idx = Math.trunc(Number(p[i]));
          if (!Number.isFinite(idx) || idx < 0 || idx >= cur.length) return;
          if (i === p.length - 1) target = cur[idx]!;
          else cur = cur[idx]!.children;
        }
        if (!target) return;
        const rawNag = frame.nag;
        if (rawNag === null || rawNag === "") delete target.nag;
        else if (typeof rawNag === "string") target.nag = rawNag.slice(0, 4);
        const rawComment = frame.comment;
        if (rawComment === null || rawComment === "") delete target.comment;
        else if (typeof rawComment === "string") target.comment = rawComment.slice(0, 500);
        emit(stateFrame());
        changed();
        return;
      }

      case "loadFen": {
        let cleanFen: string;
        try { cleanFen = new Chess(frame.fen).fen(); } catch { return; }
        room.fen = cleanFen; room.startFen = cleanFen; room.tree = []; room.cursorPath = [];
        room.lastMove = null; room.history = []; room.cursorIdx = 0; room.startShapes = [];
        emit(stateFrame());
        syncShapes();
        changed();
        return;
      }

      case "annot": {
        const cleaned = sanitizeShapes(frame.shapes);
        setShapesAtCursor(room, cleaned);
        room.shapes = cleaned;
        emit({ type: "annot", shapes: room.shapes, participants: 1 });
        changed();
        return;
      }

      // Local-only: flip the ⭐ revise flag on one node. My Studies feeds its
      // spaced-repetition queue from these. Deliberately NOT a load-tree (which
      // would clear root arrows) and not a class-ws frame — the live server
      // ignores unknown types, so sending it there is harmless.
      case "study:revise": {
        const p = frame.path;
        if (!Array.isArray(p) || p.length === 0) return;
        let cur = room.tree;
        let target: LocalTreeNode | null = null;
        for (let i = 0; i < p.length; i++) {
          const idx = Math.trunc(Number(p[i]));
          if (!Number.isFinite(idx) || idx < 0 || idx >= cur.length) return;
          if (i === p.length - 1) target = cur[idx]!;
          else cur = cur[idx]!.children;
        }
        if (!target) return;
        if (frame.revise) target.revise = true; else delete target.revise;
        emit(stateFrame());
        changed();
        return;
      }

      case "lock": {
        room.locked = !!frame.locked;
        emit({ type: "lock", locked: room.locked, participants: 1 });
        return;
      }

      case "orientation": {
        if (frame.orientation !== "white" && frame.orientation !== "black") return;
        room.orientation = frame.orientation;
        emit({ type: "orientation", orientation: room.orientation });
        changed();
        return;
      }

      default:
        return;
    }
  };

  sock.close = () => {
    if (sock.readyState === 3) return;
    sock.readyState = 3;   // WebSocket.CLOSED
    try { sock.onclose?.({ code: 1000, reason: "local" }); } catch { /* */ }
  };

  // Open on the next tick so the caller can attach handlers first, exactly as
  // a real socket does.
  setTimeout(() => { if (sock.readyState === 1) { try { sock.onopen?.({}); } catch { /* */ } } }, 0);

  return sock;
}
