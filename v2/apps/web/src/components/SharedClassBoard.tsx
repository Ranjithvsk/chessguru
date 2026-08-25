// Shared chess board for a live class — a self-contained client for the
// existing class-ws bus (wss://…/v2api/class-ws/:room). Dropped into the
// Dream Meet (LiveKit) room so it has the SAME synced board as the /call room:
// the coach drags a piece and every student's board updates; right-click draws
// arrows/circles for everyone. Server is authoritative (echoes fen back).
//
// The hello carries the signed-in user's identity so class attendance is
// logged against the real student (the class-ws server writes classAttendance
// on join) — same collection the academy roster's "✓ attended" reads.
import { useEffect, useRef, useState } from "react";
import { Chess } from "chess.js";
import type { Key } from "chessground/types";
import Board from "./Board";

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

function PositionEditorModal(props: {
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

  const onSquareClick = (sq: Key) => {
    const rc = squareToRowCol(String(sq));
    if (!rc) return;
    const [r, c] = rc;
    setGrid((g) => {
      const ng = g.map((row) => row.slice());
      ng[r][c] = selected === "_" ? "" : selected;
      return ng;
    });
  };
  const clearAll = () => setGrid(fenToGrid("8/8/8/8/8/8/8/8"));
  const resetStart = () => { setGrid(fenToGrid(new Chess().fen())); setTurn("w"); };
  const revert = () => { setGrid(fenToGrid(initialFen)); setTurn(initialFen.split(" ")[1] === "b" ? "b" : "w"); };

  const applyAndClose = () => { onApply(currentFen); onClose(); };
  const cancel = () => { onApply(initialFen); onClose(); };   // revert live edits when cancelling

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

        <div className="grid gap-4 p-4 md:grid-cols-[1fr_360px]">
          {/* Editor board (fills left column, capped) */}
          <div className="mx-auto w-full max-w-[360px]">
            <Board
              fen={currentFen}
              movableColor="none"
              dests={new Map() as any}
              coordinates
              onSelect={onSquareClick}
            />
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
                className="flex-1 rounded-lg bg-brand-500 px-4 py-2 text-sm font-bold text-white hover:bg-brand-400"
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
  const [shapes, setShapes] = useState<Array<{ orig: string; dest?: string; brush?: string }>>([]);
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
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/v2api/class-ws/${encodeURIComponent(room)}`);
    wsRef.current = ws;
    ws.onopen = () => {
      if (cancelled) return;
      setConnected(true);
      try {
        // Reuse a saved coachToken so a reload / brief drop resumes coach role
        // instead of demoting the coach to a student for the rest of the class.
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
    ws.onerror = () => { if (!cancelled) setConnected(false); };
    ws.onclose = () => { if (!cancelled) setConnected(false); };
    ws.onmessage = (ev) => {
      if (cancelled) return;
      let msg: any;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === "state") {
        applyFen(msg.fen, msg.lastMove ?? null);
        setShapes(Array.isArray(msg.shapes) ? msg.shapes : []);
        _publishCursor(Number(msg.cursorIdx ?? (Array.isArray(msg.history) ? msg.history.length : 0)), Array.isArray(msg.history) ? msg.history.length : 0);
        if (typeof msg.locked === "boolean") _publishLocked(msg.locked);
        if (msg.orientation === "white" || msg.orientation === "black") _publishOrientation(msg.orientation);
      }
      else if (msg.type === "move") {
        applyFen(msg.fen, msg.move);
        _publishCursor(Number(msg.cursorIdx ?? (Array.isArray(msg.history) ? msg.history.length : 0)), Array.isArray(msg.history) ? msg.history.length : 0);
        if (typeof msg.locked === "boolean") _publishLocked(msg.locked);
      }
      else if (msg.type === "lock") { if (typeof msg.locked === "boolean") _publishLocked(msg.locked); }
      else if (msg.type === "reset") applyFen(msg.fen, null);
      else if (msg.type === "annot") setShapes(Array.isArray(msg.shapes) ? msg.shapes : []);
      else if (msg.type === "role") {
        setRole(msg.role === "coach" ? "coach" : "student");
        // Persist the coach token so a reconnect resumes the seat instead of
        // demoting to student (which would hide the Setup button + cursor
        // broadcast). Clear on student role in case it's stale.
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
    };
    return () => {
      cancelled = true;
      setConnected(false);
      try { ws.close(); } catch { /* */ }
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
    try { ws.send(JSON.stringify({ type: "move", move: { from, to } })); } catch { /* */ }
  };
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
  const boardMovable: "both" | "none" = role === "coach" ? "both" : (locked ? "none" : "both");
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
  const sendAnnot = (next: Array<{ orig: string; dest?: string; brush?: string }>) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify({ type: "annot", shapes: next.slice(0, 64) })); } catch { /* */ }
    setShapes(next);   // local echo — server doesn't relay annot back to the sender
  };

  const lastMoveTuple: [Key, Key] | undefined = lastMove ? [lastMove.from as Key, lastMove.to as Key] : undefined;

  // Board sizes to the LARGEST square that fits its parent — respects BOTH
  // available width AND height. Container queries pick the smaller of the
  // two so the board grows on portrait AND landscape parents alike. Falls
  // back to `min(100vw, 100vh - chrome)` on browsers without cqi/cqb.
  return (
    <div
      ref={boardWrapRef}
      className="relative mx-auto"
      style={{
        containerType: 'size',
        // width = whichever container dim is smaller
        width: 'min(100cqi, 100cqb)',
        aspectRatio: '1',
      } as any}
      onPointerMove={onBoardPointerMove}
      onPointerLeave={onBoardPointerLeave}
    >
      <Board
        fen={fen}
        orientation={orientation}
        movableColor={boardMovable}
        dests={boardMovable === "none" ? (new Map() as any) : (dests as any)}
        lastMove={lastMoveTuple}
        onMove={(f, t) => sendMove(String(f), String(t))}
        coordinates
        shapes={shapes as any}
        onShapesChange={(s) => sendAnnot(s as any)}
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
    </div>
  );
}
