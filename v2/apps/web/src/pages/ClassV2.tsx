// ChessGuru Live (P0) — LiveKit-backed video meeting for a class.
// Flow: user visits /class-v2/<roomName>?role=coach|student → we fetch a
// signed join token from /api/livekit/token → livekit-client SDK connects →
// LiveKit React components render the grid + tracks + controls.
//
// Requires the API to have LIVEKIT_URL / _API_KEY / _API_SECRET envs. Until
// those are set, the page renders a friendly "not configured yet" splash.
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Navigate, useParams, useSearchParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  LiveKitRoom, RoomAudioRenderer, ControlBar,
  GridLayout, ParticipantTile, useTracks, useParticipants,
  useDataChannel, useLocalParticipant, useRoomContext, useIsSpeaking,
} from "@livekit/components-react";
import { Track, DataPacket_Kind, DisconnectReason, RoomEvent, VideoQuality } from "livekit-client";
import "@livekit/components-styles";
import { api, announceGoingLive } from "../lib/api";
import SharedClassBoard, { markClassFeatureUsed, setClassSetupOpen, triggerClassBoardAction, triggerClassFlipOrientation, useClassCursorInfo, useClassLocked, useClassOrientation, triggerClassLockToggle, useClassNotationHidden, triggerClassNotationToggle, useClassMoveList, useClassStartShapes, triggerClassSeek, triggerClassLoadTree, useClassChallenge, triggerClassChallengeStart, triggerClassChallengeEnd, triggerClassChallengeDismiss, useChallengeMarkToast, dismissChallengeMarkToast, challengeTreeToPgn, type SharedTreeNode, type ChallengeAnswerRow , useCoachNotices, dismissCoachNotice, pushCoachNotice, useClassPresence } from "../components/SharedClassBoard";
import ClassRecordButton from "../components/ClassRecordButton";
import { useScreenWakeLock } from "../hooks/useScreenWakeLock";
import { OPENINGS, findOpeningForLine, openingBySlug, type Opening } from "../lib/openings";
import { fetchExplorer, type ExplorerData, type ExplorerMove } from "../lib/explorer";
import { listRepertoire, shareRepertoire, type RepertoireEntry, type RepMoveNode } from "../lib/repertoire-api";
import { Chess } from "chess.js";
import AudiencePickerModal from "../components/AudiencePickerModal";
import { ClassNotationPanel, ClassBoardKeyboardNav, STANDARD_START_FEN } from "../components/ClassNotationPanel";

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
    markClassFeatureUsed("chat");
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
// Raised hands live in ONE module-level store, not in component state.
//
// useHandRaise() used to hold its own useState + its own useDataChannel, and it
// was called TWICE — once by the button, once by the roster. Two independent
// hand lists that never agreed, each fed only by frames that happened to arrive
// while it was mounted, with nothing to re-sync from. A single missed or
// superseded frame dropped a hand for good, and the raise vanished on its own.
// (owner, 2026-09-21: "when raise hand by student clicked it auto hides in 10 sec")
//
// Now: one sink writes the store, every reader subscribes to it, and a student
// with their hand up RE-ANNOUNCES it every few seconds. The re-announce is what
// makes this self-healing — a coach who joins late, refreshes, or misses a
// frame picks the hand up on the next beat instead of never.
const HAND_BEAT_MS = 4_000;
const HAND_STALE_MS = 14_000;          // >3 missed beats before we drop a hand
type HandEntry = { at: number };
let _mineUp = false;             // this participant's own hand, module-level so the sink can re-announce it
const _hands = new Map<string, HandEntry>();
const _handSubs = new Set<() => void>();
function _publishHands() { _handSubs.forEach((f) => f()); }
function _setHand(who: string, up: boolean) {
  if (up) _hands.set(who, { at: Date.now() });
  else _hands.delete(who);
  _publishHands();
}
function _pruneHands() {
  const cut = Date.now() - HAND_STALE_MS;
  let changed = false;
  for (const [who, e] of _hands) if (e.at < cut) { _hands.delete(who); changed = true; }
  if (changed) _publishHands();
}
function useHandsUp(): Set<string> {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((n) => n + 1);
    _handSubs.add(f);
    return () => { _handSubs.delete(f); };
  }, []);
  return new Set(_hands.keys());
}

/** Mounted ONCE. Owns the only cg-hand subscription, prunes stale hands, and
 *  re-announces this participant's own hand so it cannot silently lapse. */
function HandRaiseSink() {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const me = localParticipant?.identity ?? "me";
  const dc = useDataChannel("cg-hand");
  useEffect(() => {
    if (!dc.message) return;
    try {
      const raw = dc.message.payload instanceof Uint8Array ? RX.decode(dc.message.payload) : String(dc.message.payload);
      const f = JSON.parse(raw) as HandFrame;
      if (f?.from) _setHand(String(f.from), !!f.up);
    } catch { /* */ }
  }, [dc.message]);
  useEffect(() => {
    const id = setInterval(() => {
      _pruneHands();
      // Re-announce mine. Cheap (one tiny reliable frame) and it is what lets a
      // late joiner or a missed frame recover on its own.
      if (!_mineUp || !room) return;
      try {
        room.localParticipant.publishData(
          TX.encode(JSON.stringify({ from: me, up: true, ts: Date.now() } as HandFrame)),
          { reliable: true, topic: "cg-hand" },
        );
      } catch { /* */ }
      _setHand(me, true);                      // keep my own entry fresh locally
    }, HAND_BEAT_MS);
    return () => clearInterval(id);
  }, [room, me]);
  return null;
}

function useHandRaise() {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const me = localParticipant?.identity ?? "me";
  const handsUp = useHandsUp();
  const [mineUp, setMineUpState] = useState(_mineUp);
  const toggle = () => {
    const next = !_mineUp;
    _mineUp = next;
    setMineUpState(next);
    // LiveKit does not loop published data back to the sender, so set our own
    // entry directly — otherwise the person raising never appears in the list.
    _setHand(me, next);
    if (next) markClassFeatureUsed("hand");
    if (!room) return;
    try { room.localParticipant.publishData(TX.encode(JSON.stringify({ from: me, up: next, ts: Date.now() } as HandFrame)), { reliable: true, topic: "cg-hand" }); } catch { /* */ }
  };
  return { handsUp, mineUp, toggle };
}

