// ChessGuru Live (P0) — LiveKit-backed video meeting for a class.
// Flow: user visits /class-v2/<roomName>?role=coach|student → we fetch a
// signed join token from /api/livekit/token → livekit-client SDK connects →
// LiveKit React components render the grid + tracks + controls.
//
// Requires the API to have LIVEKIT_URL / _API_KEY / _API_SECRET envs. Until
// those are set, the page renders a friendly "not configured yet" splash.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Navigate, useParams, useSearchParams, Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  LiveKitRoom, RoomAudioRenderer, ControlBar,
  GridLayout, ParticipantTile, useTracks, useParticipants,
  useDataChannel, useLocalParticipant, useRoomContext,
} from "@livekit/components-react";
import { Track, DataPacket_Kind } from "livekit-client";
import "@livekit/components-styles";
import { api, announceGoingLive } from "../lib/api";
import SharedClassBoard, { setClassSetupOpen, triggerClassBoardAction, triggerClassFlipOrientation, useClassCursorInfo, useClassLocked, useClassOrientation, triggerClassLockToggle, useClassMoveList, triggerClassSeek, type SharedTreeNode } from "../components/SharedClassBoard";
import { Chess } from "chess.js";
import AudiencePickerModal from "../components/AudiencePickerModal";

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

// Module-scoped chat store — msgs, unread count, and a floating toast for
// new messages while the panel is closed. Owner reported 2026-08-12 that when
// coach sent a chat message, students didn't see anything — before this change
// the msgs state lived inside ClassChatPanel and messages only rendered when
// the panel was open, with no badge or popup to nudge anyone.
type ChatToast = { id: string; who: string; text: string; emoji?: boolean };
let _chatMsgs: ChatMsg[] = [];
let _chatUnread = 0;
let _chatToasts: ChatToast[] = [];
const _chatMsgsSubs = new Set<() => void>();
const _chatUnreadSubs = new Set<() => void>();
const _chatToastSubs = new Set<() => void>();
function _notifyChatMsgs() { _chatMsgsSubs.forEach((f) => f()); }
function _notifyChatUnread() { _chatUnreadSubs.forEach((f) => f()); }
function _notifyChatToasts() { _chatToastSubs.forEach((f) => f()); }
function chatIngest(m: ChatMsg, self: boolean) {
  _chatMsgs = [..._chatMsgs.slice(-99), m];
  _notifyChatMsgs();
  if (self) return;                              // never buzz for your own send
  if (!_chatOpen) {
    _chatUnread += 1;
    _notifyChatUnread();
    const t: ChatToast = { id: Math.random().toString(36).slice(2), who: m.who, text: m.text, emoji: m.emoji };
    _chatToasts = [..._chatToasts.slice(-4), t];
    _notifyChatToasts();
    setTimeout(() => {
      _chatToasts = _chatToasts.filter((x) => x.id !== t.id);
      _notifyChatToasts();
    }, 5000);
  }
}
function chatMarkRead() {
  if (_chatUnread === 0) return;
  _chatUnread = 0;
  _notifyChatUnread();
}
function useChatMsgs(): ChatMsg[] {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((n) => n + 1); _chatMsgsSubs.add(f); return () => { _chatMsgsSubs.delete(f); }; }, []);
  return _chatMsgs;
}
function useChatUnread(): number {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((n) => n + 1); _chatUnreadSubs.add(f); return () => { _chatUnreadSubs.delete(f); }; }, []);
  return _chatUnread;
}
function useChatToasts(): ChatToast[] {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((n) => n + 1); _chatToastSubs.add(f); return () => { _chatToastSubs.delete(f); }; }, []);
  return _chatToasts;
}

// Floating stack of "💬 who: text" popups — appears bottom-center for anyone
// who has the chat panel CLOSED when a new message arrives. Auto-dismiss 5s.
// Clicking a toast opens the chat panel and clears unread.
function ChatToastStack() {
  const toasts = useChatToasts();
  if (toasts.length === 0) return null;
  // Fixed to the VIEWPORT (not absolute-in-board) — owner 2026-08-12:
  // "chat animation shows inside the board, show outside". Positioned above
  // the browser bottom edge, safely clear of the class page's own footer
  // controls, so it never covers pieces on the board mid-lesson.
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[70] flex max-w-[min(90vw,360px)] flex-col items-end gap-2 sm:bottom-6 sm:right-6">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => { setChatOpen(true); chatMarkRead(); }}
          className="pointer-events-auto w-full rounded-xl border border-brand-400/50 bg-ink-900/95 px-4 py-2 text-left text-sm text-white shadow-2xl backdrop-blur transition hover:border-brand-300 hover:bg-ink-800"
        >
          <span className="mr-2">💬</span>
          <span className="font-semibold text-brand-200">{t.who}:</span>{" "}
          {t.emoji ? <span className="text-lg leading-none">{t.text}</span> : <span>{t.text.length > 80 ? t.text.slice(0, 80) + "…" : t.text}</span>}
        </button>
      ))}
    </div>
  );
}

