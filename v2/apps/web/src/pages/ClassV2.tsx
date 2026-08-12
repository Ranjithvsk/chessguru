// ChessGuru Live (P0) — LiveKit-backed video meeting for a class.
// Flow: user visits /class-v2/<roomName>?role=coach|student → we fetch a
// signed join token from /api/livekit/token → livekit-client SDK connects →
// LiveKit React components render the grid + tracks + controls.
//
// Requires the API to have LIVEKIT_URL / _API_KEY / _API_SECRET envs. Until
// those are set, the page renders a friendly "not configured yet" splash.
import { useEffect, useRef, useState } from "react";
import { Navigate, useParams, useSearchParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  LiveKitRoom, RoomAudioRenderer, ControlBar,
  GridLayout, ParticipantTile, useTracks, useParticipants,
  useDataChannel, useLocalParticipant, useRoomContext,
} from "@livekit/components-react";
import { Track, DataPacket_Kind } from "livekit-client";
import "@livekit/components-styles";
import { api, announceGoingLive } from "../lib/api";
import SharedClassBoard from "../components/SharedClassBoard";

const BASE = import.meta.env.VITE_API_BASE ?? "";

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { credentials: "include" });
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
  return r.json() as Promise<T>;
}
async function post<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}),
  });
  if (!r.ok) throw new Error(`POST ${path} → ${r.status}`);
  return r.json() as Promise<T>;
}

interface LKStatus { configured: boolean; url: string | null }
interface LKTokenResp { ok: boolean; token: string; url: string; role: "coach"|"student"; room: string }

// Compact participant grid — camera + screen-share tiles, filling the rail.
// Publishes participant tiles when someone is ACTUALLY publishing video or
// screen. Dropping `withPlaceholder: true` means a camera-less coach machine
// (like the Server desktop) doesn't render an empty placeholder that
// overlaps the shared board.
function VideoRail() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: false },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  if (tracks.length === 0) return null;
  return (
    <GridLayout tracks={tracks} style={{ height: "100%" }}>
      <ParticipantTile />
    </GridLayout>
  );
}