// ═══════════════════════════════════════════════════════════════════════
// Control-row design system  (2026-09-21)
//
// Owner: "lets make coach panel below board professional, build a nice ui".
// The row was 18 emoji-led pills in four competing accent colours. Two rules
// replace that:
//
//   1. ONE ICON LANGUAGE — 16px inline SVG, 1.75 stroke, currentColor.
//      Emoji were carrying this job and the set had COLLISIONS: 📖 meant
//      both "students' moves" and "teach opening"; 🙈 meant both "hide
//      video" and "hide moves". Two controls wearing the same glyph is a
//      bug, not a style choice.
//
//   2. COLOUR MEANS STATE, NEVER DECORATION. Indigo Setup, cyan Teach,
//      purple Challenge and green Send made every action shout at equal
//      volume, so nothing read as important. Actions are now neutral and
//      colour is spent only where the class is in a state the coach must
//      notice at a glance: students unlocked, a hand up, unread chat,
//      video hidden, students' notation hidden.
//
// Everything is one height (h-8) and one radius, so the row reads as a
// toolbar instead of a bag of assorted pills.
// ═══════════════════════════════════════════════════════════════════════
const ICON_PATHS: Record<string, ReactNode> = {
  gauge: <><path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" /><path d="m13.4 10.6 3.6-3.6" /><path d="M20.5 16a9 9 0 1 0-17 0" /></>,
  eyeOff: <><path d="M10.7 5.1A9.9 9.9 0 0 1 12 5c5 0 9 4.5 9 7a12 12 0 0 1-2.2 3.2" /><path d="M6.6 6.6A12.6 12.6 0 0 0 3 12c0 2.5 4 7 9 7a9.7 9.7 0 0 0 4.4-1" /><path d="m3 3 18 18" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>,
  eye: <><path d="M3 12s3.6-7 9-7 9 7 9 7-3.6 7-9 7-9-7-9-7Z" /><circle cx="12" cy="12" r="2.6" /></>,
  hand: <><path d="M9 11V5.5a1.5 1.5 0 1 1 3 0V11" /><path d="M12 11V4.5a1.5 1.5 0 1 1 3 0V11" /><path d="M15 11.5V7a1.5 1.5 0 1 1 3 0v7a6 6 0 0 1-6 6h-1a6 6 0 0 1-5.2-3l-1.5-2.6a1.5 1.5 0 0 1 2.4-1.8L9 15" /><path d="M9 15V8a1.5 1.5 0 1 0-3 0v5" /></>,
  chat: <path d="M20 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2Z" />,
  chevL: <path d="m14.5 6-6 6 6 6" />,
  chevR: <path d="m9.5 6 6 6-6 6" />,
  flip: <><path d="M7 4 4 7l3 3" /><path d="M4 7h11a5 5 0 0 1 5 5" /><path d="m17 20 3-3-3-3" /><path d="M20 17H9a5 5 0 0 1-5-5" /></>,
  lock: <><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" /></>,
  unlock: <><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7a4 4 0 0 1 7.5-2" /></>,
  list: <><path d="M9 6h11" /><path d="M9 12h11" /><path d="M9 18h11" /><path d="M4.5 6h.01" /><path d="M4.5 12h.01" /><path d="M4.5 18h.01" /></>,
  listOff: <><path d="M9 6h11" /><path d="M13 12h7" /><path d="M4.5 6h.01" /><path d="m3 3 18 18" /><path d="M9 18h7" /></>,
  grid: <><rect x="4" y="4" width="7" height="7" rx="1" /><rect x="13" y="4" width="7" height="7" rx="1" /><rect x="4" y="13" width="7" height="7" rx="1" /><rect x="13" y="13" width="7" height="7" rx="1" /></>,
  book: <><path d="M12 7.5v12" /><path d="M12 7.5C12 6 10 4.5 7 4.5H3.5v12H7c3 0 5 1.5 5 3" /><path d="M12 7.5c0-1.5 2-3 5-3h3.5v12H17c-3 0-5 1.5-5 3" /></>,
  reset: <><path d="M4 5v5h5" /><path d="M4.6 14a8 8 0 1 0 .9-5.5L4 10" /></>,
  users: <><circle cx="9.5" cy="8" r="3.2" /><path d="M3.5 20a6 6 0 0 1 12 0" /><path d="M16.5 5.2a3.2 3.2 0 0 1 0 5.9" /><path d="M18 14.6a6 6 0 0 1 3 5.4" /></>,
  target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.6" /><path d="M12 4v2.5" /><path d="M12 17.5V20" /><path d="M4 12h2.5" /><path d="M17.5 12H20" /></>,
  send: <><path d="M12 19V5" /><path d="m5.5 11.5 6.5-6.5 6.5 6.5" /></>,
  mail: <><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="m4 7 8 5.5L20 7" /></>,
};