// A tiny sink component that subscribes to cg-chat ALWAYS (mounted on the
// class page whether the chat panel is open or not) so incoming messages
// always land in the module store + trigger toasts + badge. Without this the
// old code only received messages while the panel was rendered.
function ChatSink() {
  const { localParticipant } = useLocalParticipant();
  const me = localParticipant?.identity ?? "me";
  const dc = useDataChannel("cg-chat");
  useEffect(() => {
    if (!dc.message) return;
    try {
      const raw = dc.message.payload instanceof Uint8Array ? RX.decode(dc.message.payload) : String(dc.message.payload);
      const m = JSON.parse(raw) as ChatMsg;
      if (m && m.text) chatIngest(m, m.who === me);
    } catch { /* bad frame */ }
  }, [dc.message, me]);
  return null;
}

function ClassChatPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const me = localParticipant?.identity ?? "me";
  const msgs = useChatMsgs();
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  // When the panel becomes visible, clear unread (student "saw" everything).
  useEffect(() => { if (open) chatMarkRead(); }, [open]);
  useEffect(() => { if (open) scrollRef.current?.scrollTo(0, 9e9); }, [msgs.length, open]);
  const send = (text: string, emoji = false) => {
    const t = text.trim(); if (!t || !room) return;
    const m: ChatMsg = { id: Math.random().toString(36).slice(2), who: me, text: t, ts: Date.now(), emoji };
    chatIngest(m, true);
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
// Coach-only prev/next arrows through the game history + "3 / 12" indicator.
// Non-destructive — walking back and forward keeps every move; playing a new
// move from a rewound position truncates the "future" (like editor undo/redo).
function CoachBoardNav() {
  const { cursorIdx, historyLen } = useClassCursorInfo();
  const canBack = cursorIdx > 0;
  const canFwd  = cursorIdx < historyLen;
  const label = historyLen === 0 ? "start" : `${cursorIdx} / ${historyLen}`;
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-ink-700 bg-ink-900 px-2 py-1 shadow">
      <button
        onClick={() => triggerClassBoardAction("stepBack")}
        disabled={!canBack}
        title="Previous move (←) — non-destructive; step forward again to return"
        className="rounded-md px-2 py-0.5 text-sm text-white transition hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-30"
      >
        ←
      </button>
      <span className="px-1 font-mono text-[11px] tabular-nums text-ink-400">{label}</span>
      <button
        onClick={() => triggerClassBoardAction("stepForward")}
        disabled={!canFwd}
        title="Next move (→)"
        className="rounded-md px-2 py-0.5 text-sm text-white transition hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-30"
      >
        →
      </button>
    </div>
  );
}

// Coach-only board flip. Broadcasts to every student so the whole class sees
// the same POV (owner ask 2026-08-25).
function CoachFlipToggle() {
  const orientation = useClassOrientation();
  const isBlack = orientation === "black";
  return (
    <button
      onClick={triggerClassFlipOrientation}
      title={isBlack ? "Board is showing Black at the bottom — click to flip to White" : "Board is showing White at the bottom — click to flip to Black"}
      className="rounded-full border border-ink-700 bg-ink-900 px-3 py-1.5 text-sm font-semibold text-ink-100 transition hover:bg-ink-800"
    >
      🔄 {isBlack ? "Black view" : "White view"}
    </button>
  );
}