// Wraps the PIP + rail — hides the entire chrome (drag bar too) when there
// are zero real tracks. Otherwise an empty framed pill would still cover
// part of the board on camera-less coach PCs.
function CameraPIPMaybe() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: false },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  if (tracks.length === 0) return null;
  return (
    <DraggableCameraPIP>
      <div className="h-[120px]">
        <VideoRail />
      </div>
    </DraggableCameraPIP>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Part B batch 1 — feature parity with /call/ page:
//   Chat, Raise-hand, Emoji reactions. All ride LiveKit's DataChannel
//   (peer-to-peer via SFU), no extra backend needed.
// ─────────────────────────────────────────────────────────────────────

const RX = new TextDecoder("utf-8");
const TX = new TextEncoder();

// Small tabbed side-panel — floating right of the board. Chat + raise-hand
// live inside; independent of LiveKit's own Chat component so we have full
// control over layout, emoji, and stored history-per-tab.
type ChatMsg = { id: string; who: string; text: string; ts: number; emoji?: boolean };

function ChatBubble({ msg, self }: { msg: ChatMsg; self: boolean }) {
  const time = new Date(msg.ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return (
    <div className={`flex flex-col ${self ? "items-end" : "items-start"}`}>
      <div className="text-[10px] text-ink-500">{self ? "you" : msg.who} · {time}</div>
      <div className={`mt-0.5 max-w-[85%] rounded-xl px-3 py-1.5 text-sm ${
        msg.emoji ? "bg-transparent text-3xl leading-none px-1"
        : self ? "bg-brand-600 text-white"
        : "bg-ink-800 text-ink-100"
      }`}>
        {msg.text}
      </div>
    </div>
  );
}

function ClassChatPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const me = localParticipant?.identity ?? "me";
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const dc = useDataChannel("cg-chat");
  useEffect(() => {
    if (!dc.message) return;
    try {
      const raw = dc.message.payload instanceof Uint8Array ? RX.decode(dc.message.payload) : String(dc.message.payload);
      const m = JSON.parse(raw) as ChatMsg;
      if (m && m.text) setMsgs((s) => [...s.slice(-99), m]);
    } catch { /* bad frame */ }
  }, [dc.message]);
  useEffect(() => { scrollRef.current?.scrollTo(0, 9e9); }, [msgs.length]);
  const send = (text: string, emoji = false) => {
    const t = text.trim(); if (!t || !room) return;
    const m: ChatMsg = { id: Math.random().toString(36).slice(2), who: me, text: t, ts: Date.now(), emoji };
    setMsgs((s) => [...s.slice(-99), m]);
    try { room.localParticipant.publishData(TX.encode(JSON.stringify(m)), { reliable: true, topic: "cg-chat" }); } catch { /* */ }
    setDraft("");
  };
  if (!open) return null;
  return (
    <div className="absolute right-3 top-3 bottom-3 z-30 flex w-[280px] flex-col overflow-hidden rounded-xl border border-ink-700 bg-ink-900/95 shadow-2xl backdrop-blur">
      <div className="flex shrink-0 items-center justify-between border-b border-ink-800 bg-ink-800/60 px-3 py-2">
        <div className="text-sm font-semibold text-white">💬 Class chat</div>
        <button onClick={onClose} className="text-lg text-ink-400 hover:text-white">×</button>
      </div>
      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-3">
        {msgs.length === 0 && <div className="text-center text-xs text-ink-500">No messages yet.</div>}
        {msgs.map((m) => <ChatBubble key={m.id} msg={m} self={m.who === me} />)}
      </div>
      <div className="shrink-0 border-t border-ink-800 bg-ink-950/50 p-2">
        <div className="mb-1.5 flex flex-wrap gap-1">
          {["👍","👏","😊","🤔","🔥","❤️","💯"].map((e) => (
            <button key={e} onClick={() => send(e, true)}
              className="rounded bg-ink-800 px-1.5 py-0.5 text-base leading-none hover:bg-ink-700">{e}</button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <input value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(draft); } }}
            placeholder="Message the class…"
            className="flex-1 rounded-lg border border-ink-700 bg-ink-800 px-2.5 py-1.5 text-sm text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
          <button onClick={() => send(draft)} disabled={!draft.trim()}
            className="shrink-0 rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-400 disabled:opacity-50">↩</button>
        </div>
      </div>
    </div>
  );
}

// Raised-hands roster + floating "🖐 hand up" button. Broadcasts on `cg-hand`.
type HandFrame = { from: string; up: boolean; ts: number };
function useHandRaise() {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const me = localParticipant?.identity ?? "me";
  const [handsUp, setHandsUp] = useState<Set<string>>(new Set());
  const [mineUp, setMineUp] = useState(false);
  const dc = useDataChannel("cg-hand");
  useEffect(() => {
    if (!dc.message) return;
    try {
      const raw = dc.message.payload instanceof Uint8Array ? RX.decode(dc.message.payload) : String(dc.message.payload);
      const f = JSON.parse(raw) as HandFrame;
      setHandsUp((prev) => {
        const next = new Set(prev);
        if (f.up) next.add(f.from); else next.delete(f.from);
        return next;
      });
    } catch { /* */ }
  }, [dc.message]);
  const toggle = () => {
    const next = !mineUp;
    setMineUp(next);
    setHandsUp((prev) => { const n = new Set(prev); if (next) n.add(me); else n.delete(me); return n; });
    if (!room) return;
    try { room.localParticipant.publishData(TX.encode(JSON.stringify({ from: me, up: next, ts: Date.now() } as HandFrame)), { reliable: true, topic: "cg-hand" }); } catch { /* */ }
  };
  return { handsUp, mineUp, toggle };
}

function HandRaiseButton() {
  const { mineUp, toggle } = useHandRaise();
  return (
    <button onClick={toggle}
      title={mineUp ? "Lower hand" : "Raise hand"}
      className={`rounded-full border px-3 py-1.5 text-lg transition ${mineUp ? "border-amber-400 bg-amber-500/25 shadow-lg animate-pulse" : "border-ink-700 bg-ink-900 hover:bg-ink-800"}`}>
      🖐
    </button>
  );
}

function HandsRoster() {
  const { handsUp } = useHandRaise();
  if (handsUp.size === 0) return null;
  return (
    <div className="absolute left-3 top-3 z-20 rounded-lg border border-amber-400/40 bg-amber-500/15 px-3 py-1.5 shadow-lg backdrop-blur">
      <div className="text-[10px] uppercase tracking-wide text-amber-300">🖐 Hands up ({handsUp.size})</div>
      <div className="mt-0.5 flex flex-wrap gap-1 text-xs text-amber-100">
        {[...handsUp].slice(0, 6).map((n) => <span key={n} className="rounded bg-amber-400/20 px-1.5">{n}</span>)}
      </div>
    </div>
  );
}

// Floating emoji reaction: click, it burst-floats up. Broadcast on cg-reactions.
type ReactionFrame = { from: string; emoji: string; ts: number };
function useReactions() {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const me = localParticipant?.identity ?? "me";
  const [floats, setFloats] = useState<Array<{ id: string; emoji: string; left: number }>>([]);
  const dc = useDataChannel("cg-reactions");
  useEffect(() => {
    if (!dc.message) return;
    try {
      const raw = dc.message.payload instanceof Uint8Array ? RX.decode(dc.message.payload) : String(dc.message.payload);
      const f = JSON.parse(raw) as ReactionFrame;
      const id = Math.random().toString(36).slice(2);
      setFloats((s) => [...s, { id, emoji: f.emoji, left: 20 + Math.random() * 60 }]);
      setTimeout(() => setFloats((s) => s.filter((x) => x.id !== id)), 2500);
    } catch { /* */ }
  }, [dc.message]);
  const send = (emoji: string) => {
    const id = Math.random().toString(36).slice(2);
    setFloats((s) => [...s, { id, emoji, left: 20 + Math.random() * 60 }]);
    setTimeout(() => setFloats((s) => s.filter((x) => x.id !== id)), 2500);
    if (!room) return;
    try { room.localParticipant.publishData(TX.encode(JSON.stringify({ from: me, emoji, ts: Date.now() } as ReactionFrame)), { reliable: true, topic: "cg-reactions" }); } catch { /* */ }
  };
  return { floats, send };
}

function ReactionOverlay() {
  const { floats } = useReactions();
  return (
    <>
      <style>{`@keyframes cg-floatup { 0% { transform: translateY(0); opacity: 0; } 15% { opacity: 1; } 100% { transform: translateY(-260px) scale(1.3); opacity: 0; } }`}</style>
      <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
        {floats.map((f) => (
          <span key={f.id}
            style={{ position: "absolute", left: `${f.left}%`, bottom: "12%", fontSize: 40, animation: "cg-floatup 2.5s ease-out forwards" }}>
            {f.emoji}
          </span>
        ))}
      </div>
    </>
  );
}

// Toggle state for the chat panel is shared between the footer button and
// the panel itself via a tiny module-scoped store so we don't have to
// prop-drill through the whole LiveKitRoom subtree.
let _chatOpen = false;
const _chatSubs = new Set<(open: boolean) => void>();
const setChatOpen = (v: boolean) => { _chatOpen = v; _chatSubs.forEach((f) => f(v)); };
function useChatOpen(): [boolean, (v: boolean) => void] {
  const [open, setOpenLocal] = useState(_chatOpen);
  useEffect(() => { _chatSubs.add(setOpenLocal); return () => { _chatSubs.delete(setOpenLocal); }; }, []);
  return [open, setChatOpen];
}
function ChatPanelHost() {
  const [open, setOpen] = useChatOpen();
  return <ClassChatPanel open={open} onClose={() => setOpen(false)} />;
}
function ChatToggleButton() {
  const [open, setOpen] = useChatOpen();
  return (
    <button onClick={() => setOpen(!open)}
      title={open ? "Close chat" : "Open chat"}
      className={`rounded-full border px-3 py-1.5 text-lg transition ${open ? "border-brand-400 bg-brand-500/25" : "border-ink-700 bg-ink-900 hover:bg-ink-800"}`}>
      💬
    </button>
  );
}

function ReactionsBar() {
  const { send } = useReactions();
  return (
    <div className="flex items-center gap-1 rounded-full border border-ink-700 bg-ink-900/80 px-2 py-1 backdrop-blur">
      {["👏","🎉","❤️","🔥","💯","😂","🤯"].map((e) => (
        <button key={e} onClick={() => send(e)}
          className="rounded-full px-1.5 text-lg hover:bg-ink-800">{e}</button>
      ))}
    </div>
  );
}

// Live participant count + one-tap "copy student invite" — lives inside the
// LiveKitRoom so useParticipants has room context.
function LiveHeaderBits({ room }: { room: string }) {
  const participants = useParticipants();
  const [copied, setCopied] = useState(false);
  const inviteUrl = `${location.origin}${import.meta.env.BASE_URL}class-v2/${encodeURIComponent(room)}?role=student`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(inviteUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { window.prompt("Copy the student invite link:", inviteUrl); }
  };
  return (
    <>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-800 px-2.5 py-1 text-xs text-ink-200" title="In the room now">
        👤 {participants.length}
      </span>
      <button onClick={copy}
        className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-800 px-2.5 py-1 text-xs font-semibold text-ink-100 hover:bg-ink-700">
        {copied ? "✓ Copied" : "🔗 Invite"}
      </button>
    </>
  );
}

// Coach-only overlay while alone in the room — big invite link, one-tap
// copy, and mini QR so a student sitting next to the coach can join
// without a laptop. Auto-hides the moment anyone else joins so it never
// covers the board mid-class.
function CoachWaitingOverlay({ room, role }: { room: string; role: "coach" | "student" }) {
  const participants = useParticipants();
  const [copied, setCopied] = useState(false);
  if (role !== "coach") return null;
  if (participants.length > 1) return null;   // hide once anyone else joins
  const inviteUrl = `${location.origin}${import.meta.env.BASE_URL}class-v2/${encodeURIComponent(room)}?role=student`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(inviteUrl)}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(inviteUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { window.prompt("Copy the student invite link:", inviteUrl); }
  };
  return (
    <div className="absolute right-3 top-3 z-20 w-[280px] rounded-xl border border-amber-400/40 bg-ink-900/95 p-3 shadow-2xl backdrop-blur">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-300">
        ⏳ Waiting for students
      </div>
      <div className="mb-2 text-[11px] text-ink-300">
        Send this exact link to every student — otherwise they'll land in a different room and moves won't sync.
      </div>
      <div className="mb-2 flex items-center gap-2">
        <input readOnly value={inviteUrl}
          className="w-full truncate rounded-md border border-ink-700 bg-ink-950 px-2 py-1 text-[10px] text-ink-200"
          onClick={(e) => (e.target as HTMLInputElement).select()} />
        <button onClick={copy}
          className="shrink-0 rounded-md bg-amber-500 px-2 py-1 text-[11px] font-bold text-ink-900 hover:bg-amber-400">
          {copied ? "✓" : "Copy"}
        </button>
      </div>
      <div className="flex items-center gap-2 rounded-md bg-white p-2">
        <img src={qrUrl} alt="Scan to join" className="h-[100px] w-[100px]" />
        <div className="text-[10px] leading-tight text-ink-900">
          <div className="font-bold">Scan to join</div>
          <div className="opacity-70">Room {room.slice(-6)}</div>
        </div>
      </div>
    </div>
  );
}

