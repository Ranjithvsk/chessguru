// Shared chess board for a live class — a self-contained client for the
// existing class-ws bus (wss://…/v2api/class-ws/:room). Dropped into the
// Dream Meet (LiveKit) room so it has the SAME synced board as the /call room:
// the coach drags a piece and every student's board updates; right-click draws
// arrows/circles for everyone. Server is authoritative (echoes fen back).
//
// The hello carries the signed-in user's identity so class attendance is
// logged against the real student (the class-ws server writes classAttendance
// on join) — same collection the academy roster's "✓ attended" reads.
import { useEffect, useMemo, useRef, useState } from "react";
import { Chess, validateFen } from "chess.js";
import type { Key } from "chessground/types";
import Board from "./Board";
import { AnnotationToolbar, applyAnnotationClick, computeAttackShapes, computePinShapes, useAnnotationTool, type AnnotShape } from "./AnnotationToolbar";

type BoardMove = { from: string; to: string; promotion?: string };

function destsFromChess(game: Chess): Map<Key, Key[]> {
  const dests = new Map<Key, Key[]>();
  for (const m of game.moves({ verbose: true }) as any[]) {
    const arr = dests.get(m.from as Key) ?? [];
    arr.push(m.to as Key);
    dests.set(m.from as Key, arr);
  }
  return dests;
}

// Setup-position modal state is shared between the SharedClassBoard (renders
// the modal + owns the ws) and the ClassV2 footer control (renders the trigger
// button OUTSIDE the board — owner 2026-08-12: the on-board 📋 button was
// covering pieces on a8/b8). Module-scoped so we don't have to prop-drill or
// lift the class-ws ref out of the component.
let _setupOpen = false;
const _setupSubs = new Set<(v: boolean) => void>();
export function setClassSetupOpen(v: boolean) { _setupOpen = v; _setupSubs.forEach((f) => f(v)); }
export function useClassSetupOpen(): boolean {
  const [v, setV] = useState(_setupOpen);
  useEffect(() => { _setupSubs.add(setV); return () => { _setupSubs.delete(setV); }; }, []);
  return v;
}

// Coach action bus — reset / stepBack / stepForward triggers from the footer
// buttons rendered by ClassV2 flow through this. ClassV2 has no access to the
// class-ws socket; module scope keeps the wiring flat.
type ClassBoardAction = "reset" | "stepBack" | "stepForward" | "toggleLock" | "flipOrientation";
const _actionSubs = new Set<(a: ClassBoardAction) => void>();
export function triggerClassBoardAction(a: ClassBoardAction) { _actionSubs.forEach((f) => f(a)); }
export function triggerClassFlipOrientation() { _actionSubs.forEach((f) => f("flipOrientation")); }

// Cursor position (which move index students are currently seeing) — the
// footer nav shows "3 / 12" so the coach knows where they are in the game.
let _cursorInfo = { cursorIdx: 0, historyLen: 0 };
const _cursorSubs = new Set<() => void>();
function _publishCursor(cursorIdx: number, historyLen: number) {
  _cursorInfo = { cursorIdx, historyLen };
  _cursorSubs.forEach((f) => f());
}
export function useClassCursorInfo(): { cursorIdx: number; historyLen: number } {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((n) => n + 1); _cursorSubs.add(f); return () => { _cursorSubs.delete(f); }; }, []);
  return _cursorInfo;
}

// Move list snapshot — startFen (either the standard opening OR whatever the
// coach loaded via loadFen) + the full variation TREE played from it + the
// cursor path. Consumers (ClassV2's notation panel) derive SAN + move numbers
// from this. Module-scoped so the panel doesn't have to prop-drill through
// the LiveKit / class-ws intermediate tree.
export type SharedMove = { from: string; to: string; promotion?: string };
// nag = glyph appended after the SAN (!, ?, ±, +=, etc.). comment = free-form
// text under the move. shapes = arrows/circles drawn while THIS position was
// on the board (saved per-position server-side; see class-ws setShapesAtCursor).
// All optional; server broadcasts them via state frames.
export type SharedShape = { orig: string; dest?: string; brush?: string };
export type SharedTreeNode = { move: SharedMove; nag?: string; comment?: string; shapes?: SharedShape[]; children: SharedTreeNode[] };
let _moveList: {
  startFen: string;
  history: SharedMove[];       // legacy — linear moves up to cursorPath
  cursorIdx: number;           // legacy — cursorPath.length
  tree: SharedTreeNode[];
  cursorPath: number[];
} = {
  startFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  history: [], cursorIdx: 0,
  tree: [], cursorPath: [],
};
const _moveListSubs = new Set<() => void>();
function _publishMoveList(startFen: string, history: SharedMove[], cursorIdx: number, tree: SharedTreeNode[], cursorPath: number[]) {
  _moveList = { startFen, history, cursorIdx, tree, cursorPath };
  _moveListSubs.forEach((f) => f());
}
export function useClassMoveList() {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((n) => n + 1); _moveListSubs.add(f); return () => { _moveListSubs.delete(f); }; }, []);
  return _moveList;
}

// startShapes = arrows/circles the coach drew AT THE STARTING POSITION
// (before any move played). Tree-node shapes cover every other position;
// this module var covers root. Used by the Send-position modal to include
// root-level arrows in the pack it POSTs. Updated from state-frame handler.
let _startShapes: SharedShape[] = [];
const _startShapesSubs = new Set<() => void>();
function _publishStartShapes(next: SharedShape[]) { _startShapes = next; _startShapesSubs.forEach((f) => f()); }
export function useClassStartShapes(): SharedShape[] {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((n) => n + 1); _startShapesSubs.add(f); return () => { _startShapesSubs.delete(f); }; }, []);
  return _startShapes;
}

// Coach seek — jump cursor to a specific ply (legacy: cursorIdx) OR to a
// tree path (new: number[] into the tree). Goes through the module-scoped
// ws sender registered by SharedClassBoard.
type SeekFn = (arg: number | number[]) => void;
let _seekFn: SeekFn | null = null;
export function triggerClassSeek(arg: number | number[]) { _seekFn?.(arg); }

// Coach tree ops — right-click menu on any move in the notation panel.
// Mirrors /openings analysis: Promote variation / Make main line / Delete.
type PathFn = (path: number[]) => void;
let _promoteFn: PathFn | null = null;
let _mainlineFn: PathFn | null = null;
let _deleteFn: PathFn | null = null;
export function triggerClassPromoteVariation(path: number[]) { _promoteFn?.(path); }
export function triggerClassMakeMainline(path: number[]) { _mainlineFn?.(path); }
export function triggerClassDeleteFrom(path: number[]) { _deleteFn?.(path); }

// Coach annotates a move — set/clear NAG glyph + text comment on the node
// at `path`. Passing `null` for a field clears it; undefined leaves it alone.
type AnnotateFn = (path: number[], args: { nag?: string | null; comment?: string | null }) => void;
let _annotateFn: AnnotateFn | null = null;
export function triggerClassAnnotateMove(path: number[], args: { nag?: string | null; comment?: string | null }) { _annotateFn?.(path, args); }

// Teach Opening — coach loads a whole tree into the class board (from
// repertoire / corpus / master games). Wholesale replaces room.tree +
// room.startFen + room.cursorPath server-side. startFen defaults to the
// standard opening if omitted.
type LoadTreeFn = (args: { startFen?: string; tree: SharedTreeNode[]; cursorPath?: number[] }) => void;
let _loadTreeFn: LoadTreeFn | null = null;
export function triggerClassLoadTree(args: { startFen?: string; tree: SharedTreeNode[]; cursorPath?: number[] }) { _loadTreeFn?.(args); }

// Room lock state (whether students can move pieces). Default = LOCKED —
// students can never accidentally scramble the board mid-lesson (owner
// 2026-08-12). Coach's footer button toggles it for interactive practice.
let _lockedState = true;
const _lockedSubs = new Set<() => void>();
function _publishLocked(v: boolean) {
  if (_lockedState === v) return;
  _lockedState = v;
  _lockedSubs.forEach((f) => f());
}
export function useClassLocked(): boolean {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((n) => n + 1); _lockedSubs.add(f); return () => { _lockedSubs.delete(f); }; }, []);
  return _lockedState;
}
export function triggerClassLockToggle() {
  _actionSubs.forEach((f) => f("toggleLock"));
}

// Room orientation — coach flip broadcasts to all students so both sides see
// the same POV. Server keeps the last orientation in room state so late
// joiners land on the correct side. Module scope + subscribe hook mirrors
// the lock pattern above.
type Orientation = "white" | "black";
let _orientationState: Orientation = "white";
const _orientationSubs = new Set<() => void>();
function _publishOrientation(v: Orientation) {
  if (_orientationState === v) return;
  _orientationState = v;
  _orientationSubs.forEach((f) => f());
}
export function useClassOrientation(): Orientation {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((n) => n + 1); _orientationSubs.add(f); return () => { _orientationSubs.delete(f); }; }, []);
  return _orientationState;
}

// ─────────────────────────────────────────────────────────────────────
// Student challenge scratchpad tree — full variation tree so students can
// try different ideas + branches while solving (2026-09-02).
// ─────────────────────────────────────────────────────────────────────
export interface ChallengeTreeNode {
  from: string;
  to: string;
  promotion?: string;
  san: string;
  children: ChallengeTreeNode[];
}
/** Walk (tree, cursorPath) and return the FEN + last move at the cursor,
 *  plus the SAN chain from root to cursor (used for snapshot send). */
/** Shallow-clone a tree (children arrays are new so mutating in place is
 *  safe for the caller). Used before edits so the ref points to a new
 *  object graph and React can re-render dependent panels. */
export function cloneChallengeNode(n: ChallengeTreeNode): ChallengeTreeNode {
  return { from: n.from, to: n.to, promotion: n.promotion, san: n.san, children: n.children.map(cloneChallengeNode) };
}

/** Render a challenge tree as a PGN-style string with variations in parens:
 *  `1.e4 (1.d4 d5 2.c4) e5 2.Nf3`. sideAtRoot is inferred from startFen. Used
 *  by the teacher's answers panel to keep student branches visually distinct
 *  instead of collapsing everything into one flat line. */
