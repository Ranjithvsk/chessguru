import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext, useParams, useNavigate } from "react-router-dom";
import { Chess } from "chess.js";
import type { Key } from "chessground/types";
import Board, { destsFromChess } from "../components/Board";

// Board-sync WebSocket URL. `VITE_API_BASE` is /v2api in production, "" in dev — either
// way we upgrade against the same origin so the cookie / same-site rules apply.
function classWsUrl(roomId: string): string {
  const base = (import.meta.env.VITE_API_BASE ?? "").toString();
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host;
  return `${proto}//${host}${base}/class-ws/${encodeURIComponent(roomId)}`;
}

type WsMove = { from: string; to: string; promotion?: string };
type WsFrame =
  | { type: "state"; fen: string; lastMove: WsMove | null; history: WsMove[]; participants: number }
  | { type: "move"; move: WsMove; fen: string; participants: number }
  | { type: "reset"; fen: string; participants: number }
  | { type: "participants"; participants: number }
  | { type: "pong" };

// Bridges the class-ws bus into React. Returns the authoritative board state plus
// helpers to publish moves/reset. Reconnects on transient drops with a small backoff
// so a laptop lid-close doesn't kill the session permanently.
function useClassSync(roomId: string | undefined) {
  const [fen, setFen] = useState(new Chess().fen());
  const [lastMove, setLastMove] = useState<WsMove | null>(null);
  const [participants, setParticipants] = useState(1);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;

    const connect = () => {
      const ws = new WebSocket(classWsUrl(roomId));
      wsRef.current = ws;
      ws.onopen = () => { retryRef.current = 0; setConnected(true); };
      ws.onmessage = (ev) => {
        let f: WsFrame; try { f = JSON.parse(ev.data); } catch { return; }
        if (f.type === "state" || f.type === "move" || f.type === "reset") {
          setFen(f.fen);
          if ("lastMove" in f) setLastMove(f.lastMove);
          if (f.type === "move") setLastMove(f.move);
          if (f.type === "reset") setLastMove(null);
          setParticipants(f.participants);
        } else if (f.type === "participants") {
          setParticipants(f.participants);
        }
      };
      const scheduleReconnect = () => {
        if (cancelled) return;
        setConnected(false);
        // Exponential-ish backoff capped at 10s so a flaky link retries fast at first.
        const wait = Math.min(10_000, 500 * 2 ** Math.min(retryRef.current++, 5));
        setTimeout(() => { if (!cancelled) connect(); }, wait);
      };
      ws.onerror = () => { try { ws.close(); } catch { /* */ } };
      ws.onclose = scheduleReconnect;
    };

    connect();
    return () => {
      cancelled = true;
      try { wsRef.current?.close(); } catch { /* */ }
      wsRef.current = null;
    };
  }, [roomId]);

  const sendMove = useCallback((mv: WsMove) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify({ type: "move", move: mv })); } catch { /* */ }
  }, []);
  const sendReset = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify({ type: "reset" })); } catch { /* */ }
  }, []);

  return { fen, lastMove, participants, connected, sendMove, sendReset };
}

// Live-class page — MVP video-conferencing surface (owner 2026-08-08 spec).
//
//  * VIDEO: embeds meet.jit.si via the Jitsi External API. Free public tier, zero
//    infra needed to prove the flow — we'll swap to self-hosted Jitsi (or LiveKit)
//    once we start layering roles/recording/scheduling on top.
//  * BOARD: free-play analysis board (both sides movable) so the coach can walk
//    students through positions on video. NOT synced across participants yet —
//    Phase 2 will wire moves through the existing WebSocket infra.
//  * INVITE: coach shares the URL. First to visit "starts" the class; anyone with
//    the link joins. No auth gate for the MVP.

type Ctx = { userId: string | null };