// Floating camera PIP the coach/student can drag anywhere over the board.
// Clamps inside its positioned parent (the stage) and remembers its spot.
function DraggableCameraPIP({ children }: { children: any }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => {
    try { const v = localStorage.getItem("cg_pip_pos"); return v ? JSON.parse(v) : null; } catch { return null; }
  });
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  useEffect(() => {
    if (!pos) return;
    try { localStorage.setItem("cg_pip_pos", JSON.stringify(pos)); } catch { /* */ }
  }, [pos]);

  const down = (e: any) => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    try { el.setPointerCapture(e.pointerId); } catch { /* */ }
  };
  const move = (e: any) => {
    const el = ref.current; if (!el || !drag.current) return;
    const parent = el.offsetParent as HTMLElement | null;
    const pr = parent ? parent.getBoundingClientRect()
      : ({ left: 0, top: 0, width: window.innerWidth, height: window.innerHeight } as any);
    let x = e.clientX - pr.left - drag.current.dx;
    let y = e.clientY - pr.top - drag.current.dy;
    x = Math.max(0, Math.min(x, pr.width - el.offsetWidth));
    y = Math.max(0, Math.min(y, pr.height - el.offsetHeight));
    setPos({ x, y });
  };
  const up = (e: any) => {
    drag.current = null;
    const el = ref.current;
    try { el?.releasePointerCapture(e.pointerId); } catch { /* */ }
  };

  const style: any = pos
    ? { position: "absolute", left: pos.x, top: pos.y, touchAction: "none" }
    : { position: "absolute", right: 12, top: 12, touchAction: "none" };

  return (
    <div
      ref={ref}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      style={style}
      className="w-[190px] select-none overflow-hidden rounded-xl border border-ink-700 bg-black/70 shadow-xl"
    >
      <div className="flex cursor-grab items-center gap-1 bg-ink-900/80 px-2 py-1 text-[10px] text-ink-400 active:cursor-grabbing">
        <span className="tracking-widest">⠿</span> drag
      </div>
      {children}
    </div>
  );
}