export function challengeTreeToPgn(tree: ChallengeTreeNode[], startFen: string): string {
  const parts = String(startFen || "").split(" ");
  const sideAtRoot: "w" | "b" = parts[1] === "b" ? "b" : "w";
  const render = (nodes: ChallengeTreeNode[], plyBase: number, variation: boolean): string => {
    if (!Array.isArray(nodes) || nodes.length === 0) return "";
    const out: string[] = [];
    const main = nodes[0]!;
    const isWhite = sideAtRoot === "w" ? plyBase % 2 === 0 : plyBase % 2 === 1;
    const moveNum = Math.floor(plyBase / 2) + 1;
    if (isWhite) out.push(`${moveNum}.${main.san}`);
    else out.push((variation || plyBase === 0) ? `${moveNum}...${main.san}` : main.san);
    for (let j = 1; j < nodes.length; j++) {
      const alt = nodes[j]!;
      const head = isWhite ? `${moveNum}.${alt.san}` : `${moveNum}...${alt.san}`;
      const rest = render(alt.children ?? [], plyBase + 1, true);
      out.push(rest ? `(${head} ${rest})` : `(${head})`);
    }
    const cont = render(main.children ?? [], plyBase + 1, variation);
    if (cont) out.push(cont);
    return out.join(" ");
  };
  return render(tree, 0, false);
}

export function fenAtChallengeCursor(startFen: string, tree: ChallengeTreeNode[], cursorPath: number[]): { fen: string; sanChain: string[]; lastMoveFromTo?: { from: string; to: string } } {
  let c: Chess;
  try { c = new Chess(startFen); } catch { c = new Chess(); }
  const chain: string[] = [];
  let cur = tree;
  let last: { from: string; to: string } | undefined;
  for (const idx of cursorPath) {
    const n = cur[idx];
    if (!n) break;
    try { c.move({ from: n.from, to: n.to, promotion: (n.promotion as any) || "q" }); chain.push(n.san); last = { from: n.from, to: n.to }; }
    catch { break; }
    cur = n.children;
  }
  return { fen: c.fen(), sanChain: chain, lastMoveFromTo: last };
}

// ─────────────────────────────────────────────────────────────────────
// Challenge mode (2026-09-01, "find the good moves"):
// Module-level state so ClassV2 (footer coach controls, floating chip,
// answers panel) can read/drive it via hooks. Component populates from
// WS frames + sends via triggers.
// ─────────────────────────────────────────────────────────────────────
export interface ChallengeAnswerRow { userId: string; displayName: string; movesSan: string[]; tree?: ChallengeTreeNode[]; firstMoveAt?: number; lastMoveAt?: number; finalFen?: string; correct?: boolean | null; }
export interface ChallengeState {
  positionFen: string;
  startFen: string;
  prompt: string;
  startedAt: number;               // unix ms — used as the mark-answer key
  endsAt: number;
  answered: number;
  total: number;
  active: boolean;                 // false after end — used to show Answers panel
  answers: ChallengeAnswerRow[] | null;  // populated for coach after end
  studentMoves: string[];          // local SAN sequence for THIS student (empty for coach)
}
let _challenge: ChallengeState | null = null;
const _challengeSubs = new Set<() => void>();
function _publishChallenge(next: ChallengeState | null) { _challenge = next; _challengeSubs.forEach((f) => f()); }
export function useClassChallenge(): ChallengeState | null {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((n) => n + 1); _challengeSubs.add(f); return () => { _challengeSubs.delete(f); }; }, []);
  return _challenge;
}
// Coach-side triggers — the send fns get wired up by SharedClassBoard on mount.
let _challengeStartFn: ((opts: { positionFen: string; startFen: string; prompt: string; durationSec: number }) => void) | null = null;
let _challengeEndFn:   (() => void) | null = null;
let _challengeDismissFn: (() => void) | null = null;
export function triggerClassChallengeStart(opts: { positionFen: string; startFen: string; prompt: string; durationSec: number }) { _challengeStartFn?.(opts); }
export function triggerClassChallengeEnd() { _challengeEndFn?.(); }
export function triggerClassChallengeDismiss() { _challengeDismissFn?.(); }

// Toast for "coach marked your answer" — fires when the server pushes
// challenge_marked. Module-level so the SharedClassBoard fires it AND a
// separately-rendered toast host reads it, without prop-drilling.
export interface ChallengeMarkToast { correct: boolean | null; at: number; }
let _markToast: ChallengeMarkToast | null = null;
const _markToastSubs = new Set<() => void>();
function _publishChallengeMarkToast(t: ChallengeMarkToast | null) { _markToast = t; _markToastSubs.forEach((f) => f()); }
export function useChallengeMarkToast(): ChallengeMarkToast | null {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((n) => n + 1); _markToastSubs.add(f); return () => { _markToastSubs.delete(f); }; }, []);
  return _markToast;
}
export function dismissChallengeMarkToast() { _publishChallengeMarkToast(null); }

// ─────────────────────────────────────────────────────────────────────
// PositionEditorModal — inline "board editor" for the class Setup flow.
// Coach picks a piece from the palette, clicks squares to place it, and
// EVERY change is broadcast live via loadFen so students see the position
// being assembled in real-time (owner 2026-08-12: "students should also
// see live setting of board"). Fixed viewport overlay (was absolute-in-
// board before, cramped by container queries), palette + board side-by-
// side, small FEN paste tucked at the bottom for the pro users.
// ─────────────────────────────────────────────────────────────────────
function fenToGrid(fen: string): string[][] {
  const grid: string[][] = Array.from({ length: 8 }, () => Array(8).fill(""));
  const placement = (fen.split(" ")[0] || "");
  const ranks = placement.split("/");
  for (let r = 0; r < 8 && r < ranks.length; r++) {
    let col = 0;
    for (const ch of ranks[r]) {
      if (/\d/.test(ch)) col += parseInt(ch, 10);
      else if (col < 8) { grid[r][col] = ch; col++; }
    }
  }
  return grid;
}
function gridToFen(grid: string[][], turn: "w" | "b", castling: string, ep: string): string {
  const ranks: string[] = [];
  for (let r = 0; r < 8; r++) {
    let s = ""; let empty = 0;
    for (let c = 0; c < 8; c++) {
      const p = grid[r][c];
      if (!p) empty++;
      else { if (empty > 0) { s += empty; empty = 0; } s += p; }
    }
    if (empty > 0) s += empty;
    ranks.push(s);
  }
  return `${ranks.join("/")} ${turn} ${castling || "-"} ${ep || "-"} 0 1`;
}
function squareToRowCol(sq: string): [number, number] | null {
  if (sq.length !== 2) return null;
  const col = sq.charCodeAt(0) - 97;
  const row = 8 - parseInt(sq[1], 10);
  if (col < 0 || col > 7 || row < 0 || row > 7 || isNaN(row)) return null;
  return [row, col];
}
const PIECE_UNICODE: Record<string, string> = {
  K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟",
};
const PIECE_LABEL: Record<string, string> = {
  K: "White King", Q: "White Queen", R: "White Rook", B: "White Bishop", N: "White Knight", P: "White Pawn",
  k: "Black King", q: "Black Queen", r: "Black Rook", b: "Black Bishop", n: "Black Knight", p: "Black Pawn",
};

// Reject positions that no legal game could ever reach. Runs chess.js's
// structural validateFen first (kings missing, kings duplicated, pawns on
// edge rows, bad grid) then adds the checks chess.js is intentionally
// permissive about: adjacent kings, side-not-to-move in check, both sides
// in check, pawn/piece counts beyond what promotion allows.
function describeIllegalPosition(fen: string): string | null {
  const v = validateFen(fen);
  if (!v.ok) {
    const e = v.error || "Invalid FEN.";
    if (/missing white king/i.test(e))     return "No white king on the board.";
    if (/missing black king/i.test(e))     return "No black king on the board.";
    if (/too many white kings/i.test(e))   return "Two (or more) white kings on the board — only one is allowed.";
    if (/too many black kings/i.test(e))   return "Two (or more) black kings on the board — only one is allowed.";
    if (/pawns are on the edge rows/i.test(e)) return "A pawn is on the 1st or 8th rank — pawns can never stand there.";
    if (/side-to-move/i.test(e))           return "Side to move must be White or Black.";
    if (/en-passant/i.test(e))             return "En-passant square is invalid for this position.";
    if (/castling/i.test(e))               return "Castling availability doesn't match king / rook positions.";
    return e.replace(/^Invalid FEN:\s*/i, "");
  }

  const parts = fen.trim().split(/\s+/);
  const placement = parts[0] || "";
  const turn = (parts[1] === "b" ? "b" : "w") as "w" | "b";
  const grid = fenToGrid(placement);

  // Piece counts (per color)
  const c0 = { P:0,N:0,B:0,R:0,Q:0,K:0, p:0,n:0,b:0,r:0,q:0,k:0 };
  let wK: [number, number] | null = null;
  let bK: [number, number] | null = null;
  for (let r = 0; r < 8; r++) {
    const row = grid[r]!;
    for (let c = 0; c < 8; c++) {
      const p = row[c];
      if (!p) continue;
      if (p in c0) (c0 as any)[p]++;
      if (p === "K") wK = [r, c];
      else if (p === "k") bK = [r, c];
    }
  }

  // Adjacent kings
  if (wK && bK && Math.abs(wK[0] - bK[0]) <= 1 && Math.abs(wK[1] - bK[1]) <= 1) {
    return "The two kings are on touching squares — kings must always be at least one square apart.";
  }

  // Too many pawns / total pieces
  if (c0.P > 8) return `Too many white pawns (${c0.P}) — a side can have at most 8.`;
  if (c0.p > 8) return `Too many black pawns (${c0.p}) — a side can have at most 8.`;
  const wTotal = c0.P + c0.N + c0.B + c0.R + c0.Q + c0.K;
  const bTotal = c0.p + c0.n + c0.b + c0.r + c0.q + c0.k;
  if (wTotal > 16) return `Too many white pieces (${wTotal}) — a side can have at most 16.`;
  if (bTotal > 16) return `Too many black pieces (${bTotal}) — a side can have at most 16.`;

  // Promotion sanity: any extra piece beyond the initial stock must come from
  // a promoted pawn, so `pawns + Σ max(0, count - initial)` still can't top 8.
  const wExtra = Math.max(0, c0.Q - 1) + Math.max(0, c0.R - 2) + Math.max(0, c0.B - 2) + Math.max(0, c0.N - 2);
  const bExtra = Math.max(0, c0.q - 1) + Math.max(0, c0.r - 2) + Math.max(0, c0.b - 2) + Math.max(0, c0.n - 2);
  if (c0.P + wExtra > 8) return "White has more promoted pieces than the missing pawns could have produced.";
  if (c0.p + bExtra > 8) return "Black has more promoted pieces than the missing pawns could have produced.";

  // Side-not-to-move must not be in check — the side to move would just
  // capture that king. Use chess.js by swapping the turn on a copy of the
  // FEN, then asking whether the (swapped) side-to-move is in check.
  let sideNotToMoveInCheck = false;
  let sideToMoveInCheck = false;
  try {
    const swapped = [placement, turn === "w" ? "b" : "w", "-", "-", "0", "1"].join(" ");
    sideNotToMoveInCheck = new Chess(swapped).isCheck();
  } catch { /* structural checks above would've caught it */ }
  try {
    const same = [placement, turn, "-", "-", "0", "1"].join(" ");
    sideToMoveInCheck = new Chess(same).isCheck();
  } catch { /* */ }

  if (sideNotToMoveInCheck && sideToMoveInCheck) {
    return "Both kings are in check at the same time — impossible in a legal game.";
  }
  if (sideNotToMoveInCheck) {
    return turn === "w"
      ? "White to move, but the black king is already in check — Black would have moved into check, which isn't legal."
      : "Black to move, but the white king is already in check — White would have moved into check, which isn't legal.";
  }

  return null;
}