function Ico({ name, className = "" }: { name: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      className={`h-4 w-4 shrink-0 ${className}`}
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

// One button geometry for the whole row. `tone` is the ONLY thing that
// varies, and it is driven by STATE, not by how exciting the action is.
//   idle   — every action. Neutral, quiet, equal.
//   on     — a deliberate non-default state the coach chose (hidden video,
//            hidden notation). Brand tint: "this is not the default".
//   alert  — the class is in a state that has consequences right now
//            (students can move, a hand is up, chat unread). Amber.
//   danger — destructive, and only on hover, so it never shouts at rest.
type CtlTone = "idle" | "on" | "alert" | "danger";
const CTL_BASE =
  "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium " +
  "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/70 " +
  "disabled:cursor-not-allowed disabled:opacity-40";
const CTL_TONE: Record<CtlTone, string> = {
  idle: "border-ink-700/70 bg-ink-900 text-ink-200 hover:border-ink-600 hover:bg-ink-800 hover:text-white",
  on: "border-brand-500/50 bg-brand-500/15 text-brand-100 hover:bg-brand-500/25",
  alert: "border-amber-500/50 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25",
  danger: "border-ink-700/70 bg-ink-900 text-ink-300 hover:border-rose-500/60 hover:bg-rose-500/15 hover:text-rose-100",
};
function ctl(tone: CtlTone = "idle", extra = ""): string {
  return `${CTL_BASE} ${CTL_TONE[tone]} ${extra}`;
}

function HandRaiseButton() {
  const { mineUp, toggle } = useHandRaise();
  return (
    <button onClick={toggle} aria-pressed={mineUp}
      title={mineUp ? "Lower hand" : "Raise hand"}
      className={ctl(mineUp ? "alert" : "idle")}>
      <Ico name="hand" />
      <span className="hidden sm:inline">{mineUp ? "Hand up" : "Raise hand"}</span>
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

/** Screen share is published by LiveKit's own ControlBar, so there is no click of ours
 *  to hook. Watch the local participant's track instead and report the first time it
 *  goes on — which is also the honest signal: a button press that failed the browser's
 *  permission prompt is not a screen share (owner 2026-09-22). */
function ScreenShareReporter(): null {
  const { localParticipant } = useLocalParticipant();
  const on = !!localParticipant?.isScreenShareEnabled;
  useEffect(() => { if (on) markClassFeatureUsed("screenshare"); }, [on]);
  return null;
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
    markClassFeatureUsed("reaction");
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
    // One segmented unit: the ply counter sits BETWEEN its two arrows, so the
    // three read as a single instrument rather than three loose pills.
    <div className="inline-flex h-8 items-center overflow-hidden rounded-lg border border-ink-700/70 bg-ink-900">
      <button
        onClick={() => triggerClassBoardAction("stepBack")}
        disabled={readOnly || !canBack}
        title={readOnly ? "Only the coach can rewind for the class" : "Previous move (←) — non-destructive; step forward again to return"}
        className="grid h-full w-8 place-items-center text-ink-200 transition-colors hover:bg-ink-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
      >
        <Ico name="chevL" />
      </button>
      <span className="min-w-[3.25rem] border-x border-ink-800 px-1 text-center font-mono text-[11px] tabular-nums text-ink-400">{label}</span>
      <button
        onClick={() => triggerClassBoardAction("stepForward")}
        disabled={readOnly || !canFwd}
        title={readOnly ? "Only the coach can advance for the class" : "Next move (→)"}
        className="grid h-full w-8 place-items-center text-ink-200 transition-colors hover:bg-ink-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
      >
        <Ico name="chevR" />
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
      className={ctl("idle")}
    >
      <Ico name="flip" />
      {isBlack ? "Black view" : "White view"}
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
      aria-pressed={!locked}
      // Locked is the DEFAULT and the safe state, so it stays neutral. The
      // state worth noticing across a room is students being able to move —
      // that is what gets the colour. Previously both states were saturated
      // (rose / emerald), so the row lit up no matter what was true.
      className={ctl(locked ? "idle" : "alert")}
    >
      <Ico name={locked ? "lock" : "unlock"} />
      {locked ? "Students locked" : "Students can move"}
    </button>
  );
}

function ChatToggleButton() {
  const [open, setOpen] = useChatOpen();
  const unread = useChatUnread();
  return (
    <button onClick={() => { setOpen(!open); if (!open) chatMarkRead(); }}
      title={open ? "Close chat" : unread > 0 ? `${unread} unread message${unread === 1 ? "" : "s"}` : "Open chat"}
      aria-pressed={open}
      className={ctl(open ? "on" : unread > 0 ? "alert" : "idle", "relative")}>
      <Ico name="chat" />
      <span className="hidden sm:inline">Chat</span>
      {unread > 0 && !open && (
        <span className="absolute -right-1 -top-1 grid h-5 min-w-[20px] place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white shadow ring-2 ring-ink-900">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </button>
  );
}

// Coach-only: hide the move list on the STUDENTS' screens, so they can't read
// the line ahead (owner ask 2026-09-20). Room-level and persisted server-side,
// so a student who reconnects or joins late still gets it hidden.
function CoachStudentNotationToggle() {
  const hidden = useClassNotationHidden();
  return (
    <button
      onClick={triggerClassNotationToggle}
      title={hidden ? "Students CAN'T see the move list — click to show it" : "Students CAN see the move list — click to hide it"}
      aria-pressed={hidden}
      className={ctl(hidden ? "alert" : "idle")}
    >
      {/* Says what pressing DOES, like the self toggle beside it — not what is
        *  currently true. "Their moves shown" read as a label rather than a
        *  control, so the coach pressed it expecting to show the panel and
        *  hid it instead. Same trap the self toggle already learned.
        *  (owner, 2026-09-21: "their moves shown, to hide students notation
        *  panel") The amber tone still carries the STATE: lit = hidden. */}
      <Ico name={hidden ? "list" : "listOff"} />
      {hidden ? "Show their moves" : "Hide their moves"}
    </button>
  );
}

// Anyone: hide the move list on MY OWN screen. Purely local (localStorage, like
// the video-tiles toggle) — it never touches the room, so a coach hiding their
// own panel does not hide the students'. On a phone this also hands the whole
// column back to the board, which is the cheapest way to get a bigger board.
// Desktop = the move list is a tall sidebar beside the BOARD. Below that it
// rides in the footer beside the CONTROLS instead. Rendering it in one place
// or the other (rather than two copies with `hidden lg:block`) keeps exactly
// ONE ClassNotationPanel mounted, so its effects and scroll handling never
// run twice against the same room.
function useIsDesktopClass(): boolean {
  const [isLg, setIsLg] = useState<boolean>(() => {
    try { return window.matchMedia("(min-width: 1024px)").matches; } catch { return true; }
  });
  useEffect(() => {
    let mq: MediaQueryList;
    try { mq = window.matchMedia("(min-width: 1024px)"); } catch { return; }
    const on = () => setIsLg(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return isLg;
}

const SELF_NOTATION_KEY = "cg-hide-notation-self";
function useSelfNotationHidden(): [boolean, (v: boolean) => void] {
  const [hidden, setHidden] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(SELF_NOTATION_KEY);
      if (saved !== null) return saved === "1";
      // No choice made yet. On a PHONE the move list stacks BELOW the board and
      // takes that height straight off it, which is the whole "board is tiny"
      // complaint — so start hidden there and let the board have the column.
      // Desktop puts it in a side column where it costs the board nothing.
      return typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches;
    } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(SELF_NOTATION_KEY, hidden ? "1" : "0"); } catch { /* private mode */ }
  }, [hidden]);
  return [hidden, setHidden];
}
function SelfNotationToggle({ hidden, onToggle }: { hidden: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      title={hidden ? "Show the move list on my screen" : "Hide the move list on my screen (bigger board)"}
      aria-pressed={hidden}
      className={ctl(hidden ? "on" : "idle")}
    >
      {/* Says what pressing DOES. "My notation" on both states read as a label,
          not a control, so people pressed it to see notation and lost it.
          "my" is explicit because this sits right beside "Hide their moves":
          bare "Hide moves" next to it gave no clue WHOSE list it acts on. */}
      <Ico name={hidden ? "list" : "listOff"} />
      {hidden ? "Show my moves" : "Hide my moves"}
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
// In-class ping for a private message, carried on the LiveKit data channel that
// is already open for class chat. Web push is the ONLY notification today, and it
// cannot reach a coach who is looking at Dream Meet: on iPhone it needs the site
// installed to the Home Screen (a Safari tab is never subscribed at all), and even
// on desktop an OS banner behind a focused class is easy to miss. The message
// itself still goes through /api/messages/send + push — this is purely the "you
// have one" tap on the shoulder, so it carries a PREVIEW, never the thread.
type DmPing = { from: string; preview: string; ts: number };

function MessageCoachButton({ room }: { room: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [coach, setCoach] = useState<{ userId: string | null; name: string | null } | null>(null);
  // `room` above is the CLASS id (a string); this is the LiveKit room object.
  const lkRoom = useRoomContext();
  const { localParticipant } = useLocalParticipant();
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
      // Tap the coach on the shoulder in-class too. Best-effort and deliberately
      // AFTER the send succeeded: the message is already stored and pushed, so a
      // data-channel failure here must never look like a failed send.
      try {
        const who = localParticipant?.name || localParticipant?.identity || "A student";
        lkRoom?.localParticipant.publishData(
          TX.encode(JSON.stringify({ from: who, preview: body.slice(0, 120), ts: Date.now() } satisfies DmPing)),
          { reliable: true, topic: "cg-dm" },
        );
      } catch { /* toast is a bonus — the message itself already landed */ }
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
        className={ctl("idle")}>
        <Ico name="mail" />
        Message coach
      </button>
      {open && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/60 p-4" onClick={() => !sending && setOpen(false)}>
          {/* Themed `ink-*` surfaces, NOT stock Tailwind `slate-*`. In light mode
           *  `html.light .text-white` is remapped to --text-primary (rgb 15 23 42
           *  = #0f172a) so white labels don't vanish on white cards — but `slate`
           *  is not part of the themed palette, so bg-slate-900 stayed #0f172a,
           *  the SAME value. The student's message box rendered its text in
           *  exactly its own background colour and they typed blind. index.css's
           *  exception list (bg-brand/emerald/rose/…) never covered slate. */}
          <div className="w-full max-w-sm rounded-2xl border border-brand-500/40 bg-ink-950 p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
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
                  className="w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-500 focus:border-brand-500 focus:outline-none disabled:opacity-50" />
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

// iOS Safari leaves a <video> PAUSED and never repaints it after the element is
// re-attached — which adaptiveStream does routinely, since it attaches/detaches
// tiles by visibility and drawn size (added 2026-09-19 for "video quality auto
// adjust according to user network"). The coach saw their OWN selfie freeze while
// students still received them perfectly: the track was always healthy, only the
// local element had stopped painting. Toggling the camera fixed it because that
// re-attaches and re-plays — and then it froze again.
//
// The existing rescue in AudioUnblockPrompt only fires on visibilitychange /
// focus / pageshow, so a freeze that happens WITHOUT leaving the tab never healed.
// This watches for it directly: `pause` does not bubble, so we listen in the
// CAPTURE phase, and a slow sweep catches elements that were paused before we
// mounted or that never emit the event. play() on an already-playing element is a
// no-op, so this is cheap and safe to run forever. (owner, 2026-09-20)
function VideoKeepAlive() {
  useEffect(() => {
    const revive = (el: HTMLVideoElement) => {
      // Only elements that still have a live source — a genuinely ended track
      // should stay as it is rather than be poked every few seconds.
      const src = el.srcObject as MediaStream | null;
      if (!src || !src.getVideoTracks().some((t) => t.readyState === "live")) return;
      void el.play().catch(() => { /* autoplay policy — the audio prompt covers that */ });
    };
    const onPause = (e: Event) => {
      const el = e.target as HTMLElement | null;
      if (el instanceof HTMLVideoElement) revive(el);
    };
    // capture: `pause` is not a bubbling event
    document.addEventListener("pause", onPause, true);
    const sweep = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      document.querySelectorAll<HTMLVideoElement>("video").forEach((el) => { if (el.paused) revive(el); });
    }, 4000);
    return () => {
      document.removeEventListener("pause", onPause, true);
      window.clearInterval(sweep);
    };
  }, []);
  return null;
}

// Coach-only: toast when a student sends a private message during the class.
// Listens on the `cg-dm` topic (see DmPing above). Stacks bottom-right so it
// never sits over the board or the footer controls, auto-dismisses after 15s,
// and clicking it opens the thread in a new tab so the class is never left.
// Themed ink-* surfaces only — never stock slate (see the light-mode note on
// the message dialog above).
function CoachDmToastHost({ role }: { role: string }) {
  const dc = useDataChannel("cg-dm");
  const [pings, setPings] = useState<Array<DmPing & { id: string }>>([]);
  useEffect(() => {
    if (role !== "coach" || !dc.message) return;
    try {
      const raw = dc.message.payload instanceof Uint8Array ? RX.decode(dc.message.payload) : String(dc.message.payload);
      const p = JSON.parse(raw) as DmPing;
      if (!p || typeof p.preview !== "string") return;
      const id = `${p.ts}-${Math.random().toString(36).slice(2)}`;
      setPings((prev) => [...prev.slice(-2), { ...p, id }]);   // at most 3 on screen
      setTimeout(() => setPings((prev) => prev.filter((x) => x.id !== id)), 15000);
    } catch { /* ignore a malformed frame */ }
  }, [dc.message, role]);
  if (role !== "coach" || pings.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-24 right-3 z-[75] flex w-[min(20rem,88vw)] flex-col gap-2">
      {pings.map((p) => (
        <div key={p.id}
          className="pointer-events-auto rounded-xl border border-brand-500/50 bg-ink-900 p-3 shadow-2xl ring-1 ring-brand-500/20">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-bold text-brand-200">📩 Private message · {p.from}</div>
              <div className="mt-0.5 break-words text-sm text-ink-100">{p.preview}</div>
            </div>
            <button onClick={() => setPings((prev) => prev.filter((x) => x.id !== p.id))}
              aria-label="Dismiss" className="shrink-0 text-ink-400 hover:text-ink-100">✕</button>
          </div>
          {/* New tab on purpose — a coach mid-class must not navigate away from
           *  Dream Meet to read a message (it would tear down the call). */}
          <a href="/messages" target="_blank" rel="noopener noreferrer"
            className="mt-2 inline-block rounded-lg bg-brand-500 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-400">
            Open Messages ↗
          </a>
        </div>
      ))}
    </div>
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
  const notReaching = useMicNotReaching();
  // Server says the track is muted while this client says live. The speaking
  // pulse below is driven by LOCAL capture and will happily keep bouncing, so
  // it must not be what the coach reads in this state.
  if (isMicrophoneEnabled && notReaching) {
    return (
      <div
        className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/70 bg-amber-500/20 px-2.5 py-1 text-xs font-semibold text-amber-100"
        title="Your microphone is not reaching the server, so students hear nothing even though your mic meter is moving. Click the mic button off and then on."
      >
        ⚠ Not reaching students · click mic off/on
      </div>
    );
  }
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
  const urlRole: "coach" | "student" = sp.get("role") === "coach" ? "coach" : "student";
  const { data: me, isLoading: authLoading } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  // WHO you are decides this, not the link you happened to open.
  //
  // A coach arriving on a bare /class-v2/<room> — or on a SECOND device, where the
  // invite link they had to hand was the student one — was labelled a student:
  // "Leave" instead of "End class", coach controls hidden, while class-ws had
  // already promoted them to coach on the board. Owner, 2026-09-17: "coach should
  // already be coach" / "coach should not be joined as student in second device".
  const { data: myRole } = useQuery({
    queryKey: ["class-my-role", room],
    queryFn: () => get<{ coach: boolean; ended?: boolean }>(`/api/class/${encodeURIComponent(room)}/my-role`),
    enabled: !!room && !!me?.loggedIn,
    staleTime: 60_000,
  });
  const role: "coach" | "student" = (urlRole === "coach" || myRole?.coach === true) ? "coach" : "student";
  const navigate = useNavigate();
  const [endedMsg, setEndedMsg] = useState<string | null>(null);
  // WHY the room closed, so the heading can stop calling every case "Class ended" —
  // a person refused entry was being told the class had finished.
  const [endedKind, setEndedKind] = useState<string | null>(null);
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
  // My OWN move-list preference — local only, never broadcast. Separate from the
  // coach's "hide it for the students" switch below.
  const [selfNotationHidden, setSelfNotationHidden] = useSelfNotationHidden();
  const isDesktopClass = useIsDesktopClass();
  // Students lose the panel when the COACH hides it for them; the coach's own
  // panel is governed purely by their local toggle.
  const classNotationHidden = useClassNotationHidden();
  const hideNotationHere = selfNotationHidden || (role === "student" && classNotationHidden);

  // Coach clicks Leave → tell the server to explicitly END the class:
  //   * wipes the live-now announcement (students don't see a stale link)
  //   * closes the class-ws room + kicks every student socket
  //   * class-ws broadcasts classEnded to every client BEFORE hard-closing
  // Then navigate away. On failure we still leave — server might be down and
  // the coach shouldn't be stuck in the tab.
  // A finished class must not be re-enterable. The live classEnded broadcast only
  // reaches people who are still connected; refresh after it and you load the dead room
  // fresh, see the position frozen where it stopped, and wait for a coach who has moved
  // on. Send students back to the dashboard, where the coach's new class appears.
  // The coach is let through, since reopening one's own finished room is reasonable.
  useEffect(() => {
    if (!myRole?.ended || myRole?.coach) return;
    setEndedKind("ended");
    setEndedMsg("This class has finished. Taking you back to your dashboard…");
    const t = setTimeout(() => navigate("/dashboard"), 2200);
    return () => clearTimeout(t);
  }, [myRole?.ended, myRole?.coach, navigate]);

  const endClass = async () => {
    rejoin.current.leaving = true;   // our own exit — never fight it with a rejoin
    try { await post(`/api/class/${encodeURIComponent(room)}/end`, {}); } catch { /* ignore */ }
    navigate("/class");
  };

  // Student receives classEnded from the class-ws bus — show a soft banner and
  // auto-redirect after a couple seconds so they know WHY they were kicked
  // (otherwise the sudden nav feels like a bug).
  const onClassEnded = (reason: string) => {
    rejoin.current.leaving = true;   // the class is over — stop trying to get back in
    setEndedKind(reason);
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
  // ---- Connection state, reporting only (owner, 2026-09-19) -------------------
  // No retry here, deliberately. The record from 18 Sep shows the media SDK
  // recovering every time it was asked to — once in ~1 s, once in ~17 s — and the
  // board socket already has a heartbeat and unlimited backoff retries. Nothing in
  // the evidence shows either giving up. The one connection that never came back
  // was a device that had gone away, which no retry can reach.
  //
  // What DID cause damage was the silence. Both recoveries were invisible, so the
  // student reloaded the page twice — 42 s after one that had already succeeded —
  // and a reload is far more disruptive than the drop was: it tears the room down
  // and rejoins from scratch. So this only reports, and lets the layers underneath
  // do the work they already do well.
  const presence = useClassPresence();
  const [netState, setNetState] = useState<"live" | "reconnecting" | "lost">("live");
  const rejoin = useRef({ leaving: false });

  // Disconnects that are meant to happen — we left, we were removed, the room is
  // gone, another tab took this identity. Anything else is worth showing.
  const DELIBERATE = new Set<unknown>([
    DisconnectReason.CLIENT_INITIATED,
    DisconnectReason.PARTICIPANT_REMOVED,
    DisconnectReason.ROOM_DELETED,
    DisconnectReason.DUPLICATE_IDENTITY,
  ]);

  // Audience picker — shows on coach entry if no audience has been picked
  // for this class yet (ad-hoc "Start now" rooms + scheduled classes without
  // a batch). Coach can re-open via the footer 🎯 button to change mid-class.
  const [audiencePickerOpen, setAudiencePickerOpen] = useState(false);
  // A BRAND-NEW class carries no audienceKind, and until it has one the room is
  // not really gated — anyone with the link is a candidate. So ask once, up
  // front, and don't allow it to be waved away. A REJOIN skips this entirely:
  // the audience is already set, and re-asking would both nag the coach and
  // re-notify the whole roster on submit. (owner, 2026-09-21)
  const [audienceSettled, setAudienceSettled] = useState(false);
  const audienceQ = useQuery({
    queryKey: ["class-audience-state", room],
    queryFn: () => get<{ audienceKind: string | null; batchStudentIds: string[] | null }>(
      `/api/class/${encodeURIComponent(room)}/audience`),
    enabled: role === "coach",
    staleTime: Infinity,
    retry: false,
  });
  const audienceUnset =
    role === "coach" && !audienceSettled && !!audienceQ.data &&
    !audienceQ.data.audienceKind && !(audienceQ.data.batchStudentIds?.length);
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
          // Only ask WHO when nobody has been chosen yet. The picker used to open on
          // every coach entry, including rejoining a class whose audience was settled
          // long ago — which is precisely what teaches a coach to dismiss it on sight.
          // Dismissing it on a NEW class is what left students unable to see the class
          // at all. Ask once, when the answer is actually missing.
          // (owner, 2026-09-19: "when clicked old class banner, audience need not be
          // selected right")
          try {
            const aud = await get<{ audienceKind?: string | null }>(
              `/api/class/${encodeURIComponent(room)}/audience`);
            if (!cancelled && !aud?.audienceKind) setAudiencePickerOpen(true);
          } catch {
            // Could not read it — ask rather than silently run a class nobody can join.
            if (!cancelled) setAudiencePickerOpen(true);
          }
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
      <div className="flex flex-col rounded-none border-0 bg-ink-900/60 shadow-xl md:rounded-2xl md:border md:border-ink-700 lg:h-[calc(100dvh-3.5rem)] lg:min-h-[560px] lg:overflow-hidden" data-lk-theme="default">
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
          /* Quality that follows the viewer's network and screen, rather than one
           * stream for everybody. The coach was ALREADY publishing several quality
           * layers (simulcast is on by default), but every subscriber join showed
           * AdaptiveStream: false — so nobody ever moved between them. A student on a
           * weak phone connection got the same stream as one on fibre, which is how
           * video ends up stalling and drifting behind the audio.
           *
           * adaptiveStream: each viewer's client picks a layer to match its bandwidth
           *   AND the size the video is actually drawn at. Class tiles are small, so
           *   most students should now pull a much lighter stream. It also pauses
           *   video that is scrolled out of view.
           * dynacast: the publisher stops sending layers nobody is watching, which
           *   gives the coach's upload back. Pointless to send 720p to no one.
           * (owner, 2026-09-19: "video quality auto adjust according to user network")
           */
          options={{ logLevel: 'debug', adaptiveStream: true, dynacast: true }}
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
            if (rejoin.current.leaving) return;
            if (reason !== undefined && DELIBERATE.has(reason)) return;
            // Say it is coming back. The SDK is already trying; the student's job is
            // simply to NOT hit reload while it does.
            setNetState("reconnecting");
          }}
          onConnected={() => {
            // eslint-disable-next-line no-console
            console.log("[ClassV2] LiveKit connected OK");
            setNetState("live");
          }}
          className="flex h-full min-h-0 flex-col"
        >
          {/* Nobody here. A coach cannot see the room from inside it: on 18 Sep one
            * taught an empty room for half an hour and sent a position pack to eight
            * students who had all gone. Only shown once the server has actually told
            * us the count, so an empty room and an unknown one never look alike. */}
          {role === "coach" && presence.knownStudents && presence.students === 0 && (
            <div
              role="status"
              aria-live="polite"
              className="flex shrink-0 flex-wrap items-center justify-center gap-x-2 gap-y-0.5 bg-amber-500/15 px-4 py-1.5 text-xs font-semibold text-amber-200"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              No students in the room.
              <span className="font-normal text-amber-200/70">Anything you send now will wait for them to arrive.</span>
            </div>
          )}
          {/* Connection state. Silent while live; the moment the link drops this is
            * the difference between "my teacher went quiet" and "my internet went",
            * which on 18 Sep nobody could tell apart. */}
          {netState !== "live" && (
            <div
              role="status"
              aria-live="polite"
              className={`flex shrink-0 items-center justify-center gap-2 px-4 py-1.5 text-xs font-semibold ${
                netState === "reconnecting" ? "bg-amber-500/15 text-amber-200" : "bg-rose-500/15 text-rose-200"
              }`}
            >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
              Connection dropped — reconnecting. No need to reload.
            </div>
          )}
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
                  className="shrink-0 whitespace-nowrap rounded-lg bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-rose-500"
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
          <div className="relative flex flex-col bg-ink-950/40 lg:min-h-0 lg:flex-1 lg:overflow-hidden">
            <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
              {/* Board area — self-sizes to the largest square that fits.
               *  overflow-hidden clips any board that tries to grow past the
               *  container. container-type:size gives SharedClassBoard's
               *  cqi/cqb-based sizing an actual box to measure against. */}
              <div
                className="relative flex aspect-square items-center justify-center overflow-hidden p-0 lg:aspect-auto lg:h-auto lg:min-h-0 lg:flex-1 lg:p-2"
                style={{ containerType: 'size' } as any}
              >
              <AudioUnblockPrompt />
              <VideoKeepAlive />
              <MicWakeGuard />
              <MicPublishReconciler room={room} />
              <SharedClassBoard room={room} userId={me?.userId} displayName={me?.username} onClassEnded={onClassEnded} intendedRole={role} />
              {/* Student toast when the coach marks their challenge answer.
               *  Module-level state so this host can live anywhere in the tree. */}
              <ChallengeMarkToastHost />
              <CoachNoticeHost />
              {/* Coach's in-class alert for a student's private message. Inside
               *  LiveKitRoom so useDataChannel has its context; renders fixed,
               *  so its position here in the tree doesn't matter. */}
              <CoachDmToastHost role={role} />
              {endedMsg && (
                <div className="pointer-events-none absolute inset-0 z-40 grid place-items-center bg-ink-950/85 p-6 text-center">
                  <div className="pointer-events-auto space-y-3 rounded-2xl border border-rose-500/50 bg-ink-900 p-6 shadow-2xl">
                    <div className="text-4xl">{endedKind === "not-invited" ? "🔒" : "🏁"}</div>
                    <div className="font-display text-xl text-white">
                      {endedKind === "not-invited" ? "Can't join this class" : "Class ended"}
                    </div>
                    <div className="text-sm text-ink-300">{endedMsg}</div>
                    <div className="text-xs text-ink-500">Redirecting to your dashboard…</div>
                  </div>
                </div>
              )}
              {!hideVideo && <CameraPIPMaybe />}
              <CoachWaitingOverlay room={room} role={role} />
              <HandsRoster />
              {/* One subscription for hands — see HandRaiseSink. */}
              <HandRaiseSink />
              {/* ReactionOverlay + ReactionsBar removed 2026-09-03 (owner:
               *  "remove emoji panel, for coach and students"). Components
               *  left in the file dead for now — sweep in a later cleanup. */}
              <ChatPanelHost />
              {/* Always-mounted chat receiver — feeds the module store so the
               *  toggle badge + toast pop even when the panel is closed. */}
              <ChatSink />
              <ChatToastStack />
              {role === "coach" && (audiencePickerOpen || audienceUnset) && (
                <AudiencePickerModal
                  room={room}
                  // Mandatory only when this is the new-class prompt. Opened by
                  // hand from 🎯 Students it stays dismissible — the coach may
                  // just be checking, and submitting re-notifies everyone.
                  required={audienceUnset && !audiencePickerOpen}
                  onClose={() => setAudiencePickerOpen(false)}
                  onDone={(r) => {
                    setAudiencePickerOpen(false);
                    setAudienceSettled(true);
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
              {/* Arrow-key nav is mounted UNCONDITIONALLY, outside the panel's
               *  render guard. Hiding the move list must not take the coach's
               *  keyboard away — that coach is the one who needs it most. */}
              <ClassBoardKeyboardNav role={role} />
              {!hideNotationHere && isDesktopClass && (
                <div className="shrink-0 lg:h-auto lg:w-[360px] lg:border-l lg:border-ink-800">
                  <ClassNotationPanel room={room} role={role} />
                </div>
              )}
            </div>

            {/* Controls footer — mic / cam / screen + hand / chat / reactions,
             *  sits UNDER the board so nothing overlaps pieces. */}
            {/* MOBILE = a scrolling page, not a fixed shell, and the board slot is
             *  SQUARE (aspect-square) rather than a tall box.
             *
             *  A chess board is square, so on a portrait phone the largest it can be
             *  is the screen WIDTH. A tall slot centred that square in ~730px and
             *  left ~180px of empty ground above and below it — "gray area is
             *  unnecessary" (owner, 2026-09-21). Sizing the slot to the board means
             *  the space below the board is controls, not emptiness, and the page
             *  scrolls only as far as there is real content.
             *
             *  From lg up nothing changes: fixed-height shell, flex-sized board.
             *
             *  This footer WRAPS on purpose. Two earlier attempts of mine, both
             *  reported within hours:
             *    1. a min-height floor on the board slot, while the shell was still
             *       fixed-height with overflow-hidden and the siblings shrink-0 —
             *       it pushed this whole row past the bottom edge, clipped away.
             *    2. one horizontally-scrollable row — controls present but off-screen
             *       to the right, which mid-class is the same as gone. */}
            <div className="shrink-0 border-t border-ink-800 bg-ink-900/70 px-4 py-2">
              {/* Below lg the move list rides HERE, beside the controls, rather
               *  than in a band of its own between the board and this row
               *  (owner, 2026-09-21: "panel for coach next to the buttons").
               *  On a phone there is no room to sit beside anything, so it
               *  takes the full width directly above them instead. */}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
              <div className="min-w-0 sm:flex-1">
              {/* Grouped by WHAT EACH CONTROL ACTS ON: the call, the board, the class.
               *  Eighteen identical pills in one undifferentiated row meant a coach had
               *  to read every label to find one, mid-lesson.
               *
               *  The clusters are `display: contents` + hairline separators, NOT three
               *  bordered boxes. A box is an atomic flex item, so each cluster forced its
               *  own row: measured at 1280x800 that was 159px of footer against 97px flat
               *  — and from lg up the shell is fixed-height with the board on flex-1, so
               *  those 62px come straight out of the board. `contents` lets the children
               *  wrap in the parent's flow, so the grouping reads without costing a row.
               *
               *  No cluster labels either: they would cost vertical space on a phone,
               *  which is the thing we keep fighting for. */}
              <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-2">
                {/* ── the call: you, your devices, and talking to the room ── */}
                <div className="contents">
                  <div className="rounded-lg border border-ink-800 bg-ink-900 shadow">
                    <ControlBar variation="minimal" controls={{ microphone: true, camera: true, screenShare: true, chat: false, leave: false }} />
                    {/* renders nothing — reports screen share to the class log */}
                    <ScreenShareReporter />
                  </div>
                  {/* Quality lives with the other media controls rather than the header.
                    * It was briefly in the header and pushed "End class" off the edge on a
                    * phone, so the coach could not end a class at all. Hiding it on mobile
                    * would have solved that by taking the control away from exactly the
                    * people most likely to need it — someone on a phone on mobile data.
                    * This row wraps, so nothing gets squeezed out. (owner, 2026-09-19) */}
                  <VideoQualityPicker />
                  <button
                    onClick={() => setHideVideo(v => !v)}
                    title={hideVideo ? "Show video tiles" : "Hide video tiles (audio-only view)"}
                    aria-pressed={hideVideo}
                    className={ctl(hideVideo ? "on" : "idle")}
                  >
                    <Ico name={hideVideo ? "eye" : "eyeOff"} />
                    {hideVideo ? "Show video" : "Hide video"}
                  </button>
                  {/* Students only. The coach runs the class — there is nobody
                    *  for them to raise a hand to. (owner, 2026-09-21) */}
                  {role === "student" && <HandRaiseButton />}
                  <ChatToggleButton />
                  {/* 📩 Private DM to the coach — student-only. Opens a small
                   *  dialog to send one message; coach receives the standard
                   *  chat push notification + can reply from /messages. Owner
                   *  ask 2026-09-03: 'need option for students to private
                   *  message coach during dream meet'. */}
                  {role === "student" && <MessageCoachButton room={room} />}
                </div>

                <div aria-hidden="true" className="h-7 w-px self-center bg-ink-700" />
                {/* ── the board: what everyone is looking at ──────────────── */}
                <div className="contents">
                  <CoachBoardNav readOnly={role !== "coach"} />
                  {role === "coach" && <CoachFlipToggle />}
                  {role === "coach" && <CoachLockToggle />}
                  {/* Two SEPARATE notation toggles: the first hides it on the
                   *  students screens (broadcast), the second only on mine (local). */}
                  {role === "coach" && <CoachStudentNotationToggle />}
                  <SelfNotationToggle hidden={selfNotationHidden} onToggle={() => setSelfNotationHidden(!selfNotationHidden)} />
                  {role === "coach" && (
                    <button
                      onClick={() => setClassSetupOpen(true)}
                      title="Set up any chess position (paste FEN, empty board, or Board Editor)"
                      className={ctl("idle")}
                    >
                      <Ico name="grid" />
                      Set position
                    </button>
                  )}
                  {role === "coach" && (
                    <button
                      onClick={() => setTeachOpen(true)}
                      title="Load an opening from your Repertoire / the corpus / master games at this position"
                      className={ctl("idle")}
                    >
                      <Ico name="book" />
                      Teach opening
                    </button>
                  )}
                  {role === "coach" && (
                    <button
                      onClick={() => { if (confirm("Reset board to the starting position for everyone?")) triggerClassBoardAction("reset"); }}
                      title="Reset board to the starting position (destructive — clears the move list for everyone)"
                      className={ctl("danger")}
                    >
                      <Ico name="reset" />
                      Reset
                    </button>
                  )}
                </div>

                {role === "coach" && <div aria-hidden="true" className="h-7 w-px self-center bg-ink-700" />}
                {/* ── the class: the students, and what you ask of them ───── */}
                {/* Coach-only as a WHOLE — every control inside is coach-only, so
                 *  without this guard a student saw an empty bordered pill. */}
                {role === "coach" && (
                  <div className="contents">
                    <button
                      onClick={() => setAudiencePickerOpen(true)}
                      title="Change which students can join this class + who gets notified"
                      className={ctl("idle")}
                    >
                      <Ico name="users" />
                      Students
                    </button>
                    <ChallengeCoachButton />
                    {/* Recording is coach-initiated and visibly so: a lesson full
                      * of children is not something to start capturing quietly. */}
                    <ClassRecordButton room={room} />
                    <button
                      onClick={() => setSendPositionOpen(true)}
                      title="Send the current board (with move list) to students' Notebook"
                      className={ctl("idle")}
                    >
                      <Ico name="send" />
                      Send position
                    </button>
                  </div>
                )}
              </div>
              </div>
              {!hideNotationHere && !isDesktopClass && (
                <div className="order-first w-full shrink-0 overflow-hidden rounded-lg border border-ink-800 sm:order-none sm:w-[16rem]">
                  <ClassNotationPanel room={room} role={role} />
                </div>
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
          className={ctl("idle")}
        >
          <Ico name="target" />
          Challenge
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
  // Opens by itself the moment a challenge ends — the coach pressed End or the
  // timer ran out. This component only mounts once challenge.active is false,
  // so mounting IS the end of the challenge.
  //
  // That reverses the 2026-09-08 rule ("never opens on its own": the coach's
  // screen is shared with the class, so an auto-revealed answer list gave the
  // solution away). Safe now for the reason the owner gave on 2026-09-21 —
  // "open the challenge answer panel in coach, because answers are hidden
  // already": the panel opens with revealed=false, so a shared screen shows
  // WHO answered and how many, never WHAT they played. The moves stay behind
  // Reveal, which is still a deliberate press by the coach.
  //
  // revealed is forced back to false alongside it, so a reveal can never carry
  // over from the previous challenge into the new one's panel.
  const [open, setOpen] = useState(true);
  const [revealed, setRevealed] = useState(false);
  useEffect(() => { setRevealed(false); setOpen(true); }, [challenge.startedAt]);
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
        <div key={n.id} className={`pointer-events-auto rounded-xl border px-3 py-2 text-sm shadow-2xl backdrop-blur ${n.tone === "success" ? "border-emerald-400/50 bg-emerald-500/20 text-emerald-100" : n.tone === "warn" ? "border-amber-400/50 bg-amber-500/20 text-amber-100" : "border-purple-400/50 bg-purple-500/20 text-purple-100"}`}>
          <div className="flex items-start justify-between gap-2">
            <span>{n.text}</span>
            <button onClick={() => dismissCoachNotice(n.id)} className="text-xs text-ink-300 hover:text-white">✕</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// Manual quality override. Auto (adaptiveStream) is right for almost everyone, but it
// reacts to conditions rather than predicting them, and on a bad day a student would
// rather pin the picture low and keep the sound than watch it climb and stall. The
// choice is remembered per device, because the phone that struggles today will
// struggle tomorrow. (owner, 2026-09-19: "or select quality option")
const QUALITY_KEY = "cg-video-quality";
type QualityPref = "auto" | "high" | "medium" | "low";

function VideoQualityPicker() {
  const room = useRoomContext();
  const [pref, setPref] = useState<QualityPref>(() => {
    try { return ((localStorage.getItem(QUALITY_KEY) as QualityPref) || "auto"); } catch { return "auto"; }
  });

  useEffect(() => {
    try { localStorage.setItem(QUALITY_KEY, pref); } catch { /* private mode */ }
    if (!room) return;
    const apply = () => {
      if (pref === "auto") return;   // leave it to adaptiveStream
      const q = pref === "high" ? VideoQuality.HIGH : pref === "medium" ? VideoQuality.MEDIUM : VideoQuality.LOW;
      room.remoteParticipants.forEach((rp) => {
        rp.videoTrackPublications.forEach((pub) => {
          try { pub.setVideoQuality(q); } catch { /* not subscribed yet */ }
        });
      });
    };
    apply();
    // Re-apply for anyone who joins or republishes after the choice was made.
    room.on(RoomEvent.TrackSubscribed, apply);
    room.on(RoomEvent.ParticipantConnected, apply);
    return () => {
      room.off(RoomEvent.TrackSubscribed, apply);
      room.off(RoomEvent.ParticipantConnected, apply);
    };
  }, [room, pref]);

  return (
    <select
      value={pref}
      onChange={(e) => setPref(e.target.value as QualityPref)}
      aria-label="Video quality"
      title="Video quality — Auto follows your connection"
      className="h-8 rounded-lg border border-ink-700/70 bg-ink-900 px-2 text-[13px] font-medium text-ink-200 outline-none transition-colors hover:border-ink-600 hover:bg-ink-800 hover:text-white focus-visible:ring-2 focus-visible:ring-brand-400/70"
    >
      <option value="auto">Auto</option>
      <option value="high">High</option>
      <option value="medium">Medium</option>
      <option value="low">Low (save data)</option>
    </select>
  );
}

// The mirror of the playback problem, and the half the tab-wake fix did not cover.
// Backgrounding a tab can suspend MICROPHONE CAPTURE as well as playback, especially on
// phones. The publication stays up and nothing looks wrong, but the underlying capture
// track has ended or gone browser-muted, so an unmuted student goes silent to the coach
// with no warning on either screen. Playback resuming does not fix this: the sound is
// not arriving to begin with.
//
// On wake, re-acquire the microphone ONLY if the person meant to be unmuted. A
// deliberate mute is left strictly alone — silently switching someone's mic back on
// because they changed tabs would be far worse than the bug. (owner, 2026-09-19)
// The SFU is the only thing that knows whether the class can actually hear you.
//
// A publisher's own client can believe its microphone is live while the server
// holds the track muted — a mic re-acquire that fails between its mute and its
// unmute halves leaves exactly that state. Everything local then lies in the
// same direction: the button reads unmuted, the level meter moves off the local
// capture, the status pill pulses. The room hears silence, and a student
// refreshing does not help, because nothing is being published to subscribe to.
//
// So: when this client thinks the mic is ON, ask the server what it sees. If the
// server says muted, force one clean mute/unmute round-trip to re-signal.
//
// Safety: this only ever runs when the local state is ALREADY unmuted, and it
// only ever ends unmuted. It can never switch on a mic somebody muted on
// purpose — a deliberate mute makes isMicrophoneEnabled false and we never ask.
// A null answer means "cannot tell" and is left alone. (owner, 2026-09-21)
// Shared so the header pill can stop lying. The coach's mic meter runs off
// their LOCAL capture, so it keeps pulsing while the SFU carries nothing —
// which is precisely why this bug survived so long: every indicator on the
// coach's own screen agreed that everything was fine.
let micNotReaching = false;
const micReachSubs = new Set<() => void>();
function setMicNotReaching(v: boolean): void {
  if (micNotReaching === v) return;
  micNotReaching = v;
  micReachSubs.forEach((f) => f());
}
function useMicNotReaching(): boolean {
  const [v, setV] = useState(micNotReaching);
  useEffect(() => {
    const f = () => setV(micNotReaching);
    micReachSubs.add(f); f();
    return () => { micReachSubs.delete(f); };
  }, []);
  return v;
}

function MicPublishReconciler({ room }: { room: string }) {
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  const busyRef = useRef(false);
  const micOnRef = useRef(isMicrophoneEnabled);
  micOnRef.current = isMicrophoneEnabled;
  useEffect(() => {
    if (!localParticipant) return;
    let stop = false;
    const tick = async () => {
      if (stop || busyRef.current) return;
      if (!micOnRef.current) return;                      // muted on purpose — never touch
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      let state: { muted: boolean } | null = null;
      try {
        const r = await get<{ ok: boolean; state: { muted: boolean; trackSid: string } | null }>(
          `/api/livekit/mic-state?room=${encodeURIComponent(room)}`,
        );
        state = r?.state ?? null;
      } catch { return; }                                  // network blip — no opinion
      if (stop || !state) return;                          // cannot tell — no opinion
      if (!state.muted) { setMicNotReaching(false); return; }   // server agrees: we are live
      if (!micOnRef.current) return;                       // coach muted while we asked
      busyRef.current = true;
      try {
        // eslint-disable-next-line no-console
        console.warn("[ClassV2] mic desync: server has the track muted while this client says live — re-signalling");
        await localParticipant.setMicrophoneEnabled(false);
        await localParticipant.setMicrophoneEnabled(true);
        const stillMuted = !!localParticipant.getTrackPublication(Track.Source.Microphone)?.isMuted;
        setMicNotReaching(stillMuted);
        if (stillMuted) pushCoachNotice("⚠ Your mic is not reaching students. Click the mic button off and on.", "warn");
      } catch {
        setMicNotReaching(true);
        pushCoachNotice("⚠ Your mic is not reaching students. Click the mic button off and on.", "warn");
      } finally {
        busyRef.current = false;
      }
    };
    const id = setInterval(() => { void tick(); }, 8000);
    const t0 = setTimeout(() => { void tick(); }, 4000);
    return () => { stop = true; clearInterval(id); clearTimeout(t0); };
  }, [localParticipant, room]);
  return null;
}

function MicWakeGuard() {
  const { localParticipant } = useLocalParticipant();
  // One re-acquire at a time. Two overlapping cycles are how the mic ends up
  // stuck muted: cycle A mutes, cycle B mutes again and fails to restore.
  const busyRef = useRef(false);
  useEffect(() => {
    if (!localParticipant) return;
    const check = () => {
      if (typeof document === "undefined" || document.visibilityState !== "visible") return;
      const pub = localParticipant.getTrackPublication(Track.Source.Microphone);
      if (!pub || pub.isMuted) return;                 // never on; or muted on purpose
      const mst = pub.track?.mediaStreamTrack;
      if (!mst) return;
      if (mst.readyState === "live" && !mst.muted) return;   // capture is healthy
      // Capture was suspended or ended while hidden — take it again.
      //
      // THIS PAIR IS ATOMIC OR IT IS A BUG. The first call mutes the track on the
      // SERVER; the second is what brings it back. If the second one threw — device
      // still busy, or it raced the coach unmuting by hand — the old code swallowed
      // it and walked away, leaving the participant MUTED on the SFU while their own
      // UI happily said "live" and the mic meter still moved off the local capture.
      // Students heard nothing, and refreshing did not help them, because there was
      // genuinely nothing being published. It stayed that way until the coach
      // toggled by hand. (owner, 2026-09-21: "coach muted for some time, and unmute
      // and speak, students cant hear ... coach mic pulse works" / "even student
      // refreshed the page, still cant hear")
      //
      // So: never run two cycles at once, and never exit this function with the mic
      // muted when we entered it intending to keep the coach live.
      if (busyRef.current) return;
      busyRef.current = true;
      void (async () => {
        const micOn = () => !localParticipant.getTrackPublication(Track.Source.Microphone)?.isMuted;
        try {
          try {
            await localParticipant.setMicrophoneEnabled(false);
            await localParticipant.setMicrophoneEnabled(true);
          } catch { /* fall through to the retries below */ }
          // Verify, don't assume. setMicrophoneEnabled can resolve with the
          // publication still muted, and it can throw after the mute half landed.
          for (let i = 0; i < 4 && !micOn(); i++) {
            await new Promise((r) => setTimeout(r, 600 * (i + 1)));
            try { await localParticipant.setMicrophoneEnabled(true); } catch { /* keep trying */ }
          }
          if (!micOn()) {
            // Out of retries. The coach MUST be told, because every local signal
            // they have says they are being heard.
            pushCoachNotice("⚠ Your mic did not come back after the screen woke — students cannot hear you. Click the mic button off and on.", "warn");
          }
        } finally {
          busyRef.current = false;
        }
      })();
    };
    // A beat after wake: the browser often restores capture on its own, and racing it
    // would tear down a track that was about to come back by itself.
    const wake = () => { setTimeout(check, 1200); };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    return () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
    };
  }, [localParticipant]);
  return null;
}

// Browsers refuse to play sound until the person has interacted with the page, and
// they re-arm that block on EVERY page load. The app never called startAudio(), so a
// student whose browser had blocked playback simply heard nothing, with no explanation
// and no control to fix it — and refreshing made it worse, because each reload put the
// block back. This is the cause of the recurring "can't hear the coach" reports; the
// coach's microphone was publishing fine every time I checked. (owner, 2026-09-19)
function AudioUnblockPrompt() {
  const room = useRoomContext();
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    if (!room) return;
    const sync = () => setBlocked(!room.canPlaybackAudio);
    sync();
    room.on(RoomEvent.AudioPlaybackStatusChanged, sync);
    return () => { room.off(RoomEvent.AudioPlaybackStatusChanged, sync); };
  }, [room]);

  // The browser re-arms its block on EVERY page load, so this button reappears after
  // each refresh — which is correct, but it should rarely need a deliberate tap. Any
  // real interaction counts as the gesture the browser wants, so the first click,
  // key or touch ANYWHERE releases the sound and the button disappears on its own.
  // It stays as the visible fallback for someone who has not touched anything yet.
  // (owner, 2026-09-19: "every time tab refreshed then")
  useEffect(() => {
    if (!room || !blocked) return;
    const release = () => { void room.startAudio().catch(() => {}); };
    const opts = { capture: true, passive: true } as AddEventListenerOptions;
    document.addEventListener("pointerdown", release, opts);
    document.addEventListener("keydown", release, opts);
    document.addEventListener("touchstart", release, opts);
    return () => {
      document.removeEventListener("pointerdown", release, opts);
      document.removeEventListener("keydown", release, opts);
      document.removeEventListener("touchstart", release, opts);
    };
  }, [room, blocked]);

  // Coming back from another tab left the class dead until a refresh: no video, no
  // sound, and a board whose pieces had not moved. Browsers suspend a hidden tab's
  // media, and nothing here ever told it to resume — so the elements stayed paused
  // while the connection underneath was perfectly healthy. A tap did not help either,
  // because a tap lifts the browser's autoplay POLICY; it does not restart an element
  // that is already paused. Only a reload rebuilt them, which is exactly what the
  // owner found. (owner, 2026-09-19)
  useEffect(() => {
    const resume = () => {
      if (typeof document === "undefined" || document.visibilityState !== "visible") return;
      // startAudio() only succeeds inside a real user gesture. A visibility change is
      // NOT one, so after a long spell in another tab this quietly fails — which is
      // why the owner found that only "refresh AND tap" recovered the sound.
      void room?.startAudio().catch(() => {});
      document.querySelectorAll<HTMLMediaElement>("video, audio").forEach((el) => {
        if (el.paused) void el.play().catch(() => {});
      });
      // So CHECK afterwards instead of assuming. The room can still report audio as
      // playable while its elements sit paused, in which case canPlaybackAudio alone
      // never raises the button and the student is stuck with no way out. If anything
      // is still silent a moment later, surface the button regardless — one tap is a
      // gesture, and that is the only thing the browser will accept.
      window.setTimeout(() => {
        if (document.visibilityState !== "visible") return;
        const stuck = Array.from(document.querySelectorAll<HTMLMediaElement>("audio"))
          .some((el) => el.paused);
        if (stuck || (room && !room.canPlaybackAudio)) setBlocked(true);
      }, 700);
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);   // bfcache restore
    return () => {
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
    };
  }, [room]);
  if (!blocked) return null;
  return (
    // Sits directly above the board, where the eye already is. A thin strip in the
    // header was missable, and a student who cannot hear has no idea why — so this is
    // deliberately large and unmissable, and disappears the instant sound is allowed.
    // ABSOLUTELY positioned on purpose. As a normal block above the board it took up
    // layout space, and because the board sizes itself from its container, the button
    // appearing or disappearing resized the column and made the board visibly redraw
    // every time — the browser can flip the audio-blocked state more than once, so the
    // board kept snapping (owner, 2026-09-19: "every time board refreshed"). Floating
    // it over the board means showing and hiding it costs the board nothing.
    <div className="pointer-events-none absolute inset-x-2 top-2 z-30">
      <button
        onClick={() => { void room?.startAudio().catch(() => {}); }}
        className="pointer-events-auto flex w-full items-center justify-center gap-3 rounded-xl bg-brand-600 px-4 py-4 text-base font-bold text-white shadow-2xl ring-2 ring-brand-400/60 hover:bg-brand-500 active:scale-[0.99] sm:text-lg"
      >
        <span className="text-2xl">🔊</span>
        <span>Tap to turn on sound</span>
      </button>
      <div className="mt-1 rounded-lg bg-ink-900/80 px-2 py-0.5 text-center text-xs text-ink-200 backdrop-blur">
        Your browser blocks sound until you tap. One tap and you will hear the class.
      </div>
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
