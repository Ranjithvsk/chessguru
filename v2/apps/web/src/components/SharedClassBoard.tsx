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

export default function SharedClassBoard(
  { room, userId, displayName, onClassEnded }: {
    room: string; userId?: string | null; displayName?: string | null;
    /** Coach explicitly ended the class — parent should navigate away / show a toast. */
    onClassEnded?: (reason: string) => void;
  },
) {
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
        ws.send(JSON.stringify({
          type: "hello",
          userId: userId ?? undefined,
          displayName: displayName ?? undefined,
        }));
      } catch { /* */ }
    };
    ws.onerror = () => { if (!cancelled) setConnected(false); };
    ws.onclose = () => { if (!cancelled) setConnected(false); };
    ws.onmessage = (ev) => {
      if (cancelled) return;
      let msg: any;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === "state") { applyFen(msg.fen, msg.lastMove ?? null); setShapes(Array.isArray(msg.shapes) ? msg.shapes : []); }
      else if (msg.type === "move") applyFen(msg.fen, msg.move);
      else if (msg.type === "reset") applyFen(msg.fen, null);
      else if (msg.type === "annot") setShapes(Array.isArray(msg.shapes) ? msg.shapes : []);
      else if (msg.type === "role") setRole(msg.role === "coach" ? "coach" : "student");
      else if (msg.type === "pointer") setRemotePointer({ x: Number(msg.x) || 0, y: Number(msg.y) || 0 });
      else if (msg.type === "pointer-off") setRemotePointer(null);
      else if (msg.type === "classEnded") { onClassEnded?.(String(msg.reason || "coach_left")); }
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
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupFen, setSetupFen] = useState<string>("");
  const [setupErr, setSetupErr] = useState<string | null>(null);
  // Coach clicks "📋 Setup" → paste a FEN → validate locally with chess.js →
  // send to server which broadcasts a new state to every client. Coach-only
  // (button is only rendered for coach), server is also coach-gated.
  const openSetup = () => {
    setSetupFen(gameRef.current.fen());   // pre-fill with current position for convenience
    setSetupErr(null);
    setSetupOpen(true);
  };
  const applySetup = (fenStr: string) => {
    const s = (fenStr || "").trim();
    if (!s) { setSetupErr("Paste a FEN string first."); return; }
    try { new Chess(s); } catch { setSetupErr("That's not a valid FEN."); return; }
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) { setSetupErr("Not connected. Retry in a moment."); return; }
    try { ws.send(JSON.stringify({ type: "loadFen", fen: s })); } catch { /* */ }
    setSetupOpen(false);
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
        movableColor="both"
        dests={dests as any}
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
      <button
        onClick={sendReset}
        title="Reset board — coach only"
        className="absolute left-1.5 top-1.5 rounded-md bg-black/55 px-2 py-1 text-xs text-white/90 backdrop-blur hover:bg-black/75"
      >
        ↺
      </button>
      {role === "coach" && (
        <button
          onClick={openSetup}
          title="Set up position — paste a FEN or use the Board Editor to scan from a photo"
          className="absolute left-10 top-1.5 rounded-md bg-black/55 px-2 py-1 text-xs text-white/90 backdrop-blur hover:bg-black/75"
        >
          📋 Setup
        </button>
      )}
      {setupOpen && role === "coach" && (
        <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center p-4">
          <div className="pointer-events-auto w-full max-w-md space-y-3 rounded-xl border border-ink-700 bg-ink-900/95 p-4 shadow-2xl backdrop-blur" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div className="font-display text-sm font-bold text-white">Set up position</div>
              <button onClick={() => setSetupOpen(false)} className="text-lg leading-none text-ink-400 hover:text-white">×</button>
            </div>
            <textarea
              value={setupFen}
              onChange={(e) => { setSetupFen(e.target.value); setSetupErr(null); }}
              rows={3}
              spellCheck={false}
              placeholder="Paste a FEN, e.g. r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3"
              className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 font-mono text-[11px] text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none"
            />
            {setupErr && <div className="text-xs text-rose-400">{setupErr}</div>}
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => applySetup(setupFen)}
                className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-400"
              >
                Load on board
              </button>
              <button
                onClick={() => applySetup(new Chess().fen())}
                className="rounded-lg border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 hover:bg-ink-700"
                title="Starting position (same as ↺)"
              >
                Start
              </button>
              <button
                onClick={() => applySetup("8/8/8/8/8/8/8/8 w - - 0 1")}
                className="rounded-lg border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 hover:bg-ink-700"
                title="Empty board — useful for teaching from a diagram"
              >
                Empty
              </button>
              <a
                href="/v2/board-editor"
                target="_blank"
                rel="noopener"
                className="ml-auto rounded-lg border border-brand-500/50 bg-brand-500/10 px-3 py-1.5 text-xs font-semibold text-brand-200 hover:bg-brand-500/20"
                title="Open Board Editor in a new tab — scan from photo or drag pieces; copy the FEN back here"
              >
                📷 Board Editor →
              </a>
            </div>
            <div className="text-[10px] text-ink-500">
              Tip: get FENs from Lichess (📋 in analysis), Chess.com (Share → FEN), or the Board Editor's Copy button.
            </div>
          </div>
        </div>
      )}
      <span
        className={`absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full ${connected ? "bg-emerald-400" : "bg-ink-500"}`}
        title={connected ? "Board synced" : "Board offline"}
      />
    </div>
  );
}