export function PositionEditorModal(props: {
  initialFen: string;
  onApply: (fen: string) => void;
  onClose: () => void;
  error: string | null;
}) {
  const { initialFen, onApply, onClose } = props;
  const [grid, setGrid] = useState<string[][]>(() => fenToGrid(initialFen));
  const [turn, setTurn] = useState<"w" | "b">(() => (initialFen.split(" ")[1] === "b" ? "b" : "w"));
  const initialCastling = useRef<string>(initialFen.split(" ")[2] || "KQkq").current;
  const initialEp = useRef<string>(initialFen.split(" ")[3] || "-").current;
  const [selected, setSelected] = useState<string>("P");    // piece to paint, "_" = eraser
  const [fenText, setFenText] = useState<string>(initialFen);
  const [showFen, setShowFen] = useState<boolean>(false);

  const currentFen = gridToFen(grid, turn, initialCastling, initialEp);
  const illegalErr = describeIllegalPosition(currentFen);

  // Live-broadcast every edit so students see the position being built up.
  // Debounced ~120ms to smooth rapid click sequences into one broadcast.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { onApply(currentFen); }, 120);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFen]);
  // Sync typed FEN back into the grid whenever the paste box changes (only if
  // valid; ignore transient half-typed FENs).
  useEffect(() => {
    const t = fenText.trim();
    if (!t || t === currentFen) return;
    try { const c = new Chess(t); setGrid(fenToGrid(c.fen())); setTurn(t.split(" ")[1] === "b" ? "b" : "w"); }
    catch { /* invalid, ignore until user finishes */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fenText]);

  // Click semantics (owner ask 2026-09-02):
  //   * Eraser picked → click always clears the square.
  //   * Piece picked → click on EMPTY square places the piece.
  //   * Piece picked → click on square holding a DIFFERENT piece replaces it.
  //   * Piece picked → click on square holding the SAME piece removes it (toggle).
  // Matches the Lichess board-editor / SCID pattern — makes fixing typos
  // fast without switching to the eraser.
  const onSquareClick = (sq: Key) => {
    const rc = squareToRowCol(String(sq));
    if (!rc) return;
    const [r, c] = rc;
    setGrid((g) => {
      const ng = g.map((row) => row.slice());
      if (selected === "_") {
        ng[r][c] = "";
      } else if (ng[r][c] === selected) {
        ng[r][c] = "";       // same piece → remove
      } else {
        ng[r][c] = selected; // empty or different → place/replace
      }
      return ng;
    });
  };
  const clearAll = () => setGrid(fenToGrid("8/8/8/8/8/8/8/8"));
  const resetStart = () => { setGrid(fenToGrid(new Chess().fen())); setTurn("w"); };
  const revert = () => { setGrid(fenToGrid(initialFen)); setTurn(initialFen.split(" ")[1] === "b" ? "b" : "w"); };

  const applyAndClose = () => { onApply(currentFen); onClose(); };
  const cancel = () => { onApply(initialFen); onClose(); };   // revert live edits when cancelling
  // One-click "start a fresh game from move 1" — sets the standard opening
  // position with white to move AND broadcasts + closes, so the coach doesn't
  // have to click Start → ✓ Done separately. Handy when a class has gone
  // through a bunch of variations and the coach wants a clean slate to
  // begin a new game.
  const startFreshGame = () => { const fresh = new Chess().fen(); onApply(fresh); onClose(); };

  const whiteRow = ["K","Q","R","B","N","P"];
  const blackRow = ["k","q","r","b","n","p"];

  return (
    // NO backdrop-click-to-close: the same click that opened the modal also
    // fires on the newly-mounted backdrop and would instantly cancel. Owner
    // 2026-08-12: "it's opening but instantly closing". Close via × / Cancel /
    // Escape instead — safer for a stateful editor anyway (backdrop clicks
    // eat unsaved work).
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/70 backdrop-blur-sm p-4 sm:items-center"
      onKeyDown={(e) => { if (e.key === "Escape") cancel(); }}
      tabIndex={-1}
    >
      <div
        className="my-auto w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-2xl border border-ink-700 bg-ink-900 shadow-2xl"
      >
        {/* header */}
        <div className="flex items-center justify-between border-b border-ink-800 bg-ink-800/60 px-4 py-2.5">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-base font-bold text-white">📋 Set up position</span>
            <span className="text-[10px] text-emerald-300">● Live — students see every change</span>
          </div>
          <button onClick={cancel} title="Cancel (revert to the position that was there before)"
            className="rounded-md p-1 text-xl leading-none text-ink-400 hover:bg-ink-700 hover:text-white">×</button>
        </div>

        {illegalErr && (
          <div className="border-b border-amber-500/40 bg-amber-500/15 px-4 py-2 text-[12px] text-amber-100">
            <span className="font-bold">⚠ Illegal position — </span>{illegalErr}
          </div>
        )}

        <div className="grid gap-4 p-4 md:grid-cols-[1fr_360px]">
          {/* Editor board (fills left column, capped).
              An overlay div captures clicks and resolves the square from
              the raw bounding-rect + click coordinates. Bypasses
              chessground's onSelect which had edge-misalignment issues
              at some zoom levels / high-DPI displays (owner report
              2026-09-02: "I have to click at the corner of the square,
              sometimes places to nearby square"). Chessground's own
              square resolution uses clientX/Y vs bounds, and our
              cqi-sized board has fractional pixel widths per square —
              boundary clicks round to the wrong square. The overlay's
              simple Math.floor((relX / rect.width) * 8) is exact. */}
          <div className="mx-auto w-full max-w-[360px]">
            <div className="relative">
              <Board
                fen={currentFen}
                movableColor="none"
                dests={new Map() as any}
                coordinates
              />
              <div
                className="absolute inset-0 z-10"
                aria-label="setup click overlay"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const relX = e.clientX - rect.left;
                  const relY = e.clientY - rect.top;
                  if (rect.width <= 0 || rect.height <= 0) return;
                  // Clamp to [0,7]. Math.floor over an 8-way split gives the
                  // exact square regardless of fractional pixel widths.
                  const col = Math.max(0, Math.min(7, Math.floor((relX / rect.width) * 8)));
                  const row = Math.max(0, Math.min(7, Math.floor((relY / rect.height) * 8)));
                  // Setup board is always white-orientation, so col=0 → a-file,
                  // row=0 → rank 8. If we ever add black orientation to the
                  // setup UI, flip both here.
                  const file = String.fromCharCode(97 + col);
                  const rank = 8 - row;
                  onSquareClick(`${file}${rank}` as Key);
                }}
              />
            </div>
            <div className="mt-2 flex items-center justify-center gap-4 text-xs text-ink-300">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" checked={turn === "w"} onChange={() => setTurn("w")} className="accent-brand-500" />
                <span>White to move</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" checked={turn === "b"} onChange={() => setTurn("b")} className="accent-brand-500" />
                <span>Black to move</span>
              </label>
            </div>
          </div>

          {/* Right pane — palette + actions */}
          <div className="space-y-3">
            <button
              onClick={startFreshGame}
              title="Reset to the standard opening position with white to move — students see a fresh game"
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow hover:bg-emerald-500"
            >
              ▶ Start a fresh game
            </button>
            <div>
              <div className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-ink-500">Piece — tap then tap a square</div>
              <div className="flex flex-wrap justify-center gap-1.5">
                {whiteRow.map((p) => <PalettePieceBtn key={p} p={p} selected={selected === p} onClick={() => setSelected(p)} />)}
              </div>
              <div className="mt-1.5 flex flex-wrap justify-center gap-1.5">
                {blackRow.map((p) => <PalettePieceBtn key={p} p={p} selected={selected === p} onClick={() => setSelected(p)} />)}
              </div>
              <button
                onClick={() => setSelected("_")}
                title="Eraser — tap a square to remove the piece there"
                className={`mt-2 flex w-full items-center justify-center gap-2 rounded-lg border py-2 text-sm font-semibold transition ${selected === "_" ? "border-rose-400 bg-rose-500/20 text-rose-100" : "border-ink-700 bg-ink-800 text-ink-200 hover:bg-ink-700"}`}
              >
                ✕ Eraser
              </button>
            </div>

            <div className="border-t border-ink-800 pt-3">
              <div className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-ink-500">Quick actions</div>
              <div className="grid grid-cols-3 gap-1.5">
                <button onClick={resetStart}
                  className="rounded-lg border border-ink-700 bg-ink-800 px-2 py-1.5 text-xs text-ink-100 hover:bg-ink-700">Start</button>
                <button onClick={clearAll}
                  className="rounded-lg border border-ink-700 bg-ink-800 px-2 py-1.5 text-xs text-ink-100 hover:bg-ink-700">Empty</button>
                <button onClick={revert}
                  className="rounded-lg border border-ink-700 bg-ink-800 px-2 py-1.5 text-xs text-ink-100 hover:bg-ink-700">Revert</button>
              </div>
            </div>

            <div className="border-t border-ink-800 pt-3">
              <button
                onClick={() => setShowFen((v) => !v)}
                className="text-[11px] font-semibold text-ink-400 hover:text-ink-200"
              >
                {showFen ? "▾" : "▸"} Advanced — paste FEN
              </button>
              {showFen && (
                <textarea
                  value={fenText}
                  onChange={(e) => setFenText(e.target.value)}
                  rows={2}
                  spellCheck={false}
                  placeholder="Paste any FEN (Lichess, Chess.com, engine output)…"
                  className="mt-1.5 w-full rounded-lg border border-ink-700 bg-ink-800 px-2.5 py-2 font-mono text-[10px] text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none"
                />
              )}
              {props.error && <div className="mt-1 text-[11px] text-rose-400">{props.error}</div>}
              <div className="mt-1 text-[10px] text-ink-500 truncate" title={currentFen}>
                <span className="text-ink-400">Current:</span> <span className="font-mono">{currentFen}</span>
              </div>
            </div>

            <div className="flex items-center gap-2 border-t border-ink-800 pt-3">
              <button
                onClick={applyAndClose}
                disabled={!!illegalErr}
                title={illegalErr ? `Fix the illegal position first: ${illegalErr}` : "Apply this position to everyone"}
                className={`flex-1 rounded-lg px-4 py-2 text-sm font-bold text-white ${illegalErr ? "cursor-not-allowed bg-ink-700 opacity-60" : "bg-brand-500 hover:bg-brand-400"}`}
              >
                ✓ Done
              </button>
              <button
                onClick={cancel}
                title="Cancel — revert to the position that was on the board before you opened this"
                className="rounded-lg border border-ink-700 bg-ink-800 px-4 py-2 text-sm text-ink-200 hover:bg-ink-700"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Map FEN char → chessground piece class (piece.<type>.<color>) so the palette
// icons are the SAME cburnett SVGs that render on the board. No more unicode
// vs SVG mismatch (owner 2026-08-12: "edit piece make it same like pieces on
// board"). The CSS lives in chessground.cburnett.css imported by index.css.
const PIECE_TYPE_CLASS: Record<string, string> = {
  p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king",
};
function fenCharToPieceClass(p: string): string {
  const color = p === p.toUpperCase() ? "white" : "black";
  const type = PIECE_TYPE_CLASS[p.toLowerCase()];
  return `${type} ${color}`;
}
function PalettePieceBtn({ p, selected, onClick }: { p: string; selected: boolean; onClick: () => void }) {
  const isWhite = p === p.toUpperCase();
  return (
    <button
      onClick={onClick}
      title={PIECE_LABEL[p]}
      className={`relative grid h-11 w-11 place-items-center rounded-lg border transition ${
        selected
          ? "border-brand-400 ring-2 ring-brand-300 shadow-inner shadow-brand-500/40"
          : "border-ink-700"
      }`}
      style={{ background: isWhite ? "#1a1f29" : "#ffffff" }}
    >
      {/* Reuse chessground's own cburnett CSS by wrapping in .cg-wrap + <piece class>.
       *  Fixed 40×40 so palette pieces render at ~the same visual size as the
       *  40-45px pieces on the mini editor board next to us — owner asked to
       *  match sizes so the palette doesn't look "extra size". */}
      <div className="cg-wrap" style={{ width: "40px", height: "40px" }}>
        <piece
          className={fenCharToPieceClass(p)}
          style={{ position: "relative", display: "block", width: "100%", height: "100%", backgroundSize: "contain", backgroundRepeat: "no-repeat", backgroundPosition: "center" } as any}
        />
      </div>
    </button>
  );
}

export default function SharedClassBoard(
  { room, userId, displayName, onClassEnded, intendedRole }: {
    room: string; userId?: string | null; displayName?: string | null;
    /** Coach explicitly ended the class — parent should navigate away / show a toast. */
    onClassEnded?: (reason: string) => void;
    /** Role signalled by the URL (?role=coach|student). Passed to class-ws
     *  hello so the server can honour a fresh coach claim when the room has
     *  no live coach socket — without this a reload would land as student
     *  and the "📋 Setup" / cursor-broadcast privileges would silently go away. */
    intendedRole?: "coach" | "student";
  },
) {
  const COACH_TOKEN_KEY = `cg-coachtoken-${room}`;
  const [fen, setFen] = useState<string>(() => new Chess().fen());
  const [lastMove, setLastMove] = useState<BoardMove | null>(null);
  const [dests, setDests] = useState<Map<Key, Key[]>>(() => destsFromChess(new Chess()));
  const [connected, setConnected] = useState(false);
  const [shapes, setShapes] = useState<AnnotShape[]>([]);
  // Annotation tool state (Phase 1 — owner ask 2026-09-02). Persisted
  // per-user via useAnnotationTool → localStorage. Only used when the
  // board is NOT inside a challenge (challenge students have their own
  // scratchpad tools).
  const annotTool = useAnnotationTool();
  // Live remote cursor — coach's cursor as seen by students. Normalized 0..1
  // relative to the board square. Server never echoes to sender, so this is
  // only meaningful on the student side.
  const [remotePointer, setRemotePointer] = useState<{ x: number; y: number } | null>(null);
  // Client role — set from the server's `role` frame after hello resolves.
  // Only the coach sends pointer frames; server drops any student pointer.
  const [role, setRole] = useState<"coach" | "student" | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const gameRef = useRef<Chess>(new Chess());
  const boardWrapRef = useRef<HTMLDivElement | null>(null);
  const lastPointerSentAt = useRef<number>(0);
  const pointerOffTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Challenge mode local state: while a challenge is active, students play
  // on their OWN chess.js instance (independent of the shared room). Coach's
  // board stays frozen at the position. Both see the same countdown.
  //
  // Now a TREE (2026-09-02, owner ask "different branches / different ideas"):
  //   * challengeTreeRef  — top-level array of child nodes from positionFen
  //   * challengeCursorRef — path of child indices from root; empty = start
  //   * playing a move at a non-tip cursor creates a variation
  //   * moves already in the tree from this cursor advance to that child
  //   * challengeMovesRef is kept as a derived flat SAN chain for the
  //     server snapshot + review UI
  const challengeGameRef = useRef<Chess | null>(null);
  const challengeMovesRef = useRef<string[]>([]);
  const challengeTreeRef = useRef<ChallengeTreeNode[]>([]);
  const challengeCursorRef = useRef<number[]>([]);
  const [challengeFen, setChallengeFen] = useState<string | null>(null);
  const [challengeDests, setChallengeDests] = useState<Map<string, string[]>>(new Map());
  // Bump on any tree/cursor change so the render subtree recomputes.
  const [challengeTreeTick, setChallengeTreeTick] = useState(0);
  // Post-challenge "Show my answer" review mode (students only). When
  // reviewIdx is not null, the board renders the fen at moves[0..reviewIdx]
  // instead of the shared board. Prev/next chip steps through, ✕ returns.
  const [reviewIdx, setReviewIdx] = useState<number | null>(null);
  // Auto-hide remote pointer after 2s of silence — catches coach navigating
  // away without a clean "pointer-off" (page close, network drop).
  useEffect(() => {
    if (!remotePointer) return;
    const t = setTimeout(() => setRemotePointer(null), 2000);
    return () => clearTimeout(t);
  }, [remotePointer]);

  // Server is truth: rebuild the local engine from its fen; if chess.js rejects
  // it, fall back to a fresh game so dests stop offering moves for a bad board.
  const applyFen = (nextFen: string, nextLast: BoardMove | null) => {
    try { gameRef.current = new Chess(nextFen); }
    catch { gameRef.current = new Chess(); }
    setLastMove(nextLast);
    setFen(gameRef.current.fen());
    setDests(destsFromChess(gameRef.current));
  };

  useEffect(() => {
    if (!room) return;
    let cancelled = false;
    // Reconnect state — sticks around across ws instances during this effect run.
    // Backoff doubles on each failure, capped at 15s. Reset to 500ms on a
    // successful onopen so a flaky network doesn't stay backed off forever.
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let backoffMs = 500;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    const proto = location.protocol === "https:" ? "wss:" : "ws:";

    // Owner report 2026-09-01: coach's tab going inactive kills the WS
    // (browsers/proxies close idle sockets), and moves-navigate stops
    // working. Root cause: no reconnect, no heartbeat. Fix:
    //   1. connect() is a function we can call repeatedly to (re)build a WS.
    //   2. onclose schedules a reconnect with exponential backoff (500ms →
    //      15s cap). Cancelled cleanly on unmount.
    //   3. On visibilitychange → visible, if the socket isn't OPEN, force
    //      an immediate reconnect. This catches the "left tab, came back
    //      an hour later" case where backoff hasn't fired.
    //   4. Heartbeat every 20s while open — a tiny `ping` message keeps
    //      NAT and reverse proxies from timing out an otherwise-idle
    //      class board. Server is expected to ignore unknown message
    //      types; if it doesn't, the ping just becomes a no-op on read.
    const connect = () => {
      if (cancelled) return;
      // Nuke any stale socket + timers.
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
      if (wsRef.current) { try { wsRef.current.close(); } catch { /* */ } wsRef.current = null; }

      const ws = new WebSocket(`${proto}//${location.host}/v2api/class-ws/${encodeURIComponent(room)}`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) { try { ws.close(); } catch { /* */ } return; }
        setConnected(true);
        backoffMs = 500;   // reset backoff on a good open
        // Heartbeat: 20s < any reasonable NAT/proxy idle timeout.
        heartbeatTimer = setInterval(() => {
          if (wsRef.current !== ws || ws.readyState !== WebSocket.OPEN) return;
          try { ws.send(JSON.stringify({ type: "ping" })); } catch { /* */ }
        }, 20_000);
        try {
          let savedCoachToken: string | undefined;
          try { savedCoachToken = localStorage.getItem(COACH_TOKEN_KEY) || undefined; } catch { /* */ }
          ws.send(JSON.stringify({
            type: "hello",
            userId: userId ?? undefined,
            displayName: displayName ?? undefined,
            coachToken: savedCoachToken,
            intendedRole,
          }));
        } catch { /* */ }
      };

      const scheduleReconnect = () => {
        if (cancelled) return;
        if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
        if (reconnectTimer) return;   // one at a time
        const wait = backoffMs;
        backoffMs = Math.min(15_000, backoffMs * 2);
        reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, wait);
      };

      ws.onerror = () => { if (!cancelled) setConnected(false); };
      ws.onclose = () => {
        if (cancelled) return;
        setConnected(false);
        scheduleReconnect();
      };
      ws.onmessage = (ev) => {
        if (cancelled) return;
        let msg: any;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.type === "pong") return;   // heartbeat reply, no-op
        if (msg.type === "state") {
          applyFen(msg.fen, msg.lastMove ?? null);
          setShapes(Array.isArray(msg.shapes) ? msg.shapes : []);
          _publishStartShapes(Array.isArray(msg.startShapes) ? msg.startShapes : []);
          const hist: SharedMove[] = Array.isArray(msg.history) ? msg.history : [];
          const cursor = Number(msg.cursorIdx ?? hist.length);
          const tree: SharedTreeNode[] = Array.isArray(msg.tree) ? msg.tree : [];
          const cursorPath: number[] = Array.isArray(msg.cursorPath) ? msg.cursorPath : [];
          _publishCursor(cursor, hist.length);
          _publishMoveList(typeof msg.startFen === "string" ? msg.startFen : new Chess().fen(), hist, cursor, tree, cursorPath);
          if (typeof msg.locked === "boolean") _publishLocked(msg.locked);
          if (msg.orientation === "white" || msg.orientation === "black") _publishOrientation(msg.orientation);
        }
        else if (msg.type === "move") {
          applyFen(msg.fen, msg.move);
          const hist: SharedMove[] = Array.isArray(msg.history) ? msg.history : [];
          const cursor = Number(msg.cursorIdx ?? hist.length);
          const tree: SharedTreeNode[] = Array.isArray(msg.tree) ? msg.tree : _moveList.tree;
          const cursorPath: number[] = Array.isArray(msg.cursorPath) ? msg.cursorPath : _moveList.cursorPath;
          _publishCursor(cursor, hist.length);
          _publishMoveList(typeof msg.startFen === "string" ? msg.startFen : _moveList.startFen, hist, cursor, tree, cursorPath);
          if (typeof msg.locked === "boolean") _publishLocked(msg.locked);
        }
        else if (msg.type === "lock") { if (typeof msg.locked === "boolean") _publishLocked(msg.locked); }
        else if (msg.type === "reset") applyFen(msg.fen, null);
        else if (msg.type === "annot") setShapes(Array.isArray(msg.shapes) ? msg.shapes : []);
        else if (msg.type === "role") {
          setRole(msg.role === "coach" ? "coach" : "student");
          try {
            if (msg.role === "coach" && msg.coachToken) localStorage.setItem(COACH_TOKEN_KEY, String(msg.coachToken));
            else if (msg.role === "student") { /* keep any prior token — server will fail-open on mismatch */ }
          } catch { /* */ }
        }
        else if (msg.type === "pointer") setRemotePointer({ x: Number(msg.x) || 0, y: Number(msg.y) || 0 });
        else if (msg.type === "pointer-off") setRemotePointer(null);
        else if (msg.type === "orientation") { if (msg.orientation === "white" || msg.orientation === "black") _publishOrientation(msg.orientation); }
        else if (msg.type === "classEnded") { onClassEnded?.(String(msg.reason || "coach_left")); }
        else if (msg.type === "not-invited") { onClassEnded?.("not-invited"); }
        // ── Challenge mode frames ───────────────────────────────────
        else if (msg.type === "challenge_start") {
          // Initialise local challenge game from the position. Students play
          // on this; coach's local game stays untouched and the frozen board
          // just renders `msg.positionFen` via the challenge-state.
          try {
            challengeGameRef.current = new Chess(msg.positionFen);
            const dests = destsFromChess(challengeGameRef.current);
            setChallengeFen(challengeGameRef.current.fen());
            setChallengeDests(dests);
            challengeMovesRef.current = [];
            challengeTreeRef.current = [];
            challengeCursorRef.current = [];
            setChallengeTreeTick((n) => n + 1);
          } catch {
            challengeGameRef.current = null;
            setChallengeFen(null);
            setChallengeDests(new Map());
            challengeTreeRef.current = [];
            challengeCursorRef.current = [];
          }
          _publishChallenge({
            positionFen: String(msg.positionFen),
            startFen: String(msg.startFen ?? msg.positionFen),
            prompt: String(msg.prompt ?? ""),
            startedAt: Number(msg.startedAt) || Date.now(),
            endsAt: Number(msg.endsAt) || (Date.now() + 60_000),
            answered: 0,
            total: 0,
            active: true,
            answers: null,
            studentMoves: [],
          });
        }
        else if (msg.type === "challenge_progress") {
          if (!_challenge || !_challenge.active) return;
          _publishChallenge({
            ..._challenge,
            answered: Number(msg.answered) || 0,
            total: Number(msg.total) || 0,
          });
        }
        else if (msg.type === "challenge_end") {
          // Server reveals: everyone snaps back to the shared board.
          // Coach also gets the answers array — students get an undefined
          // (they see their own attempt via the "Show my answer" toggle).
          const answers: ChallengeAnswerRow[] | null = Array.isArray(msg.answers) ? msg.answers : null;
          const myMoves = challengeMovesRef.current;
          challengeGameRef.current = null;
          setChallengeFen(null);
          setChallengeDests(new Map());
          if (_challenge) {
            _publishChallenge({
              ..._challenge,
              active: false,
              answers,
              studentMoves: myMoves,
            });
          }
        }
        else if (msg.type === "challenge_marked") {
          // Coach marked this student's answer. Show a floating toast +
          // update the challenge state's correct field so any panel
          // showing it (Show my answer pill) reflects the mark.
          const c: boolean | null =
            msg.correct === true ? true :
            msg.correct === false ? false : null;
          _publishChallengeMarkToast({ correct: c, at: Date.now() });
          // If coach's mark arrives while the Answers-panel-derived state
          // is still around, also patch the student's own row so any
          // subsequent read shows it.
          if (_challenge && Array.isArray(_challenge.answers)) {
            const meId = userId;
            _publishChallenge({
              ..._challenge,
              answers: _challenge.answers.map((a) => a.userId === meId ? { ...a, correct: c } : a),
            });
          }
        }
      };
    };

    // Tab-visibility handler — the classic "returned to a background tab
    // after some minutes and the socket is dead" case. If we're visible
    // and the socket isn't open, force an immediate reconnect (bypass
    // whatever backoff is scheduled).
    const onVisibility = () => {
      if (cancelled) return;
      if (document.visibilityState !== "visible") return;
      const ws = wsRef.current;
      if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        backoffMs = 500;
        connect();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);

    connect();
    return () => {
      cancelled = true;
      setConnected(false);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
      try { wsRef.current?.close(); } catch { /* */ }
      wsRef.current = null;
    };
  }, [room, userId, displayName]);

  // Throttled coach-cursor broadcast (~30Hz) so students see where the coach
  // is gesturing during explanation. Silent no-op for students (server would
  // drop it anyway, but skipping here avoids wasted bandwidth).
  const sendPointer = (nx: number, ny: number) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (role !== "coach") return;
    const now = performance.now();
    if (now - lastPointerSentAt.current < 33) return;
    lastPointerSentAt.current = now;
    try { ws.send(JSON.stringify({ type: "pointer", x: nx, y: ny })); } catch { /* */ }
  };
  const sendPointerOff = () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (role !== "coach") return;
    try { ws.send(JSON.stringify({ type: "pointer-off" })); } catch { /* */ }
  };
  const onBoardPointerMove = (ev: React.PointerEvent<HTMLDivElement>) => {
    if (role !== "coach") return;
    const el = boardWrapRef.current; if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = (ev.clientX - rect.left) / rect.width;
    const y = (ev.clientY - rect.top)  / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    sendPointer(x, y);
    if (pointerOffTimer.current) clearTimeout(pointerOffTimer.current);
    pointerOffTimer.current = setTimeout(sendPointerOff, 400);
  };
  const onBoardPointerLeave = () => {
    if (role !== "coach") return;
    if (pointerOffTimer.current) { clearTimeout(pointerOffTimer.current); pointerOffTimer.current = null; }
    sendPointerOff();
  };

  const sendMove = (from: string, to: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // Challenge student path: apply to LOCAL TREE at cursor. If the move
    // matches an existing child at the cursor position, we advance to it
    // (re-entering a line the student explored earlier). If it's a new
    // move, create a variation. Then compute the SAN chain from root →
    // cursor and send it as a full-snapshot to the server (server replaces
    // the answer's movesSan — "latest chosen line" semantics).
    if (_challenge && _challenge.active && role !== "coach") {
      const startFen = _challenge.positionFen;
      // Reconstruct chess.js from tree + cursor so we know whose turn +
      // whether the move is legal. Cheaper than replaying every solve.
      let g: Chess;
      try { g = new Chess(startFen); } catch { return; }
      const cursor = challengeCursorRef.current;
      let cur = challengeTreeRef.current;
      for (const idx of cursor) {
        const n = cur[idx]; if (!n) break;
        try { g.move({ from: n.from, to: n.to, promotion: (n.promotion as any) || "q" }); } catch { break; }
        cur = n.children;
      }
      const fromFen = g.fen();
      let mv;
      try { mv = g.move({ from, to, promotion: "q" }); } catch { mv = null; }
      if (!mv) return;
      const san = (mv as any).san ?? "";
      const nextFen = g.fen();

      // Insert into the tree at cursor. Match on (from,to,promotion) so
      // "same move as before" advances to that existing child instead of
      // creating a duplicate.
      const promotion = (mv as any).promotion ?? undefined;
      // `cur` above pointed to children at the current cursor when we
      // finished walking. Re-walk to get a mutable slot for insertion so
      // the update is reflected on the root ref.
      const newTree = challengeTreeRef.current.map(cloneChallengeNode);
      let insertParent = newTree;
      for (let i = 0; i < cursor.length; i++) {
        const idx = cursor[i]!;
        if (!insertParent[idx]) break;
        insertParent = insertParent[idx].children;
      }
      let childIdx = insertParent.findIndex((c) => c.from === from && c.to === to && (c.promotion ?? undefined) === (promotion ?? undefined));
      if (childIdx === -1) {
        insertParent.push({ from, to, promotion, san, children: [] });
        childIdx = insertParent.length - 1;
      }
      challengeTreeRef.current = newTree;
      challengeCursorRef.current = [...cursor, childIdx];
      // Derived flat SAN chain — used by the snapshot send + Show-my-answer
      // review UI.
      const derived = fenAtChallengeCursor(startFen, newTree, challengeCursorRef.current);
      challengeMovesRef.current = derived.sanChain;
      setChallengeFen(derived.fen);
      const gAfter = new Chess(derived.fen);
      setChallengeDests(destsFromChess(gAfter));
      setChallengeTreeTick((n) => n + 1);
      if (_challenge) {
        _publishChallenge({ ..._challenge, studentMoves: challengeMovesRef.current });
      }

      // Send a full-snapshot of the current chosen line. Server replaces
      // ans.movesSan so the coach always sees the student's LATEST answer.
      try { ws.send(JSON.stringify({ type: "challenge:snapshot", movesSan: derived.sanChain, finalFen: derived.fen, tree: newTree })); } catch { /* */ }
      // Also send the granular move (server keeps it as a legacy tally for
      // pre-snapshot clients; harmless to keep firing).
      try { ws.send(JSON.stringify({ type: "challenge:move", fromFen, move: { from, to }, san, nextFen })); } catch { /* */ }
      return;
    }
    // Coach in challenge mode: don't send. Board is frozen at position.
    if (_challenge && _challenge.active && role === "coach") return;
    try { ws.send(JSON.stringify({ type: "move", move: { from, to } })); } catch { /* */ }
  };

  // Step-back / step-forward / seek — helpers used by the challenge notation
  // panel. Recompute FEN + dests + snapshot on every navigation.
  const challengeSeek = (path: number[]) => {
    if (!_challenge || !_challenge.active) return;
    const startFen = _challenge.positionFen;
    // Clamp path against the tree (missing indices = stop early).
    const clean: number[] = [];
    let cur = challengeTreeRef.current;
    for (const idx of path) {
      if (idx < 0 || idx >= cur.length) break;
      clean.push(idx);
      cur = cur[idx]!.children;
    }
    challengeCursorRef.current = clean;
    const derived = fenAtChallengeCursor(startFen, challengeTreeRef.current, clean);
    challengeMovesRef.current = derived.sanChain;
    setChallengeFen(derived.fen);
    try { setChallengeDests(destsFromChess(new Chess(derived.fen))); } catch { setChallengeDests(new Map()); }
    setChallengeTreeTick((n) => n + 1);
    if (_challenge) {
      _publishChallenge({ ..._challenge, studentMoves: derived.sanChain });
    }
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: "challenge:snapshot", movesSan: derived.sanChain, finalFen: derived.fen, tree: challengeTreeRef.current })); } catch { /* */ }
    }
  };
  const challengeStepBack    = () => challengeSeek(challengeCursorRef.current.slice(0, -1));
  const challengeStepForward = () => {
    const cursor = challengeCursorRef.current;
    let cur = challengeTreeRef.current;
    for (const idx of cursor) { cur = cur[idx]?.children ?? []; }
    if (cur.length === 0) return;
    challengeSeek([...cursor, 0]);
  };
  const challengeGoStart = () => challengeSeek([]);
  const challengeGoEnd = () => {
    // Walk mainline (first child) all the way to a tip.
    const path: number[] = [];
    let cur = challengeTreeRef.current;
    while (cur.length > 0) { path.push(0); cur = cur[0]!.children; }
    challengeSeek(path);
  };
  // Delete the node at the cursor + its whole subtree. Cursor moves to
  // parent. Broadcasts a fresh snapshot with the pruned tree so the coach
  // sees the abandoned branch disappear. No-op at root (empty cursor).
  const challengeDeleteCurrent = () => {
    if (!_challenge || !_challenge.active) return;
    const cursor = challengeCursorRef.current;
    if (cursor.length === 0) return;    // nothing selected
    const startFen = _challenge.positionFen;
    // Clone the tree along the cursor path so we can mutate safely.
    const newTree = challengeTreeRef.current.map(cloneChallengeNode);
    let parent: ChallengeTreeNode[] = newTree;
    for (let i = 0; i < cursor.length - 1; i++) {
      const idx = cursor[i]!;
      if (!parent[idx]) return;         // bad cursor — bail
      parent = parent[idx]!.children;
    }
    const lastIdx = cursor[cursor.length - 1]!;
    if (lastIdx < 0 || lastIdx >= parent.length) return;
    parent.splice(lastIdx, 1);
    challengeTreeRef.current = newTree;
    // Cursor moves to the parent of the deleted node (root if we deleted a
    // top-level move). Recompute FEN + dests + snapshot from there.
    const parentPath = cursor.slice(0, -1);
    challengeCursorRef.current = parentPath;
    const derived = fenAtChallengeCursor(startFen, newTree, parentPath);
    challengeMovesRef.current = derived.sanChain;
    setChallengeFen(derived.fen);
    try { setChallengeDests(destsFromChess(new Chess(derived.fen))); } catch { setChallengeDests(new Map()); }
    setChallengeTreeTick((n) => n + 1);
    if (_challenge) {
      _publishChallenge({ ..._challenge, studentMoves: derived.sanChain });
    }
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: "challenge:snapshot", movesSan: derived.sanChain, finalFen: derived.fen, tree: newTree })); } catch { /* */ }
    }
  };
  // Coach-only triggers for starting/ending a challenge from ClassV2 footer.
  useEffect(() => {
    _challengeStartFn = ({ positionFen, startFen, prompt, durationSec }) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      try { ws.send(JSON.stringify({ type: "challenge:start", positionFen, startFen, prompt, durationSec })); } catch { /* */ }
    };
    _challengeEndFn = () => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      try { ws.send(JSON.stringify({ type: "challenge:end" })); } catch { /* */ }
    };
    _challengeDismissFn = () => {
      // Client-only: clear the answers panel without server round-trip.
      if (_challenge && !_challenge.active) _publishChallenge(null);
    };
    return () => { _challengeStartFn = null; _challengeEndFn = null; _challengeDismissFn = null; };
  }, [role]);
  const sendReset = () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify({ type: "reset" })); } catch { /* */ }  // server drops non-coach resets
  };
  const sendStepBack = () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify({ type: "stepBack" })); } catch { /* */ }
  };
  const sendStepForward = () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify({ type: "stepForward" })); } catch { /* */ }
  };
  const sendSeek = (arg: number | number[]) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      const body = Array.isArray(arg)
        ? { type: "seek", path: arg.map((n) => Math.max(0, Math.floor(Number(n) || 0))) }
        : { type: "seek", cursorIdx: Math.max(0, Math.floor(arg)) };
      ws.send(JSON.stringify(body));
    } catch { /* */ }
  };
  // Coach-only tree edits — mirror /openings context menu ops.
  const sendTreeOp = (type: "promote-variation" | "make-mainline" | "delete-from") => (path: number[]) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!Array.isArray(path) || path.length === 0) return;
    try {
      const cleanPath = path.map((n) => Math.max(0, Math.floor(Number(n) || 0)));
      ws.send(JSON.stringify({ type, path: cleanPath }));
    } catch { /* */ }
  };
  const sendPromote = sendTreeOp("promote-variation");
  const sendMainline = sendTreeOp("make-mainline");
  const sendDelete = sendTreeOp("delete-from");
  const sendLoadTree: LoadTreeFn = ({ startFen, tree, cursorPath }) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      const body: any = { type: "load-tree", tree };
      if (typeof startFen === "string" && startFen.length > 0) body.startFen = startFen;
      if (Array.isArray(cursorPath) && cursorPath.length > 0) body.cursorPath = cursorPath;
      ws.send(JSON.stringify(body));
    } catch { /* */ }
  };
  const sendAnnotateMove: AnnotateFn = (path, args) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!Array.isArray(path) || path.length === 0) return;
    try {
      const cleanPath = path.map((n) => Math.max(0, Math.floor(Number(n) || 0)));
      const body: any = { type: "annotate-move", path: cleanPath };
      if (args.nag !== undefined) body.nag = args.nag;
      if (args.comment !== undefined) body.comment = args.comment;
      ws.send(JSON.stringify(body));
    } catch { /* */ }
  };

  // Register the module-scoped seek + tree-op fns so the notation panel
  // (rendered up in ClassV2, without direct ws access) can drive them.
  // Clear on unmount so a stale ws reference doesn't linger after leaving.
  useEffect(() => {
    _seekFn = sendSeek;
    _promoteFn = sendPromote;
    _mainlineFn = sendMainline;
    _deleteFn = sendDelete;
    _loadTreeFn = sendLoadTree;
    _annotateFn = sendAnnotateMove;
    return () => {
      if (_seekFn === sendSeek) _seekFn = null;
      if (_promoteFn === sendPromote) _promoteFn = null;
      if (_mainlineFn === sendMainline) _mainlineFn = null;
      if (_deleteFn === sendDelete) _deleteFn = null;
      if (_loadTreeFn === sendLoadTree) _loadTreeFn = null;
      if (_annotateFn === sendAnnotateMove) _annotateFn = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mouse-wheel over the board scrubs the class-ws cursor — same UX as
  // /openings analysis (owner 2026-08-28). Coach only; students' scrolls
  // fall through to normal page scroll. Throttled at 120 ms so a trackpad
  // flick doesn't jump five plies. Native non-passive listener so
  // preventDefault actually blocks page scroll.
  const lastWheelTs = useRef<number>(0);
  useEffect(() => {
    if (role !== "coach") return;
    const wrap = boardWrapRef.current?.querySelector(".cg-board-wrap") as HTMLElement | null;
    if (!wrap) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) < 4) return;
      const now = Date.now();
      if (now - lastWheelTs.current < 120) { e.preventDefault(); return; }
      lastWheelTs.current = now;
      e.preventDefault();
      if (e.deltaY > 0) sendStepForward(); else sendStepBack();
    };
    wrap.addEventListener("wheel", onWheel, { passive: false });
    return () => wrap.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, fen]);   // rebind when the chessground DOM regenerates on fen change
  const sendLock = (nextLocked: boolean) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify({ type: "lock", locked: nextLocked })); } catch { /* */ }
  };
  const sendOrientation = (next: Orientation) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify({ type: "orientation", orientation: next })); } catch { /* */ }
  };
  // Subscribe to the footer's action bus so coach's ← → / Reset / Lock clicks
  // in ClassV2 reach us and go over the ws.
  useEffect(() => {
    const handle = (a: ClassBoardAction) => {
      if (a === "reset") sendReset();
      else if (a === "stepBack") sendStepBack();
      else if (a === "stepForward") sendStepForward();
      else if (a === "toggleLock") sendLock(!_lockedState);
      else if (a === "flipOrientation") sendOrientation(_orientationState === "white" ? "black" : "white");
    };
    _actionSubs.add(handle);
    return () => { _actionSubs.delete(handle); };
  }, []);

  // Who can move a piece: default LOCKED so students never scramble the board.
  // Coach can always move (the server enforces this too by dropping student
  // moves when locked). "both" = any color; "none" = no drag/drop at all.
  // Subscribe to lock state so the board re-renders when the coach toggles —
  // without the hook, changing `_lockedState` at module scope wouldn't wake
  // the student's board up until an unrelated re-render.
  const locked = useClassLocked();
  const orientation = useClassOrientation();
  // Challenge state — subscribe so the board re-renders when it starts/ends.
  const challengeUI = useClassChallenge();
  const inChallenge = !!challengeUI?.active;
  const isCoachRole = role === "coach";
  // Post-challenge review — student is walking through their own answer.
  const inReview = !isCoachRole && reviewIdx !== null && !!challengeUI && challengeUI.studentMoves.length > 0;
  // Compute the review FEN by replaying moves[0..reviewIdx] on a fresh
  // chess.js from challenge.positionFen. Rebuilt on every reviewIdx change.
  const reviewFen: string | null = useMemo(() => {
    if (!inReview || !challengeUI) return null;
    try {
      const c = new Chess(challengeUI.positionFen);
      const upTo = Math.min(reviewIdx! + 1, challengeUI.studentMoves.length);
      for (let i = 0; i < upTo; i++) {
        const san = challengeUI.studentMoves[i];
        try { c.move(san as any); } catch { break; }
      }
      return c.fen();
    } catch { return null; }
  }, [inReview, reviewIdx, challengeUI?.positionFen, challengeUI?.studentMoves]);

  // Board movability:
  // - Coach in normal mode: both. In challenge mode: none (board frozen).
  // - Student in normal mode: locked → none, else both.
  // - Student in challenge mode: always both (they solve on their own board).
  // - Anyone in review mode: none (read-only walkthrough).
  // While a draw tool is active, disable moves — otherwise clicking the
  // source square makes the piece move, and by the second click the
  // source is empty so the coach's arrow lands on random squares (owner
  // report 2026-09-02 "random arrows in random direction and square").
  const isDrawing = annotTool.tool !== "cursor";
  const boardMovable: "both" | "none" =
    isDrawing ? "none" :
    inReview ? "none" :
    inChallenge
      ? (isCoachRole ? "none" : "both")
      : (isCoachRole ? "both" : (locked ? "none" : "both"));
  // What FEN + dests to render:
  // - Review mode: reviewFen (student's own move sequence walkthrough)
  // - Student in challenge: their LOCAL fen + dests.
  // - Everyone else (incl coach in challenge): the shared board state, which
  //   the server keeps frozen at challenge.positionFen during a challenge.
  const displayFen =
    inReview && reviewFen ? reviewFen :
    (inChallenge && !isCoachRole && challengeFen) ? challengeFen :
    fen;
  const displayDests =
    inReview ? new Map<string, string[]>() :
    (inChallenge && !isCoachRole && challengeFen) ? challengeDests :
    dests;
  // Setup modal state now lives in the module (see setClassSetupOpen at top
  // of file) so ClassV2's footer button can open it. Local FEN/error still
  // in state because they're modal-local.
  const setupOpen = useClassSetupOpen();
  const [setupFen, setSetupFen] = useState<string>("");
  const [setupErr, setSetupErr] = useState<string | null>(null);
  // Pre-fill the paste field with the CURRENT FEN whenever the modal opens
  // (convenient starting point for a coach who wants to tweak).
  useEffect(() => {
    if (setupOpen) { setSetupFen(gameRef.current.fen()); setSetupErr(null); }
  }, [setupOpen]);
  // Broadcast a candidate FEN to the room. Silent — no modal close, no state
  // toggles. The debounced live-edit useEffect in PositionEditorModal calls
  // this on every keystroke/click; the ✓ Done and Cancel buttons in the modal
  // handle their own `onClose()` separately. (Previous version closed the
  // modal here, which caused the "opens then instantly closes" bug the
  // moment the debounced first fire hit.)
  const applySetup = (fenStr: string) => {
    const s = (fenStr || "").trim();
    if (!s) { setSetupErr("Paste a FEN string first."); return; }
    try { new Chess(s); } catch { setSetupErr("That's not a valid FEN."); return; }
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) { setSetupErr("Not connected. Retry in a moment."); return; }
    try { ws.send(JSON.stringify({ type: "loadFen", fen: s })); } catch { /* */ }
  };
  // Ref tracking whether an incoming empty-shapes callback came from the
  // AnnotationToolbar's Clear button (user intent) vs chessground's own
  // auto-clear on a left-click. Even with drawable.eraseOnClick:false,
  // chessground still clears every shape when the coach clicks an empty
  // square or an opponent piece (see chessground/dist/drag.js: drawClear
  // fires when !piece || piece.color !== turnColor). Owner report Sep 2
  // 2026: arrows vanish the moment coach clicks anywhere. Guard: swallow
  // the phantom empty-annot unless we know the coach hit Clear.
  const userClearRef = useRef(false);
  const shapesRef = useRef<AnnotShape[]>([]);
  useEffect(() => { shapesRef.current = shapes; }, [shapes]);
  const sendAnnot = (next: AnnotShape[]) => {
    if (next.length === 0 && shapesRef.current.length > 0 && !userClearRef.current) {
      // Reassert our authoritative shapes on chessground on next render by
      // bumping the state to a new array reference — Board's shapes-sync
      // useEffect will re-set them.
      setShapes([...shapesRef.current]);
      return;
    }
    userClearRef.current = false;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify({ type: "annot", shapes: next.slice(0, 64) })); } catch { /* */ }
    setShapes(next);   // local echo — server doesn't relay annot back to the sender
  };

  const lastMoveTuple: [Key, Key] | undefined = lastMove ? [lastMove.from as Key, lastMove.to as Key] : undefined;

  // Board sizes to the LARGEST square that fits the PARENT — using container
  // queries against the parent's containerType:'size' slot (see ClassV2 body).
  // Width = min(parent-width, parent-height); aspect-ratio locks the height.
  // Fixes the previous dvh-based cap that let the board overflow the parent
  // vertically (owner 2026-08-28: "board is cut in top and bottom" — my
  // maxHeight was based on VIEWPORT height, not the actual slot). Now uses
  // cqi/cqb which read the parent's real dimensions directly.
  return (
    <div
      ref={boardWrapRef}
      className="relative mx-auto"
      style={{
        width: 'min(100cqi, 100cqb)',
        aspectRatio: '1',
      } as any}
      onPointerMove={onBoardPointerMove}
      onPointerLeave={onBoardPointerLeave}
    >
      <Board
        fen={displayFen}
        orientation={orientation}
        movableColor={boardMovable}
        dests={boardMovable === "none" ? (new Map() as any) : (displayDests as any)}
        lastMove={inChallenge && !isCoachRole ? null : lastMoveTuple}
        onMove={(f, t) => sendMove(String(f), String(t))}
        coordinates
        shapes={inChallenge && !isCoachRole
          ? [] as any
          // Combine user annotations with the attack overlay (Phase 2).
          // Attack shapes are LOCAL — not broadcast (each user toggles
          // their own view). Rendered last so they draw on top.
          : ([
              ...(shapes as any[]),
              ...(annotTool.attackMode && annotTool.attackShownFrom ? computeAttackShapes(displayFen, annotTool.attackShownFrom) : []),
              ...(annotTool.pinsMode ? computePinShapes(displayFen) : []),
            ] as any)}
        onShapesChange={(s) => sendAnnot(s as any)}
        onSelect={(key) => {
          const sq = String(key);
          // Attack overlay: cursor mode + attack on + click a piece →
          // show its attacks. Clicking the same source clears; clicking
          // a different piece switches; clicking an empty square clears.
          if (annotTool.tool === "cursor" && annotTool.attackMode) {
            try {
              const c = new Chess(displayFen);
              const piece = c.get(sq as any);
              if (!piece) {
                annotTool.setAttackShownFrom(null);
                return;
              }
              annotTool.setAttackShownFrom(annotTool.attackShownFrom === sq ? null : sq);
            } catch { /* */ }
            return;
          }
          // Annotation tools route through this: when a tool is active,
          // build the next shape list + push it through sendAnnot so it
          // broadcasts + persists like a chessground-drawn shape.
          // Coach-only: students don't draw (owner 2026-09-02); guards
          // against a stale localStorage tool value causing accidental
          // student draws now that the toolbar is hidden for them.
          if (!isCoachRole) return;
          if (annotTool.tool === "cursor") return;
          const next = applyAnnotationClick(sq, shapes as any, annotTool);
          if (next) sendAnnot(next as any);
        }}
      />
      {/* Coach's live cursor — students see a soft-glow amber dot at the
       *  normalized position. Coach never sees their own (server doesn't
       *  echo). pointer-events-none so it can't block board interactions. */}
      {remotePointer && role !== "coach" && (
        <div
          className="pointer-events-none absolute z-20"
          style={{
            left: `${remotePointer.x * 100}%`,
            top:  `${remotePointer.y * 100}%`,
            transform: 'translate(-50%, -50%)',
          }}
          aria-hidden
        >
          <div className="h-5 w-5 rounded-full bg-amber-300/80 shadow-[0_0_20px_6px_rgba(252,211,77,0.55)] ring-2 ring-amber-100/90" />
        </div>
      )}
      {setupOpen && role === "coach" && (
        <PositionEditorModal
          initialFen={gameRef.current.fen()}
          onApply={applySetup}
          onClose={() => setClassSetupOpen(false)}
          error={setupErr}
        />
      )}
      <span
        className={`absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full ${connected ? "bg-emerald-400" : "bg-ink-500"}`}
        title={connected ? "Board synced" : "Board offline"}
      />
      {/* Challenge-mode overlay ribbon (student + coach see it during active challenge). */}
      {inChallenge && <ChallengeRibbon isCoach={isCoachRole} />}
      {/* Annotation toolbar — coach-only. Students don't need the draw/
       *  pattern tools (owner 2026-09-02: "students dont need arrow
       *  panel"); they still SEE the coach's arrows/circles/labels via
       *  the class-ws annot frame — the toolbar is only for producing
       *  them. Also gated to non-challenge state so the challenge
       *  scratchpad owns the bottom-center slot during a challenge. */}
      {/* Annotation toolbar removed from Dream Meet per owner 2026-09-02:
       *  coach draws arrows/circles via chessground's native right-click
       *  drag + shift-click. Toolbar just cluttered bottom-center and
       *  overlapped the challenge ribbon. Toolbar still available on
       *  /openings and other Board consumers. */}
      {/* Student scratchpad tree — prev/next controls + click-to-seek
       *  variations shown below the board during an active challenge. */}
      {inChallenge && !isCoachRole && (
        <ChallengeScratchpad
          tick={challengeTreeTick}
          treeRef={challengeTreeRef}
          cursorRef={challengeCursorRef}
          onSeek={challengeSeek}
          onStepBack={challengeStepBack}
          onStepForward={challengeStepForward}
          onGoStart={challengeGoStart}
          onGoEnd={challengeGoEnd}
          onDeleteCurrent={challengeDeleteCurrent}
        />
      )}
      {/* Post-challenge "show my answer" ribbon — student-only, only when
       *  they submitted at least 1 move. Toggles review mode on/off + steps. */}
      {!inChallenge && !isCoachRole && challengeUI && !challengeUI.active && challengeUI.studentMoves.length > 0 && (
        <StudentAnswerReviewRibbon
          moves={challengeUI.studentMoves}
          reviewIdx={reviewIdx}
          onOpen={() => setReviewIdx(challengeUI.studentMoves.length - 1)}
          onPrev={() => setReviewIdx((i) => (i == null ? null : Math.max(-1, i - 1)))}
          onNext={() => setReviewIdx((i) => (i == null ? null : Math.min(challengeUI.studentMoves.length - 1, i + 1)))}
          onClose={() => setReviewIdx(null)}
        />
      )}
    </div>
  );
}