// Coach-only lock toggle. Default LOCKED — students can watch but can't move
// pieces. Coach can unlock for an interactive drill / "your move" moment.
function CoachLockToggle() {
  const locked = useClassLocked();
  return (
    <button
      onClick={triggerClassLockToggle}
      title={locked ? "Students CAN'T move — click to allow" : "Students CAN move — click to lock"}
      className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition ${locked ? "border-rose-500/50 bg-rose-500/20 text-rose-100 hover:bg-rose-500/30" : "border-emerald-500/50 bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30"}`}
    >
      {locked ? "🔒 Locked" : "🔓 Open"}
    </button>
  );
}

function ChatToggleButton() {
  const [open, setOpen] = useChatOpen();
  const unread = useChatUnread();
  return (
    <button onClick={() => { setOpen(!open); if (!open) chatMarkRead(); }}
      title={open ? "Close chat" : unread > 0 ? `${unread} unread message${unread === 1 ? "" : "s"}` : "Open chat"}
      className={`relative rounded-full border px-3 py-1.5 text-lg transition ${open ? "border-brand-400 bg-brand-500/25" : unread > 0 ? "border-rose-400 bg-rose-500/20 animate-pulse" : "border-ink-700 bg-ink-900 hover:bg-ink-800"}`}>
      💬
      {unread > 0 && !open && (
        <span className="absolute -right-1 -top-1 grid h-5 min-w-[20px] place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white shadow ring-2 ring-ink-900">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
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
// LiveKitRoom so useParticipants has room context. Clicking the count opens a
// dropdown showing WHO'S in the room right now — coach's most-requested view
// (owner 2026-08-12: "coach can't see participants details"). Each row shows
// display name + identity + "coach"/"student" tag + join time.
function LiveHeaderBits({ room, role }: { room: string; role: "coach" | "student" }) {
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const me = localParticipant?.identity ?? "";
  const [copied, setCopied] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  // Track who has been kicked from THIS session so the roster shows a
  // "kicked" pill instead of vanishing (LiveKit removes their tile from
  // useParticipants once the token is denied; the roster snapshot is
  // cached in the coach's tab for the coach's own reference).
  const [kickedIds, setKickedIds] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  useEffect(() => {
    if (role !== "coach") return;
    // On mount + when roster opens, pull the persisted kick list so a
    // page reload keeps the "kicked" tag visible.
    if (!rosterOpen) return;
    let alive = true;
    (async () => {
      try {
        const r = await get<{ kicks: Array<{ userId: string }> }>(`/api/class/${encodeURIComponent(room)}/kicks`);
        if (!alive) return;
        setKickedIds(new Set(r.kicks.map((k) => k.userId)));
      } catch { /* ignore */ }
    })();
    return () => { alive = false; };
  }, [rosterOpen, role, room]);
  async function kickParticipant(userId: string, name: string) {
    if (!window.confirm(`Remove ${name || userId} from this class session? They won't be able to rejoin until you undo it.`)) return;
    setBusyId(userId);
    try {
      const r = await post<{ ok: boolean; kicked?: boolean; error?: string }>(`/api/class/${encodeURIComponent(room)}/kick`, { userId });
      if (!r?.ok) throw new Error(r?.error || "kick failed");
      setKickedIds((prev) => new Set([...prev, userId]));
    } catch (e) {
      window.alert(`Couldn't remove ${name}: ${(e as Error).message}`);
    } finally { setBusyId(null); }
  }
  async function unkickParticipant(userId: string) {
    setBusyId(userId);
    try {
      await post(`/api/class/${encodeURIComponent(room)}/unkick`, { userId });
      setKickedIds((prev) => { const n = new Set(prev); n.delete(userId); return n; });
    } catch (e) { window.alert(`Couldn't undo: ${(e as Error).message}`); }
    finally { setBusyId(null); }
  }
  const inviteUrl = `${location.origin}${import.meta.env.BASE_URL}class-v2/${encodeURIComponent(room)}?role=student`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(inviteUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { window.prompt("Copy the student invite link:", inviteUrl); }
  };
  // Sort: self first, then alphabetical by name — deterministic so the list
  // doesn't jitter as LiveKit re-emits the array on speaking-state changes.
  const rows = [...participants].sort((a, b) => {
    if (a.identity === me) return -1;
    if (b.identity === me) return 1;
    return (a.name || a.identity).localeCompare(b.name || b.identity);
  });
  return (
    <>
      <div className="relative">
        <button
          onClick={() => setRosterOpen((v) => !v)}
          title="Show who's in the room"
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition ${rosterOpen ? "bg-brand-500/30 text-brand-100" : "bg-ink-800 text-ink-200 hover:bg-ink-700"}`}>
          👤 {participants.length}
        </button>
        {rosterOpen && (
          <>
            {/* click-away closer */}
            <div className="fixed inset-0 z-40" onClick={() => setRosterOpen(false)} />
            <div className="absolute right-0 top-full z-50 mt-1 w-[240px] overflow-hidden rounded-xl border border-ink-700 bg-ink-900/95 shadow-2xl backdrop-blur">
              <div className="border-b border-ink-800 bg-ink-800/60 px-3 py-2 text-xs font-semibold text-white">
                In the room · {participants.length}
              </div>
              <ul className="max-h-72 overflow-y-auto py-1">
                {rows.length === 0 && <li className="px-3 py-2 text-xs text-ink-500">No one yet.</li>}
                {rows.map((p) => {
                  const isSelf = p.identity === me;
                  const joinedMinAgo = p.joinedAt
                    ? Math.max(0, Math.round((Date.now() - new Date(p.joinedAt).getTime()) / 60_000))
                    : null;
                  const speaking = (p as any).isSpeaking as boolean | undefined;
                  const isKicked = kickedIds.has(p.identity);
                  return (
                    <li key={p.sid || p.identity} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                      <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${speaking ? "bg-emerald-400 animate-pulse" : "bg-ink-600"}`} title={speaking ? "speaking" : "silent"} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold text-white">
                          {p.name || p.identity}
                          {isSelf && <span className="ml-1 text-[10px] font-normal text-brand-300">(you)</span>}
                          {isKicked && <span className="ml-1 rounded bg-rose-500/25 px-1 text-[9px] font-normal text-rose-100">removed</span>}
                        </div>
                        <div className="truncate text-[10px] text-ink-500">
                          {p.identity}
                          {joinedMinAgo != null && <> · {joinedMinAgo === 0 ? "just now" : `${joinedMinAgo}m ago`}</>}
                        </div>
                      </div>
                      {role === "coach" && !isSelf && (
                        isKicked ? (
                          <button
                            onClick={() => unkickParticipant(p.identity)}
                            disabled={busyId === p.identity}
                            className="shrink-0 rounded-md border border-ink-700 px-1.5 py-0.5 text-[10px] font-semibold text-ink-200 hover:bg-ink-800 disabled:opacity-50"
                            title="Allow this student to rejoin this session"
                          >Undo</button>
                        ) : (
                          <button
                            onClick={() => kickParticipant(p.identity, p.name || p.identity)}
                            disabled={busyId === p.identity}
                            className="shrink-0 rounded-md border border-rose-500/40 px-1.5 py-0.5 text-[10px] font-semibold text-rose-200 hover:bg-rose-500/20 disabled:opacity-50"
                            title="Remove from THIS class session only"
                          >Remove</button>
                        )
                      )}
                    </li>
                  );
                })}
                {role === "coach" && [...kickedIds].filter((uid) => !rows.some((p) => p.identity === uid)).map((uid) => (
                  <li key={"k-" + uid} className="flex items-center gap-2 px-3 py-1.5 text-xs opacity-70">
                    <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-rose-500" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-ink-300">
                        {uid}
                        <span className="ml-1 rounded bg-rose-500/25 px-1 text-[9px] text-rose-100">removed</span>
                      </div>
                    </div>
                    <button
                      onClick={() => unkickParticipant(uid)}
                      disabled={busyId === uid}
                      className="shrink-0 rounded-md border border-ink-700 px-1.5 py-0.5 text-[10px] font-semibold text-ink-200 hover:bg-ink-800 disabled:opacity-50"
                    >Undo</button>
                  </li>
                ))}
              </ul>
              <div className="border-t border-ink-800 bg-ink-950/40 px-3 py-2 text-[10px] text-ink-500">
                Green dot = currently speaking · updated live
              </div>
            </div>
          </>
        )}
      </div>
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
  // Session-dismiss per room — user can hide it and keep teaching alone.
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return sessionStorage.getItem("cg-waiting-dismiss-" + room) === "1"; } catch { return false; }
  });
  if (role !== "coach") return null;
  if (participants.length > 1) return null;   // hide once anyone else joins
  if (dismissed) return null;
  const inviteUrl = `${location.origin}${import.meta.env.BASE_URL}class-v2/${encodeURIComponent(room)}?role=student`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(inviteUrl)}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(inviteUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { window.prompt("Copy the student invite link:", inviteUrl); }
  };
  return (
    <div className="absolute right-3 top-3 z-20 w-[280px] rounded-xl border border-amber-400/40 bg-ink-900/95 p-3 shadow-2xl backdrop-blur">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-300">
          ⏳ Waiting for students
        </div>
        <button onClick={() => { try { sessionStorage.setItem("cg-waiting-dismiss-" + room, "1"); } catch { /* */ } setDismissed(true); }}
          className="text-sm text-ink-400 hover:text-white" title="Hide this panel">×</button>
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

// Floating camera PIP the coach/student can drag anywhere on the screen.
// `position: fixed` (viewport-anchored) so it never covers the board pieces
// even when the board fills the whole container (mobile portrait). Owner
// 2026-08-27: "the video opens inside the board, hides the board" — the
// old `absolute in board container` default put the PIP in the top-right
// of rank 8; new default sits in the bottom-right of the viewport just
// above the footer bar. Storage key bumped so any stale drag position
// from the old absolute-in-board era is discarded.
function DraggableCameraPIP({ children }: { children: any }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => {
    try { const v = localStorage.getItem("cg_pip_pos_v2"); return v ? JSON.parse(v) : null; } catch { return null; }
  });
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  useEffect(() => {
    if (!pos) return;
    try { localStorage.setItem("cg_pip_pos_v2", JSON.stringify(pos)); } catch { /* */ }
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

  // z-index 9999 + portal-to-body: chessground stacks squares + pieces inside
  // its own contexts with transforms on the pieces layer; a fixed PIP that
  // lives INSIDE that subtree gets trapped between the squares and pieces
  // layers ("pip moves in between board and pieces"). Portaling to <body>
  // and boosting the stack index puts it on top of everything.
  const style: any = pos
    ? { position: "fixed", left: pos.x, top: pos.y, touchAction: "none", zIndex: 9999 }
    : { position: "fixed", right: 12, bottom: 96, touchAction: "none", zIndex: 9999 };

  const node = (
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

  return typeof document !== "undefined" ? createPortal(node, document.body) : node;
}

// /openings-style two-column mainline notation with inline variation branches.
// Rebuilds SAN client-side from startFen + the class-ws room's tree so
// numbering respects a Setup Position (a coach who loaded a mid-game FEN
// with 15 full-moves + black to move sees "15... Kb8" not "1. Kb8"). Coach
// clicks any ply to seek every client to that path; students see it as a
// read-only ledger. Playing a new move at a rewound cursor now creates a
// variation branch (server-side tree semantics, dd67193 → this commit).
type EnrichedNode = {
  san: string;
  path: number[];
  ply: number;         // 0-indexed from startFen
  moveNo: number;      // full-move counter
  turn: "w" | "b";     // whose move BEFORE this ply
  children: EnrichedNode[];
};
function pathsEqual(a: number[], b: number[]) { return a.length === b.length && a.every((v, i) => v === b[i]); }

// Compute the ply / moveNo / turn for the CURRENT node given the parent
// board state — needed for correct row numbering when the pack begins mid-game.
function ClassNotationPanel({ role }: { role: "coach" | "student" }) {
  const { startFen, tree, cursorPath } = useClassMoveList();
  // Enrich the wire tree with SAN + ply metadata. All branches are rendered,
  // not just the current line — that's the whole point of "moves tree".
  const enriched = useMemo(() => {
    const startTurn: "w" | "b" = (startFen.split(" ")[1] === "b" ? "b" : "w");
    const startNum = Number(startFen.split(" ")[5] || "1");
    const startPly = (startNum - 1) * 2 + (startTurn === "b" ? 1 : 0);
    const walk = (nodes: SharedTreeNode[], parentFen: string, prefix: number[], plyBase: number): EnrichedNode[] => {
      const out: EnrichedNode[] = [];
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]!;
        let san = "??";
        let nextFen = parentFen;
        try {
          const c = new Chess(parentFen);
          const applied = c.move({ from: n.move.from, to: n.move.to, promotion: (n.move.promotion as any) || "q" });
          if (applied) { san = applied.san; nextFen = c.fen(); }
        } catch { /* leave "??" */ }
        const ply = plyBase;
        const moveNo = Math.floor(ply / 2) + 1;
        const turn: "w" | "b" = ply % 2 === 0 ? "w" : "b";
        const childPath = [...prefix, i];
        out.push({
          san, path: childPath, ply, moveNo, turn,
          children: walk(n.children, nextFen, childPath, plyBase + 1),
        });
      }
      return out;
    };
    return { nodes: walk(tree, startFen, [], startPly), startPly, startNum, startTurn };
  }, [startFen, tree]);

  const clickable = role === "coach";
  const activeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [cursorPath]);

  const isActive = (path: number[]) => pathsEqual(path, cursorPath);
  const onPick = (path: number[]) => { if (clickable) triggerClassSeek(path); };

  // Render one INLINE variation line (recursive): `1. e4 e5 (variation) 2. Nf3`.
  // Any node with siblings [1..] gets its own nested block below.
  const renderInline = (n: EnrichedNode, includeNumber: boolean) => {
    const active = isActive(n.path);
    return (
      <span key={n.path.join("-")} className="inline">
        {includeNumber && n.turn === "w" && (
          <span className="ml-1 mr-0.5 text-[11px] text-ink-500">{n.moveNo}.</span>
        )}
        {includeNumber && n.turn === "b" && (
          <span className="ml-1 mr-0.5 text-[11px] text-ink-500">{n.moveNo}…</span>
        )}
        <button
          type="button"
          ref={active ? activeRef : undefined}
          onClick={() => onPick(n.path)}
          disabled={!clickable}
          className={`rounded px-1 py-0.5 font-mono text-sm ${active ? "bg-brand-500/60 text-white" : "text-ink-100 hover:bg-ink-800"} ${clickable ? "cursor-pointer" : "cursor-default"}`}
        >{n.san}</button>
      </span>
    );
  };
  const renderVariationLine = (root: EnrichedNode) => {
    const out: any[] = [];
    let cur: EnrichedNode | undefined = root;
    let first = true;
    while (cur) {
      // Force a number every time turn switches OR this is the first node.
      out.push(renderInline(cur, first || cur.turn === "w"));
      first = false;
      // Any sibling variations on this cur's children need a nested block.
      if (cur.children.length > 1) {
        for (let vi = 1; vi < cur.children.length; vi++) {
          const v = cur.children[vi]!;
          out.push(
            <span key={"nested-" + v.path.join("-")} className="ml-1 inline-block rounded border-l-2 border-ink-700 pl-1 text-[12px] text-ink-300">
              ({renderVariationLine(v)})
            </span>
          );
        }
      }
      cur = cur.children[0];
    }
    return out;
  };

  // Build a Lichess-style two-column table for the MAINLINE (child[0] chain).
  const mainRows = useMemo(() => {
    type Cell = { node: EnrichedNode; vars: EnrichedNode[] } | null;
    type Row = { moveNo: number; white: Cell; black: Cell };
    const rows: Row[] = [];
    let node: EnrichedNode | undefined = enriched.nodes[0];
    let curRow: Row | null = null;
    while (node) {
      const vars = node.children.slice(1);
      if (node.turn === "w") {
        curRow = { moveNo: node.moveNo, white: { node, vars }, black: null };
        rows.push(curRow);
      } else {
        if (!curRow) {
          curRow = { moveNo: node.moveNo, white: null, black: { node, vars } };
          rows.push(curRow);
        } else {
          curRow.black = { node, vars };
        }
      }
      node = node.children[0];
    }
    return rows;
  }, [enriched.nodes]);

  // Rewind-to-start + jump-to-live pills.
  const atStart = cursorPath.length === 0;
  const atLive = useMemo(() => {
    // "Live" = end of current mainline branch. Walk child[0] from cursor
    // and check we can't extend further.
    let cur = tree;
    for (const idx of cursorPath) cur = (cur[idx]?.children) ?? [];
    return cur.length === 0;
  }, [tree, cursorPath]);

  if (enriched.nodes.length === 0) {
    return (
      <div className="shrink-0 border-t border-ink-800 bg-ink-950/60 px-3 py-2 text-[11px] text-ink-500">
        No moves yet — <span className="text-ink-400">notation appears here as the game unfolds.</span>
      </div>
    );
  }

  const cellClass = (active: boolean) =>
    `rounded px-1.5 py-0.5 text-left font-mono text-sm transition ${active ? "bg-brand-500/60 text-white" : "text-ink-100 hover:bg-ink-800"}`;

  return (
    // Fixed max-height so the notation panel NEVER pushes the board
    // smaller as moves accumulate. Owner report 2026-08-27 (mobile/tab):
    // "board size keeps shrinking until in-scroll comes for moves" — cap
    // total panel height to a fixed ~5rem on phones, ~14rem on desktop.
    // Overflow inside the scroll region takes over immediately.
    <div className="flex shrink-0 flex-col overflow-hidden border-t border-ink-800 bg-ink-950/60 max-h-24 md:max-h-60">
      {/* Header controls — Start / Live pills mirror /openings' ⏮ ⏭ nav. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-ink-800/70 px-3 py-1 text-[10px] uppercase tracking-widest text-ink-500">
        <span>Moves</span>
        <span className="text-ink-600">·</span>
        <button
          type="button"
          onClick={() => onPick([])}
          disabled={!clickable}
          className={`rounded px-1.5 py-0.5 ${atStart ? "bg-brand-500/30 text-brand-100" : "text-ink-500 hover:text-ink-200"} ${clickable ? "cursor-pointer" : "cursor-default"}`}
          title={clickable ? "Rewind to the starting position" : "Starting position"}
        >⏮ Start</button>
        <button
          type="button"
          onClick={() => {
            // Walk mainline from cursor to leaf and seek there.
            let path = [...cursorPath];
            let cur = tree;
            for (const idx of path) cur = cur[idx]!.children;
            while (cur.length > 0) { path.push(0); cur = cur[0]!.children; }
            onPick(path);
          }}
          disabled={!clickable || atLive}
          className={`rounded px-1.5 py-0.5 ${atLive ? "bg-emerald-500/30 text-emerald-100" : "text-ink-500 hover:text-ink-200"} ${clickable && !atLive ? "cursor-pointer" : "cursor-default"}`}
          title={clickable ? "Jump to end of this line" : "End of line"}
        >⏭ Live</button>
      </div>
      {/* Scrollable notation grid — flex-1 so it takes whatever height is
       *  left after the header, and scrolls INSIDE the fixed outer cap. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
        {mainRows.map((row, i) => {
          const wActive = row.white ? isActive(row.white.node.path) : false;
          const bActive = row.black ? isActive(row.black.node.path) : false;
          return (
            <div key={i}>
              <div className="grid grid-cols-[2rem_1fr_1fr] items-baseline gap-1">
                <span className="text-right font-mono text-[11px] text-ink-500">{row.moveNo}.</span>
                {row.white ? (
                  <button
                    ref={wActive ? activeRef : undefined}
                    onClick={() => onPick(row.white!.node.path)}
                    disabled={!clickable}
                    className={cellClass(wActive)}
                  >{row.white.node.san}</button>
                ) : <span />}
                {row.black ? (
                  <button
                    ref={bActive ? activeRef : undefined}
                    onClick={() => onPick(row.black!.node.path)}
                    disabled={!clickable}
                    className={cellClass(bActive)}
                  >{row.black.node.san}</button>
                ) : <span />}
              </div>
              {/* Variations from white's move (Black-to-move sidelines). */}
              {row.white?.vars.map((v, vi) => (
                <div key={`wv${vi}`} className="my-1 ml-8 border-l-2 border-ink-700 pl-2 text-[13px] text-ink-300">
                  {renderVariationLine(v)}
                </div>
              ))}
              {/* Variations from black's move (White-to-move sidelines). */}
              {row.black?.vars.map((v, vi) => (
                <div key={`bv${vi}`} className="my-1 ml-8 border-l-2 border-ink-700 pl-2 text-[13px] text-ink-300">
                  {renderVariationLine(v)}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Send-position modal — coach captures the CURRENT class board (startFen +
// history + cursorIdx from useClassMoveList) and POSTs it to
// /api/class/:room/send-position. Blank recipients = server sends to every
// eligible student in the class (batch / individuals / coach's students).
// Phase 2 will layer a per-student picker here.
function SendPositionModal({ room, onClose, onSent }: { room: string; onClose: () => void; onSent: (n: number) => void }) {
  const { startFen, history, cursorIdx } = useClassMoveList();
  const [title, setTitle] = useState<string>("Position from class");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const send = async () => {
    setSending(true); setErr(null);
    try {
      const r = await fetch(`/v2api/api/class/${encodeURIComponent(room)}/send-position`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ title, startFen, history, cursorIdx }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.message || `Send failed (${r.status})`);
      }
      const j = await r.json();
      onSent(Number(j?.sentTo || 0));
    } catch (e: any) {
      setErr(e?.message || String(e));
      setSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
      tabIndex={-1}
    >
      <div className="w-full max-w-md rounded-2xl border border-emerald-500/40 bg-gradient-to-br from-ink-900 to-ink-950 p-5 shadow-2xl">
        <div className="mb-3 flex items-baseline justify-between">
          <div className="font-display text-lg font-bold text-white">📤 Send position</div>
          <button onClick={onClose} className="rounded-md p-1 text-xl leading-none text-ink-400 hover:text-white">×</button>
        </div>
        <div className="mb-4 text-xs text-ink-400">
          Snapshots the current board + move list ({history.length} {history.length === 1 ? "move" : "moves"}) into every eligible student's Notebook under 📚 Online class.
        </div>
        <label className="block text-[10px] font-bold uppercase tracking-widest text-ink-500">Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={140}
          placeholder="e.g. Tactic from today"
          className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-white placeholder:text-ink-500 focus:border-emerald-500 focus:outline-none"
          autoFocus
        />
        {err && <div className="mt-2 text-[12px] text-rose-400">{err}</div>}
        <div className="mt-5 flex items-center gap-2">
          <button
            onClick={send}
            disabled={sending}
            className="flex-1 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-sm font-bold text-white shadow hover:brightness-110 disabled:opacity-60"
          >
            {sending ? "Sending…" : "📤 Send to students"}
          </button>
          <button onClick={onClose} className="rounded-lg border border-ink-700 bg-ink-800 px-4 py-2 text-sm text-ink-200 hover:bg-ink-700">Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default function ClassV2Page() {
  const { room = "" } = useParams();
  const [sp] = useSearchParams();
  const role: "coach"|"student" = sp.get("role") === "coach" ? "coach" : "student";
  const { data: me, isLoading: authLoading } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const navigate = useNavigate();
  const [endedMsg, setEndedMsg] = useState<string | null>(null);
  // Per-user hide-video preference — audio-only mode for anyone who wants it
  // (owner ask: coach + students can each hide their own view of video tiles).
  // Persists per browser so bandwidth-constrained users don't have to re-toggle
  // every time they join.
  const [hideVideo, setHideVideo] = useState<boolean>(() => {
    try { return localStorage.getItem("cg-hide-video") === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("cg-hide-video", hideVideo ? "1" : "0"); } catch {}
  }, [hideVideo]);

  // Coach clicks Leave → tell the server to explicitly END the class:
  //   * wipes the live-now announcement (students don't see a stale link)
  //   * closes the class-ws room + kicks every student socket
  //   * class-ws broadcasts classEnded to every client BEFORE hard-closing
  // Then navigate away. On failure we still leave — server might be down and
  // the coach shouldn't be stuck in the tab.
  const endClass = async () => {
    try { await post(`/api/class/${encodeURIComponent(room)}/end`, {}); } catch { /* ignore */ }
    navigate("/class");
  };

  // Student receives classEnded from the class-ws bus — show a soft banner and
  // auto-redirect after a couple seconds so they know WHY they were kicked
  // (otherwise the sudden nav feels like a bug).
  const onClassEnded = (reason: string) => {
    setEndedMsg(
      reason === "not-invited"
        ? "You aren't on this class's invite list. Ask your coach to add you."
        : "This class was ended by the coach.",
    );
    setTimeout(() => navigate("/dashboard"), reason === "not-invited" ? 4000 : 2500);
  };

  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [tokenData, setTokenData] = useState<LKTokenResp | null>(null);
  // Audience picker — shows on coach entry if no audience has been picked
  // for this class yet (ad-hoc "Start now" rooms + scheduled classes without
  // a batch). Coach can re-open via the footer 🎯 button to change mid-class.
  const [audiencePickerOpen, setAudiencePickerOpen] = useState(false);
  const [audienceToast, setAudienceToast] = useState<string | null>(null);
  const [sendPositionOpen, setSendPositionOpen] = useState(false);
  const [sendPositionToast, setSendPositionToast] = useState<string | null>(null);
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
          // Owner-hardened 2026-08-25 ROUND 2: ALWAYS open the audience
          // picker on coach entry — never fire the push before the coach
          // has explicitly picked who to notify. Owner report: "after
          // clicking Dream Meet itself, notification shows, in background
          // class starts and wait for joining" — the push was firing
          // whenever a preset audience existed, so a coach re-launching
          // an earlier class quietly re-pinged that saved list before
          // seeing any UI. Now: going-live is ALWAYS deferred, picker
          // ALWAYS shows, PATCH /audience is the ONLY thing that pushes.
          // The picker pre-fills with the last saved audience so a coach
          // who wants "same as last time" is one click away (Confirm).
          void announceGoingLive(
            room,
            `${import.meta.env.BASE_URL}class-v2/${room}?role=student`,
            { deferNotify: true },
          );
          if (!cancelled) setAudiencePickerOpen(true);
        }
        const t = await get<LKTokenResp>(`/api/livekit/token?room=${encodeURIComponent(room)}&role=${role}`);
        if (!cancelled) setTokenData(t);
      } catch (err: any) {
        if (!cancelled) setErrMsg(err?.message || String(err));
      }
    })();
    return () => { cancelled = true; };
  }, [me?.loggedIn, room, role, status?.configured]);

  // Auto-clear the "Notified X people" toast after a few seconds.
  useEffect(() => {
    if (!audienceToast) return;
    const t = setTimeout(() => setAudienceToast(null), 3000);
    return () => clearTimeout(t);
  }, [audienceToast]);
  useEffect(() => {
    if (!sendPositionToast) return;
    const t = setTimeout(() => setSendPositionToast(null), 3000);
    return () => clearTimeout(t);
  }, [sendPositionToast]);

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
              <LiveHeaderBits room={room} role={role} />
              {role === "coach" ? (
                <button
                  onClick={endClass}
                  title="End this class for everyone — students will be sent back to their dashboard."
                  className="rounded-lg bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-rose-500"
                >
                  End class
                </button>
              ) : (
                <Link to="/dashboard" className="rounded-lg bg-ink-800 px-2.5 py-1 text-xs font-semibold text-ink-200 hover:bg-ink-700">← Leave</Link>
              )}
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
              <SharedClassBoard room={room} userId={me?.userId} displayName={me?.username} onClassEnded={onClassEnded} intendedRole={role} />
              {endedMsg && (
                <div className="pointer-events-none absolute inset-0 z-40 grid place-items-center bg-ink-950/85 p-6 text-center">
                  <div className="pointer-events-auto space-y-3 rounded-2xl border border-rose-500/50 bg-ink-900 p-6 shadow-2xl">
                    <div className="text-4xl">🏁</div>
                    <div className="font-display text-xl text-white">Class ended</div>
                    <div className="text-sm text-ink-300">{endedMsg}</div>
                    <div className="text-xs text-ink-500">Redirecting to your dashboard…</div>
                  </div>
                </div>
              )}
              {!hideVideo && <CameraPIPMaybe />}
              <CoachWaitingOverlay room={room} role={role} />
              <HandsRoster />
              <ReactionOverlay />
              <ChatPanelHost />
              {/* Always-mounted chat receiver — feeds the module store so the
               *  toggle badge + toast pop even when the panel is closed. */}
              <ChatSink />
              <ChatToastStack />
              {role === "coach" && audiencePickerOpen && (
                <AudiencePickerModal
                  room={room}
                  onClose={() => setAudiencePickerOpen(false)}
                  onDone={(r) => {
                    setAudiencePickerOpen(false);
                    setAudienceToast(
                      r.audienceCount === 0
                        ? "No one matched that pick."
                        : `Invited ${r.audienceCount} • notified ${r.notified}`,
                    );
                  }}
                />
              )}
              {audienceToast && (
                <div className="pointer-events-none absolute left-1/2 top-4 z-[65] -translate-x-1/2 rounded-full border border-brand-500/60 bg-brand-500/25 px-4 py-1.5 text-sm font-semibold text-brand-50 shadow-lg backdrop-blur">
                  🎯 {audienceToast}
                </div>
              )}
              {role === "coach" && sendPositionOpen && (
                <SendPositionModal
                  room={room}
                  onClose={() => setSendPositionOpen(false)}
                  onSent={(n) => {
                    setSendPositionOpen(false);
                    setSendPositionToast(n === 0 ? "No students in class yet." : `📤 Sent to ${n} student${n === 1 ? "" : "s"}' Notebook.`);
                  }}
                />
              )}
              {sendPositionToast && (
                <div className="pointer-events-none absolute left-1/2 top-4 z-[65] -translate-x-1/2 rounded-full border border-emerald-500/60 bg-emerald-500/25 px-4 py-1.5 text-sm font-semibold text-emerald-50 shadow-lg backdrop-blur">
                  {sendPositionToast}
                </div>
              )}
            </div>

            {/* Move-list panel — /openings-style two-column mainline table
             *  with inline variation branches (server tree, dd67193 → this
             *  commit). Coach clicks any chip seek the whole room; students
             *  see it read-only. */}
            <ClassNotationPanel role={role} />

            {/* Controls footer — mic / cam / screen + hand / chat / reactions,
             *  sits UNDER the board so nothing overlaps pieces. */}
            <div className="shrink-0 border-t border-ink-800 bg-ink-900/70 px-4 py-2">
              <div className="flex flex-wrap items-center justify-center gap-3">
                <div className="rounded-xl border border-ink-800 bg-ink-900 shadow">
                  <ControlBar variation="minimal" controls={{ microphone: true, camera: true, screenShare: true, chat: false, leave: false }} />
                </div>
                <button
                  onClick={() => setHideVideo(v => !v)}
                  title={hideVideo ? "Show video tiles" : "Hide video tiles (audio-only view)"}
                  className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${hideVideo ? "border-amber-500/60 bg-amber-500/20 text-amber-100 hover:bg-amber-500/30" : "border-ink-700 bg-ink-900 text-ink-100 hover:bg-ink-800"}`}
                >
                  {hideVideo ? "👁️‍🗨️ Show video" : "🙈 Hide video"}
                </button>
                <HandRaiseButton />
                <ChatToggleButton />
                <ReactionsBar />
                {role === "coach" && <CoachBoardNav />}
                {role === "coach" && <CoachFlipToggle />}
                {role === "coach" && <CoachLockToggle />}
                {role === "coach" && (
                  <button
                    onClick={() => setAudiencePickerOpen(true)}
                    title="Change who can join this class + who gets notified"
                    className="rounded-full border border-ink-700 bg-ink-900 px-3 py-1.5 text-sm font-semibold text-ink-100 hover:bg-ink-800"
                  >
                    🎯 Audience
                  </button>
                )}
                {role === "coach" && (
                  <button
                    onClick={() => setClassSetupOpen(true)}
                    title="Set up any chess position (paste FEN, empty board, or Board Editor)"
                    className="rounded-full border border-brand-500/50 bg-brand-500/20 px-3 py-1.5 text-sm font-semibold text-brand-100 hover:bg-brand-500/30"
                  >
                    📋 Setup
                  </button>
                )}
                {role === "coach" && (
                  <button
                    onClick={() => setSendPositionOpen(true)}
                    title="Send the current board (with move list) to students' Notebook"
                    className="rounded-full border border-emerald-500/50 bg-emerald-500/20 px-3 py-1.5 text-sm font-semibold text-emerald-100 hover:bg-emerald-500/30"
                  >
                    📤 Send position
                  </button>
                )}
                {role === "coach" && (
                  <button
                    onClick={() => { if (confirm("Reset board to the starting position for everyone?")) triggerClassBoardAction("reset"); }}
                    title="Reset board to the starting position (destructive — clears the move list for everyone)"
                    className="rounded-full border border-ink-700 bg-ink-900 px-3 py-1.5 text-sm text-ink-100 hover:bg-ink-800"
                  >
                    ↺ Reset
                  </button>
                )}
              </div>
            </div>
          </div>
          <RoomAudioRenderer />
        </LiveKitRoom>
      </div>
    </div>
  );
}