// Jitsi Meet External API — script + constructor injected globally when loaded.
type JitsiAPI = { dispose: () => void; addListener?: (ev: string, cb: (p: unknown) => void) => void };
type JitsiCtor = new (domain: string, options: Record<string, unknown>) => JitsiAPI;
declare global { interface Window { JitsiMeetExternalAPI?: JitsiCtor } }

const JITSI_HOST = "meet.jit.si";
const JITSI_SCRIPT = `https://${JITSI_HOST}/external_api.js`;

// Load the external_api.js exactly once, memoised across component mounts.
let jitsiLoadPromise: Promise<void> | null = null;
function loadJitsi(): Promise<void> {
  if (window.JitsiMeetExternalAPI) return Promise.resolve();
  if (jitsiLoadPromise) return jitsiLoadPromise;
  jitsiLoadPromise = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = JITSI_SCRIPT; s.async = true;
    s.onload = () => res();
    s.onerror = () => rej(new Error("Jitsi external_api.js failed to load"));
    document.head.appendChild(s);
  });
  return jitsiLoadPromise;
}

// Iframe wrapper — mounts a Jitsi conference into a plain div. Room name is prefixed
// so we don't collide with random meet.jit.si rooms (public tier is a shared namespace).
function JitsiRoom({ roomId, displayName }: { roomId: string; displayName?: string }) {
  const holder = useRef<HTMLDivElement>(null);
  const apiRef = useRef<JitsiAPI | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    loadJitsi().then(() => {
      if (cancelled || !holder.current || !window.JitsiMeetExternalAPI) return;
      apiRef.current = new window.JitsiMeetExternalAPI(JITSI_HOST, {
        roomName: `chessguru-${roomId}`,
        parentNode: holder.current,
        width: "100%", height: "100%",
        userInfo: displayName ? { displayName } : undefined,
        // Trim the toolbar to what a chess class actually needs — no filmstrip,
        // no shortcuts overlay, focus stays on video + chat.
        configOverwrite: { prejoinPageEnabled: false, disableDeepLinking: true },
        interfaceConfigOverwrite: {
          TOOLBAR_BUTTONS: [
            "microphone", "camera", "hangup", "chat", "tileview",
            "raisehand", "fullscreen", "settings",
          ],
          MOBILE_APP_PROMO: false,
          SHOW_JITSI_WATERMARK: false,
          SHOW_BRAND_WATERMARK: false,
        },
      });
      setStatus("ready");
    }).catch(() => { if (!cancelled) setStatus("error"); });
    return () => {
      cancelled = true;
      try { apiRef.current?.dispose(); } catch { /* */ }
      apiRef.current = null;
    };
  }, [roomId, displayName]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl2 border border-ink-700 bg-black">
      <div ref={holder} className="h-full w-full" />
      {status === "loading" && (
        <div className="absolute inset-0 grid place-items-center text-sm text-ink-400">Loading video…</div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-rose-300">
          Couldn't load the video service. Check your connection and refresh.
        </div>
      )}
    </div>
  );
}