function StudentAnswerReviewRibbon({ moves, reviewIdx, onOpen, onPrev, onNext, onClose }: {
  moves: string[]; reviewIdx: number | null; onOpen: () => void; onPrev: () => void; onNext: () => void; onClose: () => void;
}) {
  const reviewing = reviewIdx !== null;
  if (!reviewing) {
    return (
      <button
        onClick={onOpen}
        className="fixed top-16 left-1/2 z-50 -translate-x-1/2 rounded-full border-2 border-purple-300 bg-purple-600 px-4 py-2 text-sm font-semibold text-white shadow-2xl ring-4 ring-purple-500/30 hover:brightness-110"
      >
        📝 Show my answer ({moves.length} {moves.length === 1 ? "move" : "moves"})
      </button>
    );
  }
  const atStart = reviewIdx <= -1;
  const atEnd = reviewIdx >= moves.length - 1;
  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border-2 border-purple-300 bg-purple-600 px-2 py-2 text-sm font-semibold text-white shadow-2xl ring-4 ring-purple-500/30">
      <button onClick={onPrev} disabled={atStart}
        className="grid h-6 w-6 place-items-center rounded-full hover:bg-white/10 disabled:opacity-30" title="Previous move">◀</button>
      <span className="mx-1 font-mono">
        {atStart ? "start" : `${reviewIdx! + 1}/${moves.length} · ${moves[reviewIdx!]}`}
      </span>
      <button onClick={onNext} disabled={atEnd}
        className="grid h-6 w-6 place-items-center rounded-full hover:bg-white/10 disabled:opacity-30" title="Next move">▶</button>
      <span className="mx-1 opacity-40">|</span>
      <button onClick={onClose}
        className="grid h-6 w-6 place-items-center rounded-full hover:bg-white/10" title="Back to coach's board">✕</button>
    </div>
  );
}

