import { useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext, useParams, useNavigate } from "react-router-dom";
import { Chess } from "chess.js";
import type { Key } from "chessground/types";
import Board, { destsFromChess } from "../components/Board";

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

// Free-play analysis board — both colors movable, undo/reset available. This is what
// the coach demonstrates on. Later phases sync moves + arrows across participants.
function AnalysisBoard() {
  const chessRef = useRef<Chess>(new Chess());
  const [fen, setFen] = useState<string>(() => chessRef.current.fen());
  const [lastMove, setLastMove] = useState<[Key, Key] | undefined>(undefined);
  const dests = useMemo(() => destsFromChess(chessRef.current as any), [fen]);
  const turnColor: "white" | "black" = chessRef.current.turn() === "w" ? "white" : "black";

  const onMove = (from: Key, to: Key) => {
    try { chessRef.current.move({ from, to, promotion: "q" }); } catch { return; }
    setLastMove([from, to]);
    setFen(chessRef.current.fen());
  };
  const undo = () => {
    chessRef.current.undo();
    const h = chessRef.current.history({ verbose: true });
    const l = h[h.length - 1] as { from: string; to: string } | undefined;
    setLastMove(l ? [l.from as Key, l.to as Key] : undefined);
    setFen(chessRef.current.fen());
  };
  const reset = () => {
    chessRef.current = new Chess();
    setLastMove(undefined);
    setFen(chessRef.current.fen());
  };

  return (
    <div className="flex flex-col gap-3">
      <Board fen={fen} orientation="white" turnColor={turnColor} movableColor="both"
        dests={dests} lastMove={lastMove} onMove={onMove} />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-ink-500">Analysis board — moves are local. Sync coming soon.</span>
        <div className="flex gap-2">
          <button onClick={undo}
            className="rounded-lg border border-ink-600 bg-ink-800 px-3 py-1.5 text-xs font-semibold text-ink-200 hover:bg-ink-700">↶ Undo</button>
          <button onClick={reset}
            className="rounded-lg border border-ink-600 bg-ink-800 px-3 py-1.5 text-xs font-semibold text-ink-200 hover:bg-ink-700">Reset</button>
        </div>
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
        <AnalysisBoard />
      </section>
      {/* Video column — Jitsi iframe fills the rest. */}
      <section className="min-w-0 lg:min-h-0">
        <JitsiRoom roomId={id} displayName={userId || undefined} />
      </section>
    </div>
  );
}