export default function ClassV2Page() {
  const { room = "" } = useParams();
  const [sp] = useSearchParams();
  const role: "coach"|"student" = sp.get("role") === "coach" ? "coach" : "student";
  const { data: me, isLoading: authLoading } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });

  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [tokenData, setTokenData] = useState<LKTokenResp | null>(null);
  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ["livekit-status"],
    queryFn: () => get<LKStatus>("/api/livekit/status"),
    enabled: !!me?.loggedIn,
  });

  useEffect(() => {
    if (!me?.loggedIn || !room || !status?.configured) return;
    let cancelled = false;
    (async () => {
      try {
        // Coach creates/ensures the room server-side (metadata + max-participants);
        // students just call token — LiveKit lazy-creates on first coach join if the
        // ensure was skipped for any reason.
        if (role === "coach") {
          await post("/api/livekit/room", { roomName: room, title: `Class ${room}` });
          // Coach is live → push the academy's OFFLINE students, deep-linking to
          // THIS Dream Meet room (server is session-authed + coach-gated + idempotent).
          void announceGoingLive(room, `${import.meta.env.BASE_URL}class-v2/${room}?role=student`);
        }
        const t = await get<LKTokenResp>(`/api/livekit/token?room=${encodeURIComponent(room)}&role=${role}`);
        if (!cancelled) setTokenData(t);
      } catch (err: any) {
        if (!cancelled) setErrMsg(err?.message || String(err));
      }
    })();
    return () => { cancelled = true; };
  }, [me?.loggedIn, room, role, status?.configured]);

  if (authLoading || statusLoading) return <div className="py-16 text-center text-ink-400">Loading…</div>;
  if (!me?.loggedIn) return <Navigate to={`/login?back=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (!room) {
    return (
      <div className="mx-auto max-w-md rounded-xl2 border border-ink-700 bg-ink-900 p-6 text-center">
        <p className="text-sm text-ink-400">No class ID.</p>
        <Link to="/class" className="mt-3 inline-block text-brand-400 hover:underline">← Classes</Link>
      </div>
    );
  }

  if (!status?.configured) {
    return (
      <div className="mx-auto max-w-lg space-y-4 rounded-xl2 border border-amber-500/40 bg-amber-500/10 p-6 text-amber-100">
        <div className="text-2xl">⚙️</div>
        <h1 className="font-display text-xl text-white">Dream Meet isn't turned on yet</h1>
        <p className="text-sm">
          The video server hasn't been configured on this deployment. Ask your
          admin to enable Dream Meet — students can still use the ♟ Board call
          room in the meantime.
        </p>
      </div>
    );
  }

  if (errMsg) {
    return (
      <div className="mx-auto max-w-md rounded-xl2 border border-rose-500/40 bg-rose-500/10 p-6 text-rose-200">
        <p className="text-sm">Could not join room <b className="text-white">{room}</b>.</p>
        <p className="mt-1 font-mono text-xs">{errMsg}</p>
      </div>
    );
  }

  if (!tokenData) return <div className="py-16 text-center text-ink-400">Joining {room}…</div>;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex h-[90vh] min-h-[560px] flex-col overflow-hidden rounded-2xl border border-ink-700 bg-ink-900/60 shadow-xl" data-lk-theme="default">
        <LiveKitRoom
          serverUrl={tokenData.url}
          token={tokenData.token}
          connect
          /* video + audio are opt-in — devices without a camera/mic (like a
           * headless coach machine or many desktop PCs) hit getUserMedia
           * errors that LiveKit surfaces as ConnectionError(InternalError,
           * reason=2, code=1). Users publish video/audio via the ControlBar
           * button after joining. This is what LiveKit's own examples do. */
          options={{ logLevel: 'debug' }}
          onError={(e) => {
            // Verbose error trail so we can catch the ACTUAL cause below
            // "Could not join room" — LiveKit's onError fires for many
            // things (connect timeout, media perms, WS drop). Include
            // name + full stack + any nested cause so the debug screen
            // isn't just "Client initiated disconnect".
            const parts = [];
            if (e?.name) parts.push(`${e.name}`);
            if (e?.message) parts.push(e.message);
            const anyE = e as any;
            if (anyE?.reason) parts.push(`reason=${anyE.reason}`);
            if (anyE?.code) parts.push(`code=${anyE.code}`);
            if (anyE?.cause?.message) parts.push(`cause=${anyE.cause.message}`);
            // eslint-disable-next-line no-console
            console.error("[ClassV2] LiveKit error", e, "extras=", { ...anyE });
            setErrMsg(parts.join(" · ") || "Unknown error");
          }}
          onDisconnected={(reason) => {
            // eslint-disable-next-line no-console
            console.warn("[ClassV2] LiveKit disconnected. reason=", reason);
          }}
          onConnected={() => {
            // eslint-disable-next-line no-console
            console.log("[ClassV2] LiveKit connected OK");
          }}
          className="flex h-full min-h-0 flex-col"
        >
          {/* Top bar — shrink-0 so it always owns its full height and never
           *  gets squeezed by the board flex-1 below (was overlapping the
           *  top rank of the board). */}
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-ink-800 bg-ink-900/80 px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-rose-300">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-500" /> Live
              </span>
              <span className="truncate font-display text-sm text-white">Dream Meet</span>
              <span className="hidden truncate text-xs text-ink-500 sm:inline">· you're {role}</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <LiveHeaderBits room={room} />
              <Link to="/class" className="rounded-lg bg-ink-800 px-2.5 py-1 text-xs font-semibold text-ink-200 hover:bg-ink-700">← Leave</Link>
            </div>
          </div>

          {/* Body: board on top, controls stacked BELOW it (not overlapping).
           *  Camera PIP still floats over the board — it self-hides when
           *  nobody is publishing (CameraPIPMaybe). */}
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-ink-950/40">
            {/* Board area — self-sizes to the largest square that fits.
             *  overflow-hidden clips any board that tries to grow past the
             *  container. container-type:size gives SharedClassBoard's
             *  cqi/cqb-based sizing an actual box to measure against. */}
            <div
              className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-2"
              style={{ containerType: 'size' } as any}
            >
              <SharedClassBoard room={room} userId={me?.userId} displayName={me?.username} />
              <CameraPIPMaybe />
              <CoachWaitingOverlay room={room} role={role} />
              <HandsRoster />
              <ReactionOverlay />
              <ChatPanelHost />
            </div>

            {/* Controls footer — mic / cam / screen + hand / chat / reactions,
             *  sits UNDER the board so nothing overlaps pieces. */}
            <div className="shrink-0 border-t border-ink-800 bg-ink-900/70 px-4 py-2">
              <div className="flex flex-wrap items-center justify-center gap-3">
                <div className="rounded-xl border border-ink-800 bg-ink-900 shadow">
                  <ControlBar variation="minimal" controls={{ microphone: true, camera: true, screenShare: true, chat: false, leave: false }} />
                </div>
                <HandRaiseButton />
                <ChatToggleButton />
                <ReactionsBar />
              </div>
            </div>
          </div>
          <RoomAudioRenderer />
        </LiveKitRoom>
      </div>
    </div>
  );
}