// Student scratchpad — floats below the board during a challenge.
// Compact notation panel with variations shown inline (`1.e4 e5 (1...c5
// 2.Nf3) 2.Nf3 ...`). Prev/next buttons, click any SAN chip to seek.
// Design goal: encourage exploring different ideas without leaving the
// board view. Fixed at bottom so it doesn't fight the challenge ribbon.
function ChallengeScratchpad({ tick, treeRef, cursorRef, onSeek, onStepBack, onStepForward, onGoStart, onGoEnd, onDeleteCurrent }: {
  tick: number;
  treeRef: React.MutableRefObject<ChallengeTreeNode[]>;
  cursorRef: React.MutableRefObject<number[]>;
  onSeek: (path: number[]) => void;
  onStepBack: () => void;
  onStepForward: () => void;
  onGoStart: () => void;
  onGoEnd: () => void;
  onDeleteCurrent: () => void;
}) {
  // Track tick so React re-renders when the tree mutates via refs.
  void tick;
  const tree = treeRef.current;
  const cursor = cursorRef.current;
  const cursorKey = cursor.join(",");
  // Walk the tree and emit a flat list of tokens: mainline plies + inline
  // `(variation)` groups. Each token knows its path so a click seeks there.
  const tokens = useMemo(() => flatten(tree, [], 0, "w"), [tree, tick]);
  // Auto-scroll the current move into view.
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = wrapRef.current?.querySelector<HTMLElement>('[data-current="1"]');
    if (el && wrapRef.current) el.scrollIntoView({ block: "nearest", inline: "center" });
  }, [cursorKey]);

  const hasMoves = tree.length > 0;
  return (
    // Pinned to the BOTTOM of the viewport (below the board, above the
    // class chrome controls) so the notation pill NEVER covers the board.
    // Was `absolute inset-x-2 bottom-2` INSIDE the board wrapper which sat on
    // rank 1 and hid the pieces there (owner report 2026-09-02).
    // Solid `bg-ink-950` (no /95 opacity, no backdrop-blur) because iOS
    // Safari can render backdrop-blur as fully transparent, which left the
    // white notation text unreadable against the light board squares behind.
    <div className="pointer-events-none fixed inset-x-0 bottom-2 z-40 flex justify-center px-2">
      <div className="pointer-events-auto flex w-full max-w-[520px] items-center gap-1 rounded-full border-2 border-purple-400 bg-ink-950 px-1 py-1 shadow-2xl">
        {/* Control buttons */}
        <button onClick={onGoStart} disabled={!hasMoves || cursor.length === 0}
          className="grid h-7 w-7 place-items-center rounded-full text-[11px] text-purple-100 hover:bg-purple-500/25 disabled:opacity-30" title="Go to start">⏮</button>
        <button onClick={onStepBack} disabled={cursor.length === 0}
          className="grid h-7 w-7 place-items-center rounded-full text-[13px] font-bold text-purple-100 hover:bg-purple-500/25 disabled:opacity-30" title="Back one move">◀</button>
        <button onClick={onStepForward}
          className="grid h-7 w-7 place-items-center rounded-full text-[13px] font-bold text-purple-100 hover:bg-purple-500/25" title="Forward one move">▶</button>
        <button onClick={onGoEnd} disabled={!hasMoves}
          className="grid h-7 w-7 place-items-center rounded-full text-[11px] text-purple-100 hover:bg-purple-500/25 disabled:opacity-30" title="Go to end of mainline">⏭</button>
        <button onClick={onDeleteCurrent} disabled={cursor.length === 0}
          className="grid h-7 w-7 place-items-center rounded-full text-[13px] text-rose-200 hover:bg-rose-500/25 disabled:opacity-30" title="Delete this move + everything after it">🗑</button>
        <span className="mx-1 h-4 w-px bg-white/20" />
        {/* Notation strip — horizontally scrollable */}
        <div ref={wrapRef} className="flex flex-1 items-center gap-0.5 overflow-x-auto whitespace-nowrap px-1 py-1 text-[11px]">
          {tokens.length === 0 ? (
            <span className="italic text-white/60">Start playing — variations show here</span>
          ) : tokens.map((t, i) => {
            if (t.kind === "num")   return <span key={i} className="mr-0.5 text-purple-300/70">{t.text}</span>;
            if (t.kind === "openv") return <span key={i} className="text-purple-300/60">(</span>;
            if (t.kind === "closv") return <span key={i} className="text-purple-300/60">)</span>;
            const isCurrent = t.path && arraysEq(t.path, cursor);
            return (
              <button
                key={i}
                onClick={() => t.path && onSeek(t.path)}
                data-current={isCurrent ? 1 : 0}
                className={`rounded px-1.5 py-0.5 font-mono transition ${isCurrent ? "bg-purple-500 text-white ring-1 ring-purple-200" : t.variation ? "text-purple-200/80 hover:bg-purple-500/25" : "text-white hover:bg-purple-500/25"}`}
              >
                {t.text}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
type ScratchToken =
  | { kind: "san"; text: string; path: number[]; variation: boolean }
  | { kind: "num"; text: string; path?: undefined }
  | { kind: "openv"; text: string; path?: undefined }
  | { kind: "closv"; text: string; path?: undefined };
function flatten(nodes: ChallengeTreeNode[], parentPath: number[], plyBase: number, sideAtRoot: "w" | "b", variation = false): ScratchToken[] {
  const out: ScratchToken[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    const path = [...parentPath, i];
    const plyIdx = plyBase + parentPath.length;
    const isWhite = sideAtRoot === "w" ? plyIdx % 2 === 0 : plyIdx % 2 === 1;
    const moveNum = Math.floor(plyIdx / 2) + 1;
    if (i === 0) {
      // Mainline path
      if (isWhite) out.push({ kind: "num", text: `${moveNum}.` });
      else if (parentPath.length === 0 || variation) out.push({ kind: "num", text: `${moveNum}...` });
      out.push({ kind: "san", text: n.san, path, variation });
      if (n.children.length > 0) {
        // Continue mainline into first child in a nested loop-like fashion.
        // Also emit siblings BEFORE recursing to keep the "(variation) mainline"
        // ordering typical of chess notation.
        // Emit sibling variations at this ply first.
        // Actually — Lichess-style is: MAINLINE first, then variations
        // AFTER the ply that spawned them. To keep it compact, we render
        // the mainline chain here and inline `(altSan …)` for each
        // sibling of the current position.
      }
      // Siblings of this move (other choices at parentPath, indices > 0)
      // rendered as `(altSan …)` variations INLINE right after the
      // mainline move. This matches PGN convention.
      if (i === 0 && nodes.length > 1) {
        for (let j = 1; j < nodes.length; j++) {
          const alt = nodes[j]!;
          const altPath = [...parentPath, j];
          out.push({ kind: "openv", text: "(" });
          // A variation at the SAME ply — use same isWhite/moveNum, but
          // always emit the number since we're starting a new sub-line.
          out.push({ kind: "num", text: isWhite ? `${moveNum}.` : `${moveNum}...` });
          out.push({ kind: "san", text: alt.san, path: altPath, variation: true });
          if (alt.children.length > 0) {
            out.push(...flatten(alt.children, altPath, plyBase, sideAtRoot, true));
          }
          out.push({ kind: "closv", text: ")" });
        }
      }
      // Recurse into mainline children
      if (n.children.length > 0) {
        out.push(...flatten(n.children, path, plyBase, sideAtRoot, variation));
      }
      break;   // handled all siblings at this depth in the loop above
    }
  }
  return out;
}
function arraysEq(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Small overlay across the top of the board that shows the prompt + a
// live countdown. Student sees "your board — X remaining"; coach sees
// "board frozen — X remaining · N/M answered". Renders above chessground
// via a container-anchored absolute so it doesn't scroll with the page.
function ChallengeRibbon({ isCoach }: { isCoach: boolean }) {
  const ch = useClassChallenge();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!ch?.active) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [ch?.active]);
  void tick;
  if (!ch?.active) return null;
  const remaining = Math.max(0, Math.ceil((ch.endsAt - Date.now()) / 1000));
  const timeLabel = remaining >= 60 ? `${Math.floor(remaining/60)}m ${(remaining%60).toString().padStart(2,"0")}s` : `${remaining}s`;
  return (
    // Pinned to the TOP of the viewport (below the class shell's header row)
    // instead of the bottom — previously overlapped the board's last rank on
    // phones. top-16 leaves clearance for the class chrome; z-50 keeps it
    // above the scratchpad + video tiles.
    <div className="pointer-events-none fixed top-16 left-1/2 z-50 -translate-x-1/2 max-w-[95vw] truncate rounded-full border-2 border-purple-300 bg-purple-600 px-4 py-2 text-sm font-semibold text-white shadow-2xl ring-4 ring-purple-500/30">
      🧠 {ch.prompt || "Find the good move"}
      <span className="mx-2 opacity-60">·</span>
      ⏱ {timeLabel}
      {isCoach && (
        <>
          <span className="mx-2 opacity-60">·</span>
          {ch.answered}/{ch.total} answered
        </>
      )}
      {!isCoach && ch.studentMoves.length > 0 && (
        <>
          <span className="mx-2 opacity-60">·</span>
          <span className="font-mono">{ch.studentMoves.join(" ")}</span>
        </>
      )}
    </div>
  );
}