// Synced analysis board — moves broadcast to everyone in the room via /class-ws.
// Legal-move validation happens locally (chessground destinations) AND on the server
// (illegal frames dropped silently, sender reconciles from the next state frame).
function SyncedBoard({ sync }: { sync: ReturnType<typeof useClassSync> }) {
  const { fen, lastMove, participants, connected, sendMove, sendReset } = sync;
  // Local chess.js is kept in sync with the authoritative FEN — used solely to compute
  // legal destinations so chessground shows valid drop-targets while dragging.
  const chessRef = useRef<Chess>(new Chess());
  useEffect(() => { try { chessRef.current = new Chess(fen); } catch { /* */ } }, [fen]);
  const dests = useMemo(() => destsFromChess(chessRef.current as any), [fen]);
  const turnColor: "white" | "black" = chessRef.current.turn() === "w" ? "white" : "black";
  const lastMoveArrow: [Key, Key] | undefined = lastMove
    ? [lastMove.from as Key, lastMove.to as Key] : undefined;

  const onMove = (from: Key, to: Key) => {
    // Optimistic local: apply the move immediately, then rely on the server's echo
    // to confirm. If the server rejects (illegal), the follow-up `state` frame will
    // reset us to truth so the user sees the piece snap back.
    try { chessRef.current.move({ from, to, promotion: "q" }); } catch { return; }
    sendMove({ from, to, promotion: "q" });
  };

  return (
    <div className="flex flex-col gap-3">
      <Board fen={fen} orientation="white" turnColor={turnColor} movableColor="both"
        dests={dests} lastMove={lastMoveArrow} onMove={onMove} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs text-ink-400">
          <span className={`inline-block h-2 w-2 rounded-full ${connected ? "bg-emerald-400 shadow-[0_0_6px] shadow-emerald-400" : "bg-rose-400"}`} />
          {connected ? `Live · ${participants} in room` : "Reconnecting…"}
        </span>
        <button onClick={sendReset}
          className="rounded-lg border border-ink-600 bg-ink-800 px-3 py-1.5 text-xs font-semibold text-ink-200 hover:bg-ink-700">
          ↺ Reset board
        </button>
      </div>
    </div>
  );
}

// Compact room-id generator for the "Start a class" button. Six lowercase letters +
// digits is enough entropy for the MVP (~2^31 room-name space per prefix).
function newRoomId(): string {
  return Math.random().toString(36).slice(2, 8);
}

export default function ClassPage() {
  const { userId } = useOutletContext<Ctx>();
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();

  // No id in the URL => landing card with a Start button. Coach clicks Start,
  // we mint a random room id and navigate — the invite URL then works for anyone.
  if (!id) {
    const start = () => nav(`/class/${newRoomId()}`);
    return (
      <div className="mx-auto max-w-lg space-y-4 py-10 text-center">
        <div className="text-4xl">🎥</div>
        <h1 className="font-display text-2xl text-white">Live class</h1>
        <p className="text-sm text-ink-400">
          Start a class and share the invite link. Anyone with the link joins the video
          call and sees the shared analysis board.
        </p>
        <button onClick={start}
          className="rounded-xl2 bg-gradient-to-r from-brand-600 to-accent-500 px-6 py-3 font-semibold text-white shadow-lg hover:from-brand-500 hover:to-accent-400">
          ▶ Start a class
        </button>
        <p className="text-[11px] text-ink-500">
          Powered by Jitsi Meet (open source). MVP — self-hosted infra + recording + roles land in Phase 2.
        </p>
      </div>
    );
  }

  const inviteUrl = typeof window !== "undefined" ? window.location.href : `/class/${id}`;
  const copyInvite = async () => {
    try { await navigator.clipboard.writeText(inviteUrl); alert("Invite link copied"); }
    catch { prompt("Copy the invite link:", inviteUrl); }
  };

  const sync = useClassSync(id);

  return (
    <div className="grid gap-4 lg:h-[calc(100dvh-6.5rem)] lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)]">
      {/* Board column — fixed width on desktop, stacks on mobile. */}
      <section className="min-w-0 lg:overflow-y-auto lg:pr-1">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-ink-500">Live class</div>
            <h1 className="font-display text-lg text-white">Class · <span className="tabular-nums text-brand-300">{id}</span></h1>
          </div>
          <button onClick={copyInvite}
            className="rounded-lg border border-brand-500/50 bg-brand-500/10 px-3 py-1.5 text-xs font-semibold text-brand-100 hover:bg-brand-500/20">
            🔗 Copy invite
          </button>
        </div>
        <SyncedBoard sync={sync} />
      </section>
      {/* Video column — Jitsi iframe fills the rest. */}
      <section className="min-w-0 lg:min-h-0">
        <JitsiRoom roomId={id} displayName={userId || undefined} />
      </section>
    </div>
  );
}
