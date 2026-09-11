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
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  LiveKitRoom, RoomAudioRenderer, ControlBar,
  GridLayout, ParticipantTile, useTracks, useParticipants,
  useDataChannel, useLocalParticipant, useRoomContext, useIsSpeaking,
} from "@livekit/components-react";
import { Track, DataPacket_Kind } from "livekit-client";
import "@livekit/components-styles";
import { api, announceGoingLive } from "../lib/api";
import SharedClassBoard, { setClassSetupOpen, triggerClassBoardAction, triggerClassFlipOrientation, useClassCursorInfo, useClassLocked, useClassOrientation, triggerClassLockToggle, useClassMoveList, useClassStartShapes, triggerClassSeek, triggerClassLoadTree, useClassChallenge, triggerClassChallengeStart, triggerClassChallengeEnd, triggerClassChallengeDismiss, useChallengeMarkToast, dismissChallengeMarkToast, challengeTreeToPgn, type SharedTreeNode, type ChallengeAnswerRow , useCoachNotices, dismissCoachNotice } from "../components/SharedClassBoard";
import { useScreenWakeLock } from "../hooks/useScreenWakeLock";
import { OPENINGS, findOpeningForLine, openingBySlug, type Opening } from "../lib/openings";
import { fetchExplorer, type ExplorerData, type ExplorerMove } from "../lib/explorer";
import { listRepertoire, shareRepertoire, type RepertoireEntry, type RepMoveNode } from "../lib/repertoire-api";
import { Chess } from "chess.js";
import AudiencePickerModal from "../components/AudiencePickerModal";
import { ClassNotationPanel, STANDARD_START_FEN } from "../components/ClassNotationPanel";

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
function CoachBoardNav({ readOnly = false }: { readOnly?: boolean } = {}) {
  // Post-tree refactor: cursorIdx = cursorPath.length and history[] is the
  // moves up-to-cursor, so cursorIdx === historyLen always → the old
  // canFwd = cursorIdx < historyLen check was permanently false and the
  // → button never enabled. Derive canFwd from the TREE instead: cursor
  // can go forward if the current node has any children (mainline extends).
  const { tree, cursorPath } = useClassMoveList();
  const canBack = cursorPath.length > 0;
  const canFwd = (() => {
    let cur = tree;
    for (const idx of cursorPath) cur = (cur[idx]?.children) ?? [];
    return cur.length > 0;
  })();
  // Best-effort ply / total-along-mainline label. Total = walk mainline from
  // root all the way down (child[0] chain length), even if cursor is on a
  // variation — matches the /openings "N / M" pattern.
  const mainlineLen = (() => {
    let n = 0; let cur = tree;
    while (cur.length > 0) { n++; cur = cur[0]!.children; }
    return n;
  })();
  const label = mainlineLen === 0 ? "start" : `${cursorPath.length} / ${mainlineLen}`;
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-ink-700 bg-ink-900 px-2 py-1 shadow">
      <button
        onClick={() => triggerClassBoardAction("stepBack")}
        disabled={readOnly || !canBack}
        title={readOnly ? "Only the coach can rewind for the class" : "Previous move (←) — non-destructive; step forward again to return"}
        className="rounded-md px-2 py-0.5 text-sm text-white transition hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-30"
      >
        ←
      </button>
      <span className="px-1 font-mono text-[11px] tabular-nums text-ink-400">{label}</span>
      <button
        onClick={() => triggerClassBoardAction("stepForward")}
        disabled={readOnly || !canFwd}
        title={readOnly ? "Only the coach can advance for the class" : "Next move (→)"}
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

// Student-only: quick PRIVATE message to the class's coach without leaving
// Dream Meet. Owner ask 2026-09-03: "need option for students to private
// message coach during dream meet". Uses the existing 1:1 messaging
// backend from feature-1 (push notifications on new DM). Coach gets the
// standard chat push and can reply from /messages — this is a one-shot
// send, not a live chat pane (that's the deferred feature 6).
function MessageCoachButton({ room }: { room: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [coach, setCoach] = useState<{ userId: string | null; name: string | null } | null>(null);
  useEffect(() => {
    if (!open || coach) return;
    void fetch(`/v2api/api/class/${encodeURIComponent(room)}/coach`, { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((j) => { if (j) setCoach(j); })
      .catch(() => { /* silent */ });
  }, [open, coach, room]);

  const send = async () => {
    const body = text.trim();
    if (!body || !coach?.userId) return;
    setSending(true); setStatus(null);
    try {
      const r = await fetch("/v2api/api/messages/send", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toUserId: coach.userId, text: body }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as any)?.message || `HTTP ${r.status}`);
      setStatus({ ok: true, msg: "Sent — coach was notified." });
      setText("");
      // Close after 1.2s so the confirmation is visible then dismisses.
      setTimeout(() => { setOpen(false); setStatus(null); }, 1200);
    } catch (e) {
      setStatus({ ok: false, msg: (e as Error)?.message || "Send failed" });
    } finally { setSending(false); }
  };

  return (
    <>
      <button onClick={() => setOpen(true)}
        title="Send a private message to your coach"
        className="rounded-full border border-ink-700 bg-ink-900 px-3 py-1.5 text-sm text-ink-100 hover:bg-ink-800">
        📩 Message coach
      </button>
      {open && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/60 p-4" onClick={() => !sending && setOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl border border-brand-500/40 bg-slate-950 p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-display text-base text-white">📩 Message coach{coach?.name ? ` — ${coach.name}` : ""}</h3>
              <button onClick={() => setOpen(false)} className="text-ink-400 hover:text-white">✕</button>
            </div>
            {!coach ? (
              <div className="py-6 text-center text-sm text-ink-400">Loading…</div>
            ) : !coach.userId ? (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
                Couldn't find the coach for this class — please DM them from the Messages page instead.
              </div>
            ) : (
              <>
                <textarea rows={4} value={text} disabled={sending}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void send(); } }}
                  placeholder="Type your message — only the coach sees it."
                  className="w-full rounded-lg border border-ink-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none disabled:opacity-50" />
                {status && (
                  <div className={`mt-2 text-xs ${status.ok ? "text-emerald-300" : "text-rose-300"}`}>{status.msg}</div>
                )}
                <div className="mt-3 flex items-center justify-end gap-2">
                  <button onClick={() => setOpen(false)} disabled={sending}
                    className="rounded-lg border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-200 hover:bg-ink-700">Cancel</button>
                  <button onClick={send} disabled={sending || !text.trim()}
                    className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-400 disabled:opacity-50">
                    {sending ? "Sending…" : "Send ↩"}
                  </button>
                </div>
                <div className="mt-2 text-[10px] text-ink-500">
                  Tip: Ctrl/⌘+Enter to send. Only your coach sees this message.
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// Persistent mic status for the COACH — feedback loop for "are students
// hearing me right now?". Green dot pulses when the coach's mic is
// actually publishing audio (via LiveKit's speaking-detection). Rose pill
// when muted or the mic track is missing entirely. N listeners = number
// of remote participants in the room (proxy for hearing; a student with
// audio output muted / autoplay blocked still counts, but a 0 here means
// definitely nobody). Owner 2026-09-03: "coach doesn't know whether
// students hear". Renders in the header for coaches only.
function CoachMicStatus() {
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  const isSpeaking = useIsSpeaking(localParticipant);
  const participants = useParticipants();
  const listeners = Math.max(0, participants.length - 1);   // exclude coach themselves
  if (!isMicrophoneEnabled) {
    return (
      <div
        className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/60 bg-rose-500/20 px-2.5 py-1 text-xs font-semibold text-rose-100"
        title="Your mic is OFF — students hear nothing. Click the 🎤 button in the footer to unmute."
      >
        🔇 Mic off · {listeners} in room
      </div>
    );
  }
  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition ${isSpeaking ? "border-emerald-400/70 bg-emerald-500/25 text-emerald-100" : "border-ink-700 bg-ink-800 text-ink-200"}`}
      title={isSpeaking ? "Mic is publishing — students hear you now" : "Mic is on, waiting for you to speak"}
    >
      <span className={`inline-block h-2 w-2 rounded-full ${isSpeaking ? "bg-emerald-400 animate-pulse" : "bg-ink-600"}`} />
      🎤 On air · {listeners} listener{listeners === 1 ? "" : "s"}
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
  // rosterOpen closes on click-away in dropdown mode; in pinned mode the panel
  // stays open across page reloads (owner 2026-09-03: "if pinned it becomes
  // floatable, and keeps open and floatable, so coach move it to not
  // disturbing place"). Both states persist to localStorage per-user.
  const [rosterPinned, setRosterPinned] = useState<boolean>(() => {
    try { return localStorage.getItem("cg-roster-pin") === "1"; } catch { return false; }
  });
  const [rosterPos, setRosterPos] = useState<{ x: number; y: number }>(() => {
    try {
      const raw = localStorage.getItem("cg-roster-pos");
      if (raw) { const p = JSON.parse(raw); if (Number.isFinite(p?.x) && Number.isFinite(p?.y)) return p; }
    } catch { /* */ }
    return { x: Math.max(16, window.innerWidth - 260), y: 120 };
  });
  const [rosterOpen, setRosterOpen] = useState<boolean>(rosterPinned);
  useEffect(() => { try { localStorage.setItem("cg-roster-pin", rosterPinned ? "1" : "0"); } catch { /* */ } }, [rosterPinned]);
  useEffect(() => { try { localStorage.setItem("cg-roster-pos", JSON.stringify(rosterPos)); } catch { /* */ } }, [rosterPos]);
  // Drag handle — pointerdown on the header captures + moves. Clamped to
  // viewport so the panel can't be dragged fully offscreen.
  const dragRef = useRef<{ dx: number; dy: number; pid: number } | null>(null);
  const onDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!rosterPinned) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { dx: e.clientX - rosterPos.x, dy: e.clientY - rosterPos.y, pid: e.pointerId };
  };
  const onDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current; if (!d || d.pid !== e.pointerId) return;
    const w = 240, h = 200;   // approx panel size for clamping
    const x = Math.max(4, Math.min(window.innerWidth - w - 4, e.clientX - d.dx));
    const y = Math.max(4, Math.min(window.innerHeight - h - 4, e.clientY - d.dy));
    setRosterPos({ x, y });
  };
  const onDragEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pid === e.pointerId) dragRef.current = null;
  };
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
            {/* click-away closer only when NOT pinned — pinned panels stay
             *  open until the coach clicks × or un-pins. */}
            {!rosterPinned && <div className="fixed inset-0 z-40" onClick={() => setRosterOpen(false)} />}
            <div
              className={
                rosterPinned
                  ? "fixed z-50 w-[240px] overflow-hidden rounded-xl border border-ink-700 bg-ink-900/95 shadow-2xl backdrop-blur"
                  : "absolute right-0 top-full z-50 mt-1 w-[240px] overflow-hidden rounded-xl border border-ink-700 bg-ink-900/95 shadow-2xl backdrop-blur"
              }
              style={rosterPinned ? { left: rosterPos.x, top: rosterPos.y } : undefined}
            >
              <div
                onPointerDown={onDragStart}
                onPointerMove={onDragMove}
                onPointerUp={onDragEnd}
                onPointerCancel={onDragEnd}
                className={`flex items-center justify-between border-b border-ink-800 bg-ink-800/60 px-3 py-2 text-xs font-semibold text-white ${rosterPinned ? "cursor-move select-none" : ""}`}
                title={rosterPinned ? "Drag to move" : undefined}
              >
                <span>In the room · {participants.length}</span>
                <span className="flex items-center gap-1">
                  <button
                    onClick={() => setRosterPinned((v) => !v)}
                    title={rosterPinned ? "Unpin — go back to dropdown" : "Pin — float above the board so it stays open"}
                    className={`grid h-6 w-6 place-items-center rounded ${rosterPinned ? "bg-brand-500/30 text-brand-100" : "text-ink-300 hover:bg-ink-700"}`}
                  >📌</button>
                  <button
                    onClick={() => setRosterOpen(false)}
                    title="Close"
                    className="grid h-6 w-6 place-items-center rounded text-ink-300 hover:bg-ink-700"
                  >×</button>
                </span>
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
// Two mount points: the floating card over the board on lg+ screens, and a
// one-line strip under the top bar on phones/tablets, where a 280px card over
// a 360px board swallowed every tap on the top ranks (owner report 2026-09-07).
function CoachWaitingOverlay({ room, role, variant = "overlay" }: { room: string; role: "coach" | "student"; variant?: "overlay" | "strip" }) {
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
  const dismiss = () => { try { sessionStorage.setItem("cg-waiting-dismiss-" + room, "1"); } catch { /* */ } setDismissed(true); };
  if (variant === "strip") {
    return (
      <div className="flex items-center gap-2 border-b border-amber-400/30 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-100 lg:hidden" data-testid="waiting-strip">
        <span className="shrink-0 font-semibold uppercase tracking-wide text-amber-300">⏳ Waiting for students</span>
        <span className="min-w-0 flex-1 truncate text-ink-300">share the invite link so moves sync</span>
        <button onClick={copy} className="shrink-0 rounded-md bg-amber-500 px-2 py-0.5 font-bold text-ink-900 hover:bg-amber-400">{copied ? "✓" : "Copy link"}</button>
        <button onClick={dismiss} className="shrink-0 px-1 text-sm text-ink-400 hover:text-white" title="Hide">×</button>
      </div>
    );
  }
  return (
    <div className="absolute right-3 top-3 z-20 hidden w-[280px] rounded-xl border border-amber-400/40 bg-ink-900/95 p-3 shadow-2xl backdrop-blur lg:block" data-testid="waiting-card">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-300">
          ⏳ Waiting for students
        </div>
        <button onClick={dismiss}
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

// ─────────────────────────────────────────────────────────────────────
// TEACH OPENING — coach clicks 📖 Teach opening → modal with 3 tabs:
//   1. My Repertoire (saved lines from /api/my/repertoire)
//   2. Find opening (search over the corpus in lib/openings)
//   3. Master games at current position (WDL + top moves via fetchExplorer)
// After picking, the entry's SANs/tree are shipped to class-ws via a
// load-tree frame — server replaces room.tree + startFen wholesale, every
// student sees the loaded position + tree instantly.
//
// Also: notation panel gets a 💾 Save to repertoire chip (coach only) and
// the right-click menu gets 💾 Save from here (add-on A: auto-suggest name).
// After saving, coach can auto-share with the class audience so the entry
// lands in every student's Opening Trainer immediately (add-on B).
// ─────────────────────────────────────────────────────────────────────

// Convert an Opening (corpus, pgnStart = SAN[]) to a straight-line tree the
// class-ws server understands. All corpus entries begin from the standard
// starting position (implicit startFen).
function sansToStraightTree(startFen: string, sans: string[]): SharedTreeNode[] {
  try {
    const c = new Chess(startFen);
    const nodes: SharedTreeNode[] = [];
    for (const san of sans) {
      const applied = c.move(san);
      if (!applied) break;
      nodes.push({ move: { from: applied.from, to: applied.to, promotion: applied.promotion }, children: [] });
    }
    for (let i = nodes.length - 1; i > 0; i--) nodes[i - 1]!.children = [nodes[i]!];
    return nodes.length > 0 ? [nodes[0]!] : [];
  } catch { return []; }
}
// Convert a repertoire tree (RepMoveNode with san strings + children) into
// the ws server's move-based tree by replaying the SANs from startFen. Each
// recursion clones a chess.js instance so sibling branches don't share state.
function repTreeToWsTree(startFen: string, roots: RepMoveNode[]): SharedTreeNode[] {
  const walk = (nodes: RepMoveNode[], fen: string): SharedTreeNode[] => {
    const out: SharedTreeNode[] = [];
    for (const n of nodes) {
      try {
        const c = new Chess(fen);
        const applied = c.move(n.san);
        if (!applied) continue;
        out.push({
          move: { from: applied.from, to: applied.to, promotion: applied.promotion },
          children: n.children?.length ? walk(n.children, c.fen()) : [],
        });
      } catch { /* skip malformed */ }
    }
    return out;
  };
  return walk(roots, startFen);
}
// Mainline SAN[] from the ws tree — for auto-name suggestion (findOpeningForLine).
function mainlineSans(startFen: string, tree: SharedTreeNode[]): string[] {
  try {
    const c = new Chess(startFen);
    const sans: string[] = [];
    let nodes = tree;
    while (nodes.length > 0) {
      const n = nodes[0]!;
      const applied = c.move({ from: n.move.from, to: n.move.to, promotion: (n.move.promotion as any) || "q" });
      if (!applied) break;
      sans.push(applied.san);
      nodes = n.children;
    }
    return sans;
  } catch { return []; }
}

function TeachOpeningModal({ room, role, onClose }: { room: string; role: "coach" | "student"; onClose: () => void }) {
  void role;   // (coach-only render — caller gates)
  const { data: rep } = useQuery({
    queryKey: ["my-repertoire"],
    queryFn: listRepertoire,
    staleTime: 60_000,
  });
  const { startFen, tree, cursorPath } = useClassMoveList();
  // Current FEN at cursor — the master-games tab queries against this.
  const currentFen = useMemo(() => {
    try {
      const c = new Chess(startFen);
      let nodes = tree;
      for (const idx of cursorPath) {
        const n = nodes[idx];
        if (!n) break;
        c.move({ from: n.move.from, to: n.move.to, promotion: (n.move.promotion as any) || "q" });
        nodes = n.children;
      }
      return c.fen();
    } catch { return startFen; }
  }, [startFen, tree, cursorPath]);

  type Tab = "repertoire" | "find" | "masters";
  const [tab, setTab] = useState<Tab>("repertoire");
  const [q, setQ] = useState("");
  const [shareAfterLoad, setShareAfterLoad] = useState(true);      // add-on B default
  const [forceTrain, setForceTrain] = useState(false);             // add-on B extra
  const [loading, setLoading] = useState<string | null>(null);     // shows spinner on the row being loaded
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2500); return () => clearTimeout(t); }, [toast]);

  const filteredCorpus = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return OPENINGS.slice(0, 60);
    return OPENINGS.filter((o) =>
      o.name.toLowerCase().includes(needle) ||
      o.eco.toLowerCase().includes(needle) ||
      o.pgnStart.join(" ").toLowerCase().includes(needle)
    ).slice(0, 60);
  }, [q]);
  const filteredRep = useMemo(() => {
    const list = rep?.entries ?? [];
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((e) => (e.name || "").toLowerCase().includes(needle) || (e.slug || "").toLowerCase().includes(needle));
  }, [rep, q]);

  // Master games at position — /api/explorer with db=masters. Only fires
  // when the masters tab is open + a real position is loaded.
  const { data: mastersData, isFetching: mastersFetching } = useQuery({
    queryKey: ["class-masters", currentFen],
    queryFn: () => fetchExplorer(currentFen, "masters"),
    enabled: tab === "masters",
    staleTime: 30_000,
  });

  const loadIntoClass = async (label: string, newStartFen: string, wsTree: SharedTreeNode[], repEntry?: RepertoireEntry) => {
    setLoading(label);
    try {
      triggerClassLoadTree({ startFen: newStartFen, tree: wsTree, cursorPath: [] });
      // Add-on B: share the loaded repertoire entry with the class audience
      // so it lands in every student's Opening Trainer.
      if (shareAfterLoad && repEntry?._id) {
        try {
          // Fetch the class row for its audience — batch/individuals — then
          // share the entry with those studentIds.
          const klass = await fetch(`/v2api/api/class/schedule/${encodeURIComponent(room)}`, { credentials: "include" }).then((r) => r.ok ? r.json() : null);
          const studentIds: string[] = Array.isArray(klass?.batchStudentIds) ? klass.batchStudentIds : [];
          if (studentIds.length > 0) {
            await shareRepertoire(repEntry._id, studentIds, forceTrain);
            setToast(`📖 Loaded & shared with ${studentIds.length} student${studentIds.length === 1 ? "" : "s"}`);
          } else {
            setToast(`📖 Loaded to class board`);
          }
        } catch { setToast(`📖 Loaded (share failed)`); }
      } else {
        setToast(`📖 Loaded to class board`);
      }
      setTimeout(onClose, 800);
    } finally {
      setLoading(null);
    }
  };

  const loadFromRep = (e: RepertoireEntry) => {
    // Setup-position aware: replay from entry.startFen when present, else
    // fall back to the standard opening. If both tree and sans are present,
    // the tree wins (it preserves variations; sans is mainline-only).
    const base = e.startFen && e.startFen.length > 0 ? e.startFen : STANDARD_START_FEN;
    const wsTree = e.tree && e.tree.length > 0
      ? repTreeToWsTree(base, e.tree)
      : sansToStraightTree(base, e.sans ?? []);
    void loadIntoClass(e._id, base, wsTree, e);
  };
  const loadFromCorpus = (o: Opening) => {
    const wsTree = sansToStraightTree(STANDARD_START_FEN, o.pgnStart);
    void loadIntoClass(o.slug, STANDARD_START_FEN, wsTree);
  };
  // Add-on D: click a master-move → append it as a NEW variation from cursor.
  // The move goes through the normal move handler (which forks if it exists
  // as sibling, appends otherwise).
  const playMasterMove = (mv: ExplorerMove) => {
    try {
      // ExplorerMove has UCI like "e2e4"; parse to from/to/promotion.
      const uci = mv.uci;
      if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return;
      const from = uci.slice(0, 2), to = uci.slice(2, 4), promo = uci.length > 4 ? uci[4] : undefined;
      // Trigger the same ws move that a coach drag would trigger. The class
      // board's own onMove is inside SharedClassBoard — simplest is to fire
      // a direct ws send here. We piggyback on triggerClassLoadTree? No —
      // it'd wipe the tree. Use a fresh path in the notation panel: send
      // a move frame via the same channel. Simpler: append child to tree
      // client-side then load-tree it? That'd cause a race. Cleanest is to
      // fire the wsRef.current from SharedClassBoard — expose it.
      // For simplicity: use load-tree with the current tree + one appended
      // child at cursor. The server sanitizes + broadcasts.
      const nextTree: SharedTreeNode[] = JSON.parse(JSON.stringify(tree));
      let parent = nextTree;
      for (let i = 0; i < cursorPath.length; i++) parent = parent[cursorPath[i]!]!.children;
      // Skip if already exists (server would also dedupe).
      const existing = parent.findIndex((n) => n.move.from === from && n.move.to === to && (n.move.promotion || "q") === (promo || "q"));
      let newIdx = existing;
      if (existing < 0) {
        parent.push({ move: { from, to, promotion: promo }, children: [] });
        newIdx = parent.length - 1;
      }
      const newCursor = [...cursorPath, newIdx];
      triggerClassLoadTree({ startFen, tree: nextTree, cursorPath: newCursor });
      setToast(`✓ Played ${mv.san}`);
    } catch { /* silent */ }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onKeyDown={(e) => { if (e.key === "Escape") onClose(); }} tabIndex={-1}>
      <div className="flex w-full max-w-2xl flex-col rounded-2xl border border-brand-500/40 bg-gradient-to-br from-ink-900 to-ink-950 p-5 shadow-2xl max-h-[85vh]">
        <div className="mb-3 flex items-baseline justify-between">
          <div className="font-display text-lg font-bold text-white">📖 Teach opening</div>
          <button onClick={onClose} className="rounded-md p-1 text-xl leading-none text-ink-400 hover:text-white">×</button>
        </div>
        <div className="mb-3 flex gap-1 rounded-lg border border-ink-700 bg-ink-800/60 p-1 text-xs">
          {(["repertoire", "find", "masters"] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 rounded-md px-3 py-1.5 font-semibold transition ${tab === t ? "bg-brand-500/30 text-brand-100" : "text-ink-300 hover:text-white"}`}
            >
              {t === "repertoire" ? "🗂 My Repertoire" : t === "find" ? "🔍 Find opening" : "♞ Master games"}
            </button>
          ))}
        </div>
        {(tab === "repertoire" || tab === "find") && (
          <input type="text" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={tab === "repertoire" ? "Search my saved lines…" : "Search openings (name, ECO, moves)…"}
            className="mb-2 w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none"
          />
        )}
        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-ink-800 bg-ink-950/60">
          {tab === "repertoire" && (
            filteredRep.length === 0 ? (
              <div className="p-4 text-xs text-ink-500">
                {rep ? "No saved lines yet. Save one from any position via the notation panel's 💾 chip." : "Loading…"}
              </div>
            ) : (
              <div className="divide-y divide-ink-800">
                {filteredRep.map((e) => (
                  <div key={e._id} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-white">{e.name || "Untitled"}</div>
                      <div className="truncate text-[10px] text-ink-500">
                        {e.kind === "corpus" ? `Bookmark · ${e.slug ?? ""}` : `Line · ${(e.sans || []).length} moves`}
                        {e.forceTrain && " · ⚡ force-train"}
                      </div>
                    </div>
                    <button onClick={() => loadFromRep(e)} disabled={!!loading}
                      className="shrink-0 rounded-md bg-brand-500 px-3 py-1 text-xs font-bold text-white hover:bg-brand-400 disabled:opacity-60">
                      {loading === e._id ? "Loading…" : "Load"}
                    </button>
                  </div>
                ))}
              </div>
            )
          )}
          {tab === "find" && (
            <div className="divide-y divide-ink-800">
              {filteredCorpus.map((o) => (
                <div key={o.slug} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-white">{o.name}</div>
                    <div className="truncate text-[10px] text-ink-500">{o.eco} · {o.pgnStart.join(" ")}</div>
                  </div>
                  <button onClick={() => loadFromCorpus(o)} disabled={!!loading}
                    className="shrink-0 rounded-md bg-brand-500 px-3 py-1 text-xs font-bold text-white hover:bg-brand-400 disabled:opacity-60">
                    {loading === o.slug ? "Loading…" : "Load"}
                  </button>
                </div>
              ))}
              {filteredCorpus.length === 0 && <div className="p-4 text-xs text-ink-500">No openings match.</div>}
            </div>
          )}
          {tab === "masters" && (
            <div className="p-3">
              {mastersFetching && <div className="text-xs text-ink-500">Loading master games…</div>}
              {mastersData && (
                <>
                  <div className="mb-2 text-[10px] uppercase tracking-widest text-ink-500">Position stats · {(mastersData.white + mastersData.draws + mastersData.black).toLocaleString()} games</div>
                  <WdlBarInline w={mastersData.white} d={mastersData.draws} b={mastersData.black} />
                  <div className="mt-3 space-y-1">
                    {(mastersData.moves ?? []).slice(0, 8).map((m: ExplorerMove) => {
                      const total = m.white + m.draws + m.black;
                      const wPct = total ? Math.round((m.white / total) * 100) : 0;
                      return (
                        <button key={m.uci} onClick={() => playMasterMove(m)}
                          className="flex w-full items-center gap-3 rounded-md border border-ink-800 bg-ink-900 px-3 py-1.5 text-sm text-ink-100 hover:border-brand-500/40 hover:bg-ink-800"
                          title="Play this move on the class board (creates a variation if it's a new line)">
                          <span className="w-16 font-mono font-bold">{m.san}</span>
                          <span className="w-24 text-right text-[11px] text-ink-400">{total.toLocaleString()}</span>
                          <span className="flex-1"><WdlBarInline w={m.white} d={m.draws} b={m.black} /></span>
                          <span className="w-10 text-right text-[10px] text-ink-500">{wPct}%W</span>
                        </button>
                      );
                    })}
                    {(!mastersData.moves || mastersData.moves.length === 0) && <div className="text-xs text-ink-500">No master games from this position.</div>}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        {/* Add-on B controls — only relevant for tabs that load repertoire entries. */}
        {tab === "repertoire" && (
          <div className="mt-3 rounded-lg border border-ink-800 bg-ink-950/40 p-2 text-[11px]">
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={shareAfterLoad} onChange={(e) => setShareAfterLoad(e.target.checked)} className="h-3.5 w-3.5 accent-brand-500" />
              <span className="text-ink-200">Share with class audience after load</span>
            </label>
            {shareAfterLoad && (
              <label className="mt-1 ml-6 flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={forceTrain} onChange={(e) => setForceTrain(e.target.checked)} className="h-3.5 w-3.5 accent-amber-500" />
                <span className="text-ink-300">⚡ Force into their Opening Trainer (they can't remove)</span>
              </label>
            )}
          </div>
        )}
        {toast && <div className="mt-2 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-center text-xs font-semibold text-emerald-100">{toast}</div>}
      </div>
    </div>
  );
}

function WdlBarInline({ w, d, b }: { w: number; d: number; b: number }) {
  const total = Math.max(1, w + d + b);
  const pct = (n: number) => `${Math.round((n / total) * 100)}%`;
  return (
    <div className="flex h-3 w-full overflow-hidden rounded" title={`W ${w} · D ${d} · B ${b}`}>
      <div style={{ width: pct(w) }} className="bg-emerald-400" />
      <div style={{ width: pct(d) }} className="bg-ink-500" />
      <div style={{ width: pct(b) }} className="bg-rose-600" />
    </div>
  );
}

// Send-position modal — coach captures the CURRENT class board (startFen +
// history + cursorIdx from useClassMoveList) and POSTs it to
// /api/class/:room/send-position. Blank recipients = server sends to every
// eligible student in the class (batch / individuals / coach's students).
// Phase 2 will layer a per-student picker here.
function SendPositionModal({ room, onClose, onSent }: { room: string; onClose: () => void; onSent: (n: number) => void }) {
  const { startFen, history, cursorIdx, tree, cursorPath } = useClassMoveList();
  const startShapes = useClassStartShapes();
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
        body: JSON.stringify({ title, startFen, history, cursorIdx, tree, cursorPath, startShapes }),
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
          Snapshots the current board + move list ({history.length} in this line{(() => {
            const total = (function count(nodes: SharedTreeNode[]): number {
              let n = 0; for (const c of nodes) n += 1 + count(c.children); return n;
            })(tree);
            const branches = total - history.length;
            return branches > 0 ? `, + ${branches} in variations` : "";
          })()}) into every eligible student's Notebook under 📚 Online class.
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
  // Keep phone/tablet screens on for the duration of the class so students
  // don't miss the coach when the OS would normally dim + suspend the tab.
  // Silent no-op on browsers without the Wake Lock API. `needsUserGesture`
  // flips true when iOS Safari has silently denied our autoplay + wake-lock
  // requests (mainly on pull-to-refresh — the reload has zero transient
  // activation, so both silently fail). The overlay below prompts the
  // student to tap once, which fires the hook's internal onFirstGesture
  // path and re-arms the screen-on machinery.
  const { needsUserGesture } = useScreenWakeLock(true);
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
  // Non-fatal media trouble (no webcam, no mic, permission denied, device busy).
  // Kept OUT of errMsg on purpose — see the onError handler below.
  const [mediaWarn, setMediaWarn] = useState<string | null>(null);
  const [tokenData, setTokenData] = useState<LKTokenResp | null>(null);
  // Audience picker — shows on coach entry if no audience has been picked
  // for this class yet (ad-hoc "Start now" rooms + scheduled classes without
  // a batch). Coach can re-open via the footer 🎯 button to change mid-class.
  const [audiencePickerOpen, setAudiencePickerOpen] = useState(false);
  const [audienceToast, setAudienceToast] = useState<string | null>(null);
  const [sendPositionOpen, setSendPositionOpen] = useState(false);
  const [sendPositionToast, setSendPositionToast] = useState<string | null>(null);
  const [teachOpen, setTeachOpen] = useState(false);
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
    <div className="mx-auto w-full">
      {/* iOS wake-lock rescue overlay — shown when the screen-on machinery
       *  didn't arm (mainly on pull-to-refresh: the reload grants zero
       *  transient activation, so muted-video autoplay + wake-lock request
       *  BOTH silently fail on iOS Safari). The student sees this small,
       *  non-blocking pill and taps once; the hook's onFirstGesture path
       *  starts the silent video + re-requests the wake lock, and the
       *  screen stays on for the rest of the class. Positioned above the
       *  LiveKit ControlBar so it doesn't overlap the mute/camera buttons.
       *  Auto-hides as soon as `needsUserGesture` flips back to false. */}
      {mediaWarn && (
        <div className="fixed left-1/2 top-16 z-[81] flex -translate-x-1/2 items-center gap-2 rounded-full bg-amber-500/95 px-4 py-2 text-xs font-bold text-black shadow-lg ring-2 ring-amber-300 md:top-20">
          <span>🎤 {mediaWarn}</span>
          <button type="button" onClick={() => setMediaWarn(null)} aria-label="Dismiss" className="rounded-full px-1.5 hover:bg-black/10">×</button>
        </div>
      )}
      {needsUserGesture && (
        <button
          type="button"
          onClick={() => { /* the click itself is the gesture the hook needs */ }}
          className="fixed left-1/2 top-16 z-[80] -translate-x-1/2 rounded-full bg-amber-500/95 px-4 py-2 text-xs font-bold text-black shadow-lg ring-2 ring-amber-300 backdrop-blur hover:bg-amber-400 md:top-20"
          aria-label="Tap to keep the screen on during class"
        >
          📱 Tap to keep screen on
        </button>
      )}
      {/* Full-viewport class shell (owner 2026-08-28: "board still not big
       *  like openings/puzzles"). Was capped at max-w-6xl + h-[90vh] which
       *  shrank the flex-1 board slot on desktop. Now the class uses the
       *  full viewport minus the site navbar (~3.5rem) so the board grows
       *  to match /puzzles + /openings. */}
      <div className="flex h-[calc(100dvh-3.5rem)] min-h-[560px] flex-col overflow-hidden rounded-none border-0 bg-ink-900/60 shadow-xl md:rounded-2xl md:border md:border-ink-700" data-lk-theme="default">
        <LiveKitRoom
          serverUrl={tokenData.url}
          token={tokenData.token}
          connect
          /* video stays opt-in — devices without a camera hit getUserMedia
           * errors that LiveKit surfaces as ConnectionError(InternalError,
           * reason=2, code=1). Users toggle video via the ControlBar after
           * joining.
           * audio: coach starts with mic ON (owner 2026-09-03: "default mic
           * for coach should be on"). If the mic isn't available, LiveKit
           * lands in the same soft-fail path and coach can toggle later.
           * Students stay muted by default — they unmute via the ControlBar. */
          audio={role === "coach"}
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
            // A missing/blocked camera or mic must NOT throw the whole class away.
            // Rendering the errMsg screen unmounts LiveKitRoom, so a coach on a
            // deskop with no mic was locked out of his own class entirely
            // ("NotFoundError · Requested device not found · code=8", owner
            // report 2026-09-04). Those are getUserMedia DOMExceptions: warn,
            // stay connected, let the ControlBar retry the device later.
            const MEDIA_ERRORS = ["NotFoundError", "NotAllowedError", "NotReadableError", "OverconstrainedError", "AbortError"];
            if (e?.name && MEDIA_ERRORS.includes(e.name)) {
              setMediaWarn(
                e.name === "NotAllowedError"
                  ? "Camera/mic blocked. Allow access in your browser to be heard."
                  : "No camera or microphone found. You can still see and hear the class.",
              );
              return;
            }
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
              {role === "coach" && <CoachMicStatus />}
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

          {/* Phone/tablet: the waiting-for-students notice lives here, in flow,
           *  never over the board. */}
          <CoachWaitingOverlay room={room} role={role} variant="strip" />

          {/* Body: /openings-style layout — big board on the left, notation
           *  as a right sidebar on lg+ screens. Stacks (board on top, notation
           *  below) on mobile / tablet so the board stays big on small
           *  viewports too. Footer controls sit under everything. Owner
           *  2026-08-28: "board should be big, like in openings, realign
           *  all other in left/right/bottom accordingly". */}
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-ink-950/40">
            <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
              {/* Board area — self-sizes to the largest square that fits.
               *  overflow-hidden clips any board that tries to grow past the
               *  container. container-type:size gives SharedClassBoard's
               *  cqi/cqb-based sizing an actual box to measure against. */}
              <div
                className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-2"
                style={{ containerType: 'size' } as any}
              >
              <SharedClassBoard room={room} userId={me?.userId} displayName={me?.username} onClassEnded={onClassEnded} intendedRole={role} />
              {/* Student toast when the coach marks their challenge answer.
               *  Module-level state so this host can live anywhere in the tree. */}
              <ChallengeMarkToastHost />
              <CoachNoticeHost />
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
              {/* ReactionOverlay + ReactionsBar removed 2026-09-03 (owner:
               *  "remove emoji panel, for coach and students"). Components
               *  left in the file dead for now — sweep in a later cleanup. */}
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
              {role === "coach" && teachOpen && (
                <TeachOpeningModal room={room} role={role} onClose={() => setTeachOpen(false)} />
              )}
              {sendPositionToast && (
                <div className="pointer-events-none absolute left-1/2 top-4 z-[65] -translate-x-1/2 rounded-full border border-emerald-500/60 bg-emerald-500/25 px-4 py-1.5 text-sm font-semibold text-emerald-50 shadow-lg backdrop-blur">
                  {sendPositionToast}
                </div>
              )}
              </div>

              {/* Move-list panel — /openings-style. Sidebar on lg+ (fixed
               *  320px, full body height), stacks under the board on smaller
               *  screens (mobile / tablet) via lg:w-[320px] + w-full. Uses
               *  its own max-h cap on mobile so the board doesn't shrink. */}
              <div className="shrink-0 border-t border-ink-800 lg:h-auto lg:w-[360px] lg:border-l lg:border-t-0">
                <ClassNotationPanel room={room} role={role} />
              </div>
            </div>

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
                <CoachBoardNav readOnly={role !== "coach"} />
                {/* 📩 Private DM to the coach — student-only. Opens a small
                 *  dialog to send one message; coach receives the standard
                 *  chat push notification + can reply from /messages. Owner
                 *  ask 2026-09-03: 'need option for students to private
                 *  message coach during dream meet'. */}
                {role === "student" && <MessageCoachButton room={room} />}
                {role === "coach" && <CoachFlipToggle />}
                {role === "coach" && <CoachLockToggle />}
                {role === "coach" && (
                  <button
                    onClick={() => setAudiencePickerOpen(true)}
                    title="Change which students can join this class + who gets notified"
                    className="rounded-full border border-ink-700 bg-ink-900 px-3 py-1.5 text-sm font-semibold text-ink-100 hover:bg-ink-800"
                  >
                    🎯 Students
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
                  <ChallengeCoachButton />
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
                    onClick={() => setTeachOpen(true)}
                    title="Load an opening from your Repertoire / the corpus / master games at this position"
                    className="rounded-full border border-sky-500/50 bg-sky-500/20 px-3 py-1.5 text-sm font-semibold text-sky-100 hover:bg-sky-500/30"
                  >
                    📖 Teach opening
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

// ═══════════════════════════════════════════════════════════════════════
// Challenge mode — "find the good moves"
// Coach clicks 🧠 Challenge → duration+prompt modal → starts. Students
// see prompt overlay + solve on their own boards for the duration. At
// reveal, coach sees every student's SAN sequence in the Answers panel.
// ═══════════════════════════════════════════════════════════════════════

function ChallengeCoachButton() {
  const challenge = useClassChallenge();
  const { startFen, tree, cursorPath } = useClassMoveList();
  const [open, setOpen] = useState(false);
  // Layout: BOTH the challenge starter AND the past-answers chip render
  // side-by-side whenever answers exist. Owner report 2026-09-02: "in
  // coach view, students' answers are gone after continuing the
  // explanation" — root cause was the answers chip REPLACING the
  // challenge starter (either-or), and Dismiss wiping the state. Now
  // the answers chip stays until a new challenge starts (natural
  // replace) OR the coach explicitly clears it.
  return (
    <>
      {challenge?.active ? (
        <ChallengeCoachActiveChip challenge={challenge} />
      ) : (
        <button
          onClick={() => setOpen(true)}
          title="Freeze the board and ask students to find good moves on their own boards"
          className="rounded-full border border-purple-500/50 bg-purple-500/20 px-3 py-1.5 text-sm font-semibold text-purple-100 hover:bg-purple-500/30"
        >
          🧠 Challenge
        </button>
      )}
      {/* Past-answers chip — stays visible after a challenge ends so the
       *  coach can reopen the panel any time, even mid-explanation. */}
      {challenge && !challenge.active && challenge.answers && (
        <ChallengeAnswersPanel challenge={challenge} />
      )}
      {open && (
        <ChallengeStartModal
          onClose={() => setOpen(false)}
          onStart={(opts) => {
            triggerClassChallengeStart({
              positionFen: computeFenAt(startFen, tree, cursorPath),
              startFen,
              prompt: opts.prompt,
              durationSec: opts.durationSec,
            });
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function ChallengeCoachActiveChip({ challenge }: { challenge: NonNullable<ReturnType<typeof useClassChallenge>> }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  void tick;
  const remaining = Math.max(0, Math.ceil((challenge.endsAt - Date.now()) / 1000));
  const label = remaining >= 60 ? `${Math.floor(remaining/60)}m ${(remaining%60).toString().padStart(2,"0")}s` : `${remaining}s`;
  return (
    <button
      onClick={() => { if (window.confirm("End the challenge now?")) triggerClassChallengeEnd(); }}
      title="End the challenge and reveal the coach's board + collect answers"
      className="rounded-full border border-purple-400/70 bg-purple-500/30 px-3 py-1.5 text-sm font-semibold text-white shadow-glow hover:brightness-110"
    >
      🧠 {label} · {challenge.answered}/{challenge.total} answered · ✋ Reveal
    </button>
  );
}

function ChallengeStartModal({ onClose, onStart }: { onClose: () => void; onStart: (opts: { prompt: string; durationSec: number }) => void }) {
  const [prompt, setPrompt] = useState("Find the best move");
  const [durationSec, setDurationSec] = useState(120);
  const presets = [30, 60, 120, 300, 600, 900, 1800];
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-purple-500/40 bg-ink-950 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h3 className="font-display text-lg text-purple-100">🧠 Challenge students</h3>
            <p className="mt-1 text-xs text-ink-400">Board freezes. Students play on their own boards. You are told as each one answers; the answers stay hidden until you open them.</p>
          </div>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg bg-ink-800 text-ink-300 hover:bg-ink-700">✕</button>
        </div>
        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-ink-300">Prompt (shown on student boards)</span>
          <input value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={200}
            className="h-10 w-full rounded-lg border border-ink-700 bg-ink-900 px-3 text-sm text-ink-100 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/30" />
        </label>
        <label className="mb-4 block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-ink-300">Duration</span>
          <div className="flex flex-wrap gap-2">
            {presets.map((s) => (
              <button key={s} onClick={() => setDurationSec(s)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${durationSec === s ? "border-purple-400 bg-purple-500/25 text-purple-100" : "border-ink-700 bg-ink-900 text-ink-300 hover:border-purple-500/60"}`}>
                {s >= 60 ? `${s/60}m` : `${s}s`}
              </button>
            ))}
          </div>
        </label>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="h-10 rounded-lg px-4 text-sm font-semibold text-ink-300 hover:bg-ink-800">Cancel</button>
          <button onClick={() => onStart({ prompt: prompt.trim() || "Find the best move", durationSec })}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-gradient-to-r from-purple-600 to-purple-500 px-5 text-sm font-semibold text-white shadow-glow hover:brightness-110">
            🧠 Start challenge
          </button>
        </div>
      </div>
    </div>
  );
}

function ChallengeAnswersPanel({ challenge }: { challenge: NonNullable<ReturnType<typeof useClassChallenge>> }) {
  // Never opens on its own (owner 2026-09-08: the coach's screen is shared
  // with the class, so an auto-revealed answer list gave the solution away).
  // The coach gets a notice when the challenge ends and opens this when the
  // screen is safe. Inside, the moves are hidden behind "Reveal" as well.
  const [open, setOpen] = useState(false);
  const [revealed, setRevealed] = useState(false);
  useEffect(() => { setRevealed(false); setOpen(false); }, [challenge.startedAt]);
  // Local copy so ✓/✗ clicks apply optimistically without waiting for the
  // server. Kept in sync with the incoming challenge.answers on remount.
  const [rows, setRows] = useState<ChallengeAnswerRow[]>(challenge.answers ?? []);
  useEffect(() => { setRows(challenge.answers ?? []); }, [challenge.answers]);
  const { room = "" } = useParams();
  const correctCount = rows.filter((a) => a.correct === true).length;
  const wrongCount   = rows.filter((a) => a.correct === false).length;
  const unmarkedCount = rows.length - correctCount - wrongCount;

  async function mark(userId: string, correct: boolean | null) {
    // Optimistic — update local state first, then POST.
    setRows((prev) => prev.map((r) => r.userId === userId ? { ...r, correct } : r));
    try {
      await fetch("/v2api/api/class/challenges/mark-answer", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId: room, startedAt: challenge.startedAt, userId, correct }),
      });
    } catch {
      // Revert on network fail (rare — leave alone; user can retry).
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        data-testid="answers-chip"
        title="Who answered — the moves stay hidden until you press Reveal inside"
        className="rounded-full border border-purple-400/50 bg-purple-500/20 px-3 py-1.5 text-sm font-semibold text-purple-100 hover:bg-purple-500/30"
      >
        📋 Answers ({rows.length})
      </button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal onClick={() => setOpen(false)}>
          <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-purple-500/40 bg-ink-950 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between border-b border-ink-800 p-4">
              <div className="min-w-0 flex-1">
                <h3 className="font-display text-lg text-purple-100">📋 Challenge answers</h3>
                {challenge.prompt && <p className="mt-1 text-xs italic text-ink-400 truncate">"{challenge.prompt}"</p>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => {
                    if (!window.confirm("Clear these answers? You won't be able to see them again in this class session.")) return;
                    triggerClassChallengeDismiss();
                    setOpen(false);
                  }}
                  className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-200 hover:bg-rose-500/20"
                  title="Permanently clear these answers from the class view">🗑 Clear</button>
                <button onClick={() => setOpen(false)}
                  className="rounded-lg bg-ink-800 px-3 py-1 text-xs font-semibold text-ink-300 hover:bg-ink-700"
                  title="Close this panel — answers stay accessible via the 📋 Answers chip">Close</button>
                <button onClick={() => setOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg bg-ink-800 text-ink-300 hover:bg-ink-700">✕</button>
              </div>
            </div>
            {/* Sticky count strip — always visible even after scrolling the table. */}
            <div className="border-b border-ink-800 bg-ink-900/60 px-4 py-2 text-xs">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2" data-testid="reveal-bar">
                <span className="text-amber-100">
                  {revealed ? "Moves are showing — anyone who can see your screen sees them." : "Moves are hidden. Names show who answered; press Reveal only when students can't see your screen."}
                </span>
                <button
                  onClick={() => setRevealed((r) => !r)}
                  data-testid="reveal-toggle"
                  className={`shrink-0 rounded-lg px-3 py-1 text-xs font-semibold ${revealed ? "border border-ink-600 bg-ink-800 text-ink-200 hover:bg-ink-700" : "bg-amber-500 text-ink-950 hover:bg-amber-400"}`}
                >
                  {revealed ? "🙈 Hide moves" : "👁 Reveal moves"}
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-purple-500/25 px-2.5 py-0.5 font-semibold text-purple-100">
                  {rows.length} {rows.length === 1 ? "student" : "students"} answered
                </span>
                {correctCount > 0 && (
                  <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 font-semibold text-emerald-200">
                    ✓ {correctCount} correct
                  </span>
                )}
                {wrongCount > 0 && (
                  <span className="rounded-full bg-rose-500/20 px-2.5 py-0.5 font-semibold text-rose-200">
                    ✗ {wrongCount} wrong
                  </span>
                )}
                {unmarkedCount > 0 && rows.length > 0 && (
                  <span className="rounded-full bg-ink-800 px-2.5 py-0.5 font-semibold text-ink-400">
                    {unmarkedCount} unmarked
                  </span>
                )}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {rows.length === 0 ? (
                <div className="rounded-xl border border-dashed border-ink-700 py-10 text-center text-sm text-ink-400">
                  No students answered.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-ink-400">
                      <th className="pb-2 pr-3 font-medium">Student</th>
                      <th className="pb-2 pr-3 font-medium">Moves</th>
                      <th className="pb-2 pr-3 font-medium">Time</th>
                      <th className="pb-2 font-medium">Mark</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((a) => {
                      const rowRing =
                        a.correct === true  ? "border-l-2 border-emerald-400/70" :
                        a.correct === false ? "border-l-2 border-rose-400/70" : "";
                      return (
                        <tr key={a.userId} className={`border-t border-ink-800 align-top ${rowRing}`}>
                          <td className="py-2 pr-3 text-white">{a.displayName || a.userId}</td>
                          <td className="py-2 pr-3 font-mono text-brand-200 whitespace-pre-wrap break-words" data-testid="answer-moves">{
                            !revealed
                              ? <span className="select-none tracking-widest text-ink-500" aria-label="hidden">✓ answered · ••••••</span>
                              : (a.tree && a.tree.length > 0)
                                ? challengeTreeToPgn(a.tree, challenge.positionFen)
                                : (a.movesSan.join(" ") || <span className="text-ink-500">—</span>)
                          }</td>
                          <td className="py-2 pr-3 text-[11px] tabular-nums text-ink-400 whitespace-nowrap">
                            {a.firstMoveAt && a.lastMoveAt ? `${Math.round((a.lastMoveAt - a.firstMoveAt)/1000)}s` : "—"}
                          </td>
                          <td className="py-2">
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => mark(a.userId, a.correct === true ? null : true)}
                                disabled={!revealed}
                                title={!revealed ? "Reveal the moves first" : a.correct === true ? "Unmark" : "Mark correct"}
                                className={`grid h-7 w-7 place-items-center rounded-lg text-xs font-bold transition ${a.correct === true ? "bg-emerald-500/70 text-white ring-2 ring-emerald-300" : "bg-ink-800 text-ink-400 hover:bg-emerald-500/20 hover:text-emerald-200"}`}
                              >✓</button>
                              <button
                                onClick={() => mark(a.userId, a.correct === false ? null : false)}
                                disabled={!revealed}
                                title={!revealed ? "Reveal the moves first" : a.correct === false ? "Unmark" : "Mark wrong"}
                                className={`grid h-7 w-7 place-items-center rounded-lg text-xs font-bold transition ${a.correct === false ? "bg-rose-500/70 text-white ring-2 ring-rose-300" : "bg-ink-800 text-ink-400 hover:bg-rose-500/20 hover:text-rose-200"}`}
                              >✗</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Coach-side notices: "X answered", "challenge over". Bottom-left so they
// never sit on the board or the footer controls; auto-dismiss after 5 s.
function CoachNoticeHost() {
  const notices = useCoachNotices();
  useEffect(() => {
    if (!notices.length) return;
    const oldest = notices[0]!;
    const t = setTimeout(() => dismissCoachNotice(oldest.id), Math.max(0, 5000 - (Date.now() - oldest.at)));
    return () => clearTimeout(t);
  }, [notices]);
  if (!notices.length) return null;
  return (
    <div className="pointer-events-none fixed bottom-24 left-3 z-[60] flex w-[min(92vw,22rem)] flex-col gap-2" data-testid="coach-notices">
      {notices.map((n) => (
        <div key={n.id} className={`pointer-events-auto rounded-xl border px-3 py-2 text-sm shadow-2xl backdrop-blur ${n.tone === "success" ? "border-emerald-400/50 bg-emerald-500/20 text-emerald-100" : "border-purple-400/50 bg-purple-500/20 text-purple-100"}`}>
          <div className="flex items-start justify-between gap-2">
            <span>{n.text}</span>
            <button onClick={() => dismissCoachNotice(n.id)} className="text-xs text-ink-300 hover:text-white">✕</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// Toast shown to a student when the coach marks their answer correct/wrong.
// Auto-dismisses in 6 s. Uses `fixed bottom-4` so it never fights with the
// Dream Meet video tiles / footer controls.
function ChallengeMarkToastHost() {
  const t = useChallengeMarkToast();
  useEffect(() => {
    if (!t) return;
    const to = setTimeout(dismissChallengeMarkToast, 6000);
    return () => clearTimeout(to);
  }, [t?.at]);
  if (!t) return null;
  if (t.correct === true) {
    return (
      <div className="fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-3 rounded-full border-2 border-emerald-300 bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-2xl ring-4 ring-emerald-500/30">
        ✅ Coach marked your answer <b>correct</b>
        <button onClick={dismissChallengeMarkToast} className="text-white/70 hover:text-white">✕</button>
      </div>
    );
  }
  if (t.correct === false) {
    return (
      <div className="fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-3 rounded-full border-2 border-rose-300 bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-2xl ring-4 ring-rose-500/30">
        ❌ Coach marked your answer <b>wrong</b>
        <button onClick={dismissChallengeMarkToast} className="text-white/70 hover:text-white">✕</button>
      </div>
    );
  }
  // Unmark (null) — silent (no toast) so the coach adjusting their own
  // marks doesn't spam students.
  return null;
}

// Compute the FEN at (startFen, tree, cursorPath) — used by ChallengeCoachButton
// so the frozen position matches the coach's CURRENT board view (whatever
// they've played on the shared board, not just the tree's starting FEN).
//
// Uses the Chess import at the top of the file (was using `require` which
// silently throws in the browser bundle and fell back to startFen — bug
// filed 2026-09-01: "when challenge is clicked, position reverted to
// starting position for student").
function computeFenAt(startFen: string, tree: SharedTreeNode[], cursorPath: number[]): string {
  try {
    const c = new Chess(startFen);
    let cur: SharedTreeNode[] = tree;
    for (const idx of cursorPath) {
      const n = cur[idx];
      if (!n) break;
      try { c.move({ from: n.move.from, to: n.move.to, promotion: (n.move.promotion as any) || "q" }); }
      catch { break; }
      cur = n.children;
    }
    return c.fen();
  } catch {
    return startFen;
  }
}
