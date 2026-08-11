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
  { room, userId, displayName }: { room: string; userId?: string | null; displayName?: string | null },
) {
  const [fen, setFen] = useState<string>(() => new Chess().fen());
  const [lastMove, setLastMove] = useState<BoardMove | null>(null);
  const [dests, setDests] = useState<Map<Key, Key[]>>(() => destsFromChess(new Chess()));
  const [connected, setConnected] = useState(false);
  const [shapes, setShapes] = useState<Array<{ orig: string; dest?: string; brush?: string }>>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const gameRef = useRef<Chess>(new Chess());

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
    };
    return () => {
      cancelled = true;
      setConnected(false);
      try { ws.close(); } catch { /* */ }
      wsRef.current = null;
    };
  }, [room, userId, displayName]);

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
  const sendAnnot = (next: Array<{ orig: string; dest?: string; brush?: string }>) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify({ type: "annot", shapes: next.slice(0, 64) })); } catch { /* */ }
    setShapes(next);   // local echo — server doesn't relay annot back to the sender
  };

  const lastMoveTuple: [Key, Key] | undefined = lastMove ? [lastMove.from as Key, lastMove.to as Key] : undefined;

  // Root width matches the board's own cap (min(100% width, viewport-minus-chrome))
  // so the self-sizing square Board fills it exactly and the overlays align to it.
  return (
    <div className="relative mx-auto" style={{ width: "min(100%, calc(100dvh - 10.5rem))" }}>
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
      <button
        onClick={sendReset}
        title="Reset board — coach only"
        className="absolute left-1.5 top-1.5 rounded-md bg-black/55 px-2 py-1 text-xs text-white/90 backdrop-blur hover:bg-black/75"
      >
        ↺
      </button>
      <span
        className={`absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full ${connected ? "bg-emerald-400" : "bg-ink-500"}`}
        title={connected ? "Board synced" : "Board offline"}
      />
    </div>
  );
}
