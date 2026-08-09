import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext, useParams, useNavigate, Link } from "react-router-dom";
import { Chess } from "chess.js";
import type { Key } from "chessground/types";
import type { DrawShape } from "chessground/draw";
import Board, { destsFromChess } from "../components/Board";

// Board-sync WebSocket URL. `VITE_API_BASE` is /v2api in production, "" in dev — either
// way we upgrade against the same origin so the cookie / same-site rules apply.
function classWsUrl(roomId: string): string {
  const base = (import.meta.env.VITE_API_BASE ?? "").toString();
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host;
  return `${proto}//${host}${base}/class-ws/${encodeURIComponent(roomId)}`;
}

// Recording API path — same VITE_API_BASE prefix + /api/class/:id/... routes.
function classApiPath(roomId: string, suffix = ""): string {
  const base = (import.meta.env.VITE_API_BASE ?? "").toString();
  return `${base}/api/class/${encodeURIComponent(roomId)}${suffix}`;
}
type Recording = { name: string; bytes: number; createdAt: string };

// Human-friendly size + duration formatters for the recordings list.
function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

type WsMove = { from: string; to: string; promotion?: string };
type WsShape = { orig: string; dest?: string; brush?: string };
type Role = "coach" | "student";
type WsFrame =
  | { type: "role"; role: Role; coachToken?: string }
  | { type: "state"; fen: string; lastMove: WsMove | null; history: WsMove[]; participants: number; locked: boolean; shapes: WsShape[] }
  | { type: "move"; move: WsMove; fen: string; participants: number; locked: boolean }
  | { type: "reset"; fen: string; participants: number; locked: boolean }
  | { type: "lock"; locked: boolean; participants: number }
  | { type: "annot"; shapes: WsShape[]; participants: number }
  | { type: "participants"; participants: number }
  | { type: "pong" };

// Coach token lives in sessionStorage keyed by class id — survives reloads within the
// same tab, dies when the tab closes (safer than localStorage: no permanent claim on
// a class URL). Any tab that has the token is coach on reconnect.
const COACH_KEY_PREFIX = "cg_class_coach_";
const loadCoachToken = (roomId: string): string | undefined => {
  try { return sessionStorage.getItem(COACH_KEY_PREFIX + roomId) ?? undefined; } catch { return undefined; }
};
const saveCoachToken = (roomId: string, tok: string): void => {
  try { sessionStorage.setItem(COACH_KEY_PREFIX + roomId, tok); } catch { /* */ }
};

// Bridges the class-ws bus into React. Returns the authoritative board state plus
// helpers to publish moves/reset/lock/takeback. Reconnects on transient drops with a
// small backoff so a laptop lid-close doesn't kill the session permanently.
// `identity` gets sent on every hello so the server can record attendance and the
// coach can see who came to their class.
function useClassSync(roomId: string | undefined, identity?: { userId?: string; displayName?: string }) {
  const [fen, setFen] = useState(new Chess().fen());
  const [lastMove, setLastMove] = useState<WsMove | null>(null);
  const [participants, setParticipants] = useState(1);
  const [connected, setConnected] = useState(false);
  const [role, setRole] = useState<Role>("student");
  const [locked, setLocked] = useState(false);
  const [shapes, setShapes] = useState<WsShape[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;

    const connect = () => {
      const ws = new WebSocket(classWsUrl(roomId));
      wsRef.current = ws;
      ws.onopen = () => {
        retryRef.current = 0; setConnected(true);
        // Hello with our saved coach token (if any) so a reconnect resumes coach role,
        // plus the caller's identity so the server can record attendance.
        try { ws.send(JSON.stringify({
          type: "hello",
          coachToken: loadCoachToken(roomId),
          userId: identity?.userId,
          displayName: identity?.displayName,
        })); } catch { /* */ }
      };
      ws.onmessage = (ev) => {
        let f: WsFrame; try { f = JSON.parse(ev.data); } catch { return; }
        if (f.type === "role") {
          setRole(f.role);
          if (f.role === "coach" && f.coachToken) saveCoachToken(roomId, f.coachToken);
          return;
        }
        if (f.type === "state") {
          setFen(f.fen); setLastMove(f.lastMove); setParticipants(f.participants); setLocked(f.locked); setShapes(f.shapes ?? []);
        } else if (f.type === "move") {
          setFen(f.fen); setLastMove(f.move); setParticipants(f.participants); setLocked(f.locked);
        } else if (f.type === "reset") {
          setFen(f.fen); setLastMove(null); setParticipants(f.participants); setLocked(f.locked);
        } else if (f.type === "lock") {
          setLocked(f.locked); setParticipants(f.participants);
        } else if (f.type === "annot") {
          setShapes(f.shapes ?? []); setParticipants(f.participants);
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
    // identity intentionally omitted from deps — first hello locks it for the
    // connection; changing username mid-class would force a reconnect, which is
    // more disruptive than the theoretical benefit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  const send = (payload: unknown) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify(payload)); } catch { /* */ }
  };
  const sendMove     = useCallback((mv: WsMove) => send({ type: "move", move: mv }), []);
  const sendReset    = useCallback(() => send({ type: "reset" }), []);
  const sendLock     = useCallback((v: boolean) => send({ type: "lock", locked: v }), []);
  const sendTakeback = useCallback(() => send({ type: "takeback" }), []);
  const sendAnnot    = useCallback((s: WsShape[]) => send({ type: "annot", shapes: s }), []);

  return { fen, lastMove, participants, connected, role, locked, shapes,
           sendMove, sendReset, sendLock, sendTakeback, sendAnnot };
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

// Aggregated attendee row — matches ClassAttendanceController.coachStudents()'s response.
type CoachStudent = { userId: string | null; email?: string | null; name: string; classesAttended: number; firstSeen: string; lastSeen: string };

// "How long ago" tag used across the landing (attendance rows and now the
// students roster). Compact: "5m", "3d", "2mo" — no need to be exact.
function shortAgo(iso?: string): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  if (ms < 30 * 86_400_000) return `${Math.round(ms / 86_400_000)}d ago`;
  return `${Math.round(ms / (30 * 86_400_000))}mo ago`;
}

// Roster `key` matches the class-ws.ts convention — userId when signed in,
// else "guest:<name>". Used as the lookup key for the per-student history modal.
function keyOf(s: { userId: string | null; name: string }): string {
  return s.userId ? s.userId : `guest:${s.name || "Guest"}`;
}

type StudentEntry = { classId: string; title: string; startAt: string; joinedAt: string; lastSeenAt?: string };
type StudentMail  = { at: string; subject: string; kind: string; classId: string | null; body?: string | null; status?: string };

// Compact "delivered / bounced / …" pill, coloured for the eye. Falls back to
// a neutral "sent" tag for older rows that pre-date the delivery-status webhook.
function statusPill(status?: string): { label: string; className: string } {
  switch (status) {
    case "delivered":   return { label: "✓ delivered",  className: "bg-emerald-500/15 text-emerald-200 border-emerald-500/30" };
    case "opened":      return { label: "👁 opened",     className: "bg-cyan-500/15 text-cyan-200 border-cyan-500/30" };
    case "clicked":     return { label: "🖱 clicked",    className: "bg-cyan-500/15 text-cyan-200 border-cyan-500/30" };
    case "bounced":     return { label: "⚠ bounced",    className: "bg-rose-500/15 text-rose-200 border-rose-500/30" };
    case "complained":  return { label: "🚫 spam",      className: "bg-rose-500/20 text-rose-100 border-rose-500/40" };
    case "delayed":     return { label: "⏳ delayed",    className: "bg-amber-500/15 text-amber-200 border-amber-500/30" };
    case "send-failed": return { label: "✕ failed",     className: "bg-rose-500/15 text-rose-200 border-rose-500/30" };
    default:            return { label: "sent",         className: "bg-ink-700/50 text-ink-300 border-ink-600" };
  }
}

// Modal: per-student attendance history + recent mail log. Fetched on open —
// classes the student joined + emails coach has sent them (ad-hoc + reminders).
function StudentHistoryModal({ student, onClose }: { student: CoachStudent; onClose: () => void }) {
  const [entries, setEntries] = useState<StudentEntry[] | null>(null);
  const [mail, setMail] = useState<StudentMail[]>([]);
  // Local compose state. Two entry points: the "Email this student" button
  // (blank prefill) and clicking any adhoc log row (prefilled from that row).
  const [compose, setCompose] = useState<{ subject: string; body: string } | null>(null);
  const canEmail = !!student.email;
  useEffect(() => {
    let cancelled = false;
    const key = keyOf(student);
    fetch(`${(import.meta.env.VITE_API_BASE ?? "").toString()}/api/class/coach/students/history?key=${encodeURIComponent(key)}`,
          { credentials: "include" })
      .then((r) => r.ok ? r.json() : { entries: [], mail: [] })
      .then((j) => { if (!cancelled) { setEntries(j.entries ?? []); setMail(j.mail ?? []); } })
      .catch(() => { if (!cancelled) { setEntries([]); setMail([]); } });
    return () => { cancelled = true; };
  }, [student]);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
           className="w-full max-w-lg space-y-3 rounded-xl2 border border-brand-500/40 bg-gradient-to-br from-brand-500/10 via-ink-900 to-ink-900 p-5 shadow-2xl">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-ink-500">Student history</div>
            <h3 className="font-display text-lg text-white">
              🧑‍🎓 {student.name || "Guest"}
              {!student.userId && <span className="ml-2 rounded bg-ink-700 px-1.5 py-0.5 text-[10px] font-normal text-ink-400">guest</span>}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            {canEmail && (
              <button type="button" onClick={() => setCompose({ subject: "", body: "" })}
                className="rounded-lg border border-brand-500/50 bg-brand-500/15 px-2.5 py-1 text-xs font-semibold text-brand-100 hover:bg-brand-500/25"
                title={`Send an email to ${student.email}`}>
                ✉ Email this student
              </button>
            )}
            <button type="button" onClick={onClose}
              className="rounded-lg border border-ink-700 px-2.5 py-1 text-xs text-ink-300 hover:bg-ink-800">Close</button>
          </div>
        </div>
        {entries == null ? (
          <div className="py-6 text-center text-xs text-ink-400">Loading…</div>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-ink-500">
                Classes attended {entries.length > 0 && <span className="ml-1 normal-case font-normal">({entries.length})</span>}
              </div>
              {entries.length === 0 ? (
                <div className="rounded-lg bg-ink-800/60 px-3 py-2 text-[11px] text-ink-500">No class attendance recorded yet.</div>
              ) : (
                <ul className="max-h-52 space-y-1.5 overflow-y-auto pr-1">
                  {entries.map((e) => (
                    <li key={e.classId + e.joinedAt}
                        className="flex items-center justify-between gap-2 rounded-lg bg-ink-800/60 px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm text-white">{e.title}</div>
                        <div className="text-[10px] text-ink-500">
                          {absTime(e.startAt)} · joined {shortAgo(e.joinedAt)}
                        </div>
                      </div>
                      <Link to={`/class/${encodeURIComponent(e.classId)}`}
                            onClick={onClose}
                            className="shrink-0 rounded-lg border border-brand-500/40 bg-brand-500/10 px-2.5 py-1 text-[11px] font-semibold text-brand-100 hover:bg-brand-500/20">
                        Open class
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-ink-500">
                📬 Emails sent to this student {mail.length > 0 && <span className="ml-1 normal-case font-normal">({mail.length})</span>}
              </div>
              {mail.length === 0 ? (
                <div className="rounded-lg bg-ink-800/60 px-3 py-2 text-[11px] text-ink-500">
                  No emails yet. {!student.userId && <span className="text-ink-500">(Guests have no email on file.)</span>}
                </div>
              ) : (
                <ul className="max-h-40 space-y-1 overflow-y-auto pr-1">
                  {mail.map((m, i) => {
                    const isAdhoc = m.kind === "adhoc";
                    const clickable = isAdhoc && canEmail && !!m.body;
                    const pill = statusPill(m.status);
                    const row = (
                      <div className="flex items-center justify-between gap-2 rounded-lg bg-ink-800/60 px-3 py-1.5 text-xs">
                        <div className="min-w-0">
                          <div className="truncate text-ink-200">{m.subject}</div>
                          <div className="text-[10px] text-ink-500">
                            {shortAgo(m.at)} ·{" "}
                            <span className={isAdhoc ? "text-brand-300" : "text-ink-400"}>
                              {isAdhoc ? "message" : m.kind.replace("reminder:", "reminder ")}
                            </span>
                            {clickable && <span className="ml-2 text-ink-500">— tap to resend</span>}
                          </div>
                        </div>
                        <span className={`shrink-0 rounded border ${pill.className} px-1.5 py-0.5 text-[10px] font-semibold`}
                              title={m.status ? `Delivery status: ${m.status}` : "Queued via Resend"}>
                          {pill.label}
                        </span>
                      </div>
                    );
                    return (
                      <li key={m.at + i}>
                        {clickable ? (
                          <button type="button" className="block w-full text-left transition-colors hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-brand-400 rounded-lg"
                                  onClick={() => setCompose({ subject: m.subject, body: m.body || "" })}>
                            {row}
                          </button>
                        ) : row}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
      {compose && canEmail && (
        <ComposeModal recipients={[student.email!]}
          prefillSubject={compose.subject} prefillMessage={compose.body}
          onClose={() => setCompose(null)}
          onSent={(r) => {
            setCompose(null);
            alert(`Sent ${r.sent}${r.skipped ? ` · ${r.skipped} skipped` : ""}${r.invalid ? ` · ${r.invalid} invalid` : ""}`);
          }} />
      )}
    </div>
  );
}

// Coach-only roster. Fetch on mount; render as a compact grid below the schedule
// sections. Skips itself entirely (no header, no empty state) for accounts that
// have no owned classes / no attendees yet.
// Ad-hoc email compose modal. Coach types subject + message and hits Send;
// server double-checks recipients are actually in caller's roster before sending.
function ComposeModal({ recipients, onClose, onSent, prefillSubject, prefillMessage }:
  { recipients: string[]; onClose: () => void; onSent: (r: { sent: number; skipped: number; invalid: number }) => void;
    prefillSubject?: string; prefillMessage?: string }) {
  const [subject, setSubject] = useState(prefillSubject ?? "");
  const [message, setMessage] = useState(prefillMessage ?? "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setSending(true);
    try {
      const res = await fetch(`${(import.meta.env.VITE_API_BASE ?? "").toString()}/api/class/coach/students/message`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, message, recipients }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.message || `send failed: ${res.status}`);
      onSent({ sent: j.sent ?? 0, skipped: j.skipped ?? 0, invalid: j.invalid ?? 0 });
    } catch (e: any) {
      setError(e?.message || "Couldn't send");
    } finally { setSending(false); }
  };
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg space-y-3 rounded-xl2 border border-brand-500/40 bg-gradient-to-br from-brand-500/10 via-ink-900 to-ink-900 p-5 shadow-2xl">
        <div className="flex items-baseline justify-between">
          <h3 className="font-display text-lg text-white">✉ Email {recipients.length} student{recipients.length === 1 ? "" : "s"}</h3>
          <button type="button" onClick={onClose}
            className="rounded-lg border border-ink-700 px-2.5 py-1 text-xs text-ink-300 hover:bg-ink-800">Close</button>
        </div>
        <label className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-ink-400">Subject</span>
          <input value={subject} onChange={(e) => setSubject(e.target.value)}
            required maxLength={160}
            placeholder="e.g. Class cancelled tonight"
            className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-white placeholder:text-ink-500" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-ink-400">
            Message <span className="normal-case font-normal text-ink-500">(plain text — links auto-detected by most email clients)</span>
          </span>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)}
            required rows={6} maxLength={5000}
            placeholder="Hi everyone, tonight's class is moving to tomorrow same time…"
            className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-white placeholder:text-ink-500" />
        </label>
        <div className="rounded-lg border border-ink-700 bg-ink-800/60 px-3 py-2 text-[11px] text-ink-400">
          Recipients: {recipients.slice(0, 8).join(", ")}{recipients.length > 8 ? ` +${recipients.length - 8} more` : ""}
        </div>
        <div className="flex items-center justify-between gap-2">
          {error && <span className="rounded bg-rose-500/15 px-2 py-1 text-xs text-rose-200">{error}</span>}
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={onClose}
              className="rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-ink-200 hover:bg-ink-700">Cancel</button>
            <button type="submit" disabled={sending || !subject || !message}
              className="rounded-lg bg-gradient-to-r from-brand-600 to-accent-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:from-brand-500 hover:to-accent-400 disabled:opacity-40">
              {sending ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function MyStudents({ onAppendInvitees }: { onAppendInvitees?: (emails: string[]) => void }) {
  const [students, setStudents] = useState<CoachStudent[] | null>(null);
  const [detail, setDetail] = useState<CoachStudent | null>(null);
  const [composing, setComposing] = useState<string[] | null>(null);
  // Multi-select state. Selected students without an email (guests / signed-in
  // users with no email on file) can still be selected — the bulk action
  // handler filters them and shows a "N skipped" note.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setSelected((s) => {
    const next = new Set(s); next.has(k) ? next.delete(k) : next.add(k); return next;
  });
  const clearSel = () => setSelected(new Set());
  useEffect(() => {
    let cancelled = false;
    fetch(`${(import.meta.env.VITE_API_BASE ?? "").toString()}/api/class/coach/students`,
          { credentials: "include" })
      .then((r) => r.ok ? r.json() : { students: [] })
      .then((j) => { if (!cancelled) setStudents(j.students ?? []); })
      .catch(() => { if (!cancelled) setStudents([]); });
    return () => { cancelled = true; };
  }, []);
  if (!students || students.length === 0) return null;
  const totalClasses = students.reduce((s, x) => s + (x.classesAttended || 0), 0);
  const csvHref = `${(import.meta.env.VITE_API_BASE ?? "").toString()}/api/class/coach/students.csv`;
  // Bulk-invite: pick selected students that HAVE an email and hand them to
  // the parent so it can append to the schedule form. Skipped (email-less)
  // students surface in a small note next to the action button.
  const selectedList = students.filter((s) => selected.has(keyOf(s)));
  const withEmail = selectedList.filter((s) => !!s.email);
  const skipped = selectedList.length - withEmail.length;
  const doAddToInvitees = () => {
    if (withEmail.length === 0 || !onAppendInvitees) return;
    onAppendInvitees(withEmail.map((s) => s.email!));
    clearSel();
    // Bring the schedule form into view so the coach sees the emails landed.
    document.getElementById("class-schedule-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <section>
      <h2 className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-sm font-semibold text-white">
        <span>🧑‍🎓 My students</span>
        <span className="flex items-center gap-2 text-[10px] font-normal text-ink-500">
          <span>{students.length} unique · {totalClasses} class-attend{totalClasses === 1 ? "" : "s"} total</span>
          <a href={csvHref}
             className="rounded border border-brand-500/40 bg-brand-500/10 px-2 py-0.5 font-semibold text-brand-100 hover:bg-brand-500/20"
             title="Download roster as CSV">
            ⬇ CSV
          </a>
        </span>
      </h2>
      <div className="grid gap-2 rounded-xl2 border border-ink-700 bg-ink-900 p-3 sm:grid-cols-2 lg:grid-cols-3">
        {students.map((s) => {
          const k = keyOf(s);
          const isSel = selected.has(k);
          return (
            <div key={k}
                 className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 transition-colors ${isSel ? "bg-brand-500/15 ring-1 ring-brand-500/40" : "bg-ink-800/60 hover:bg-ink-800"}`}>
              {/* Checkbox — self-contained so clicking it doesn't open the history modal. */}
              <label className="flex shrink-0 items-center" onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" checked={isSel} onChange={() => toggle(k)}
                  className="h-4 w-4 accent-brand-500 cursor-pointer" title="Select" />
              </label>
              <button type="button" onClick={() => setDetail(s)}
                      title="Click to see this student's class history"
                      className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left focus:outline-none">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold text-white">{s.name || "Guest"}</span>
                    {!s.userId && <span className="rounded bg-ink-700 px-1 text-[9px] text-ink-400">guest</span>}
                    {!s.email && <span title="No email on file — bulk invite will skip"
                                       className="rounded bg-amber-500/15 px-1 text-[9px] text-amber-200">no email</span>}
                  </div>
                  <div className="text-[10px] text-ink-500">
                    last seen {shortAgo(s.lastSeen)} · joined {shortAgo(s.firstSeen)}
                  </div>
                </div>
                <span className="shrink-0 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-200"
                      title={`Attended ${s.classesAttended} of your classes`}>
                  × {s.classesAttended}
                </span>
              </button>
            </div>
          );
        })}
      </div>

      {/* Floating action bar — only when a selection exists. Sits fixed at the
          bottom of the viewport so scrolling through a big roster doesn't
          hide it. */}
      {selectedList.length > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-40 mx-auto flex max-w-lg items-center gap-3 rounded-xl2 border border-brand-500/50 bg-gradient-to-br from-brand-500/25 via-ink-900 to-ink-900 p-3 shadow-2xl">
          <span className="text-xs font-semibold text-white">
            {selectedList.length} selected
            {skipped > 0 && <span className="ml-2 font-normal text-amber-300">· {skipped} skipped (no email)</span>}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={clearSel}
              className="rounded-lg border border-ink-600 bg-ink-800 px-3 py-1.5 text-xs font-semibold text-ink-200 hover:bg-ink-700">
              Clear
            </button>
            <button onClick={() => setComposing(withEmail.map((s) => s.email!))}
              disabled={withEmail.length === 0}
              className="rounded-lg border border-brand-500/50 bg-brand-500/15 px-3 py-1.5 text-xs font-semibold text-brand-100 hover:bg-brand-500/25 disabled:opacity-40">
              ✉ Email {withEmail.length}
            </button>
            <button onClick={doAddToInvitees} disabled={withEmail.length === 0}
              className="rounded-lg bg-gradient-to-r from-brand-600 to-accent-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:from-brand-500 hover:to-accent-400 disabled:opacity-40">
              ➕ Add {withEmail.length} to new class
            </button>
          </div>
        </div>
      )}

      {detail && <StudentHistoryModal student={detail} onClose={() => setDetail(null)} />}
      {composing && (
        <ComposeModal recipients={composing} onClose={() => setComposing(null)}
          onSent={(r) => {
            setComposing(null);
            clearSel();
            alert(`Sent ${r.sent}${r.skipped ? ` · ${r.skipped} skipped (not in roster)` : ""}${r.invalid ? ` · ${r.invalid} invalid` : ""}`);
          }} />
      )}
    </section>
  );
}

// Scheduled-class data shape — matches ClassScheduleController.list()'s response.
type ScheduledClass = {
  _id: string; title: string; coach: string;
  startAt: string; durationMin: number; notes: string;
  createdByUserId?: string | null;
  mine?: boolean;
  attendedCount?: number;   // only present for rows the caller owns
  seriesId?: string | null; // set on every doc in a materialized recurring series
  seriesIndex?: number;     // 1-based position, "2 of 8"
  seriesTotal?: number;
  invitees?: Array<{ email: string }>;
  reminderStages?: string[]; // ["h24","h1","m15"] subset; missing = default (h24+m15)
};

// Chip trio for picking which reminder emails fire. Ordered far→near so the
// mental model reads "day-before / hour-before / just-before". Active chips get
// a brand→accent gradient; inactive stay neutral. Toggling is order-preserving
// so the value stays comparable when clicked back and forth.
function StagePicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const stages: Array<{ key: string; label: string; hint: string }> = [
    { key: "h24", label: "📅 1 day before",  hint: "sent ~24h ahead" },
    { key: "h1",  label: "⌛ 1 hour before", hint: "sent ~1h ahead" },
    { key: "m15", label: "⏰ 15 min before", hint: "sent ~15 min ahead" },
  ];
  const toggle = (k: string) => {
    if (value.includes(k)) onChange(value.filter((x) => x !== k));
    else onChange([...stages.map((s) => s.key).filter((s) => value.includes(s) || s === k)]);
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {stages.map((s) => {
        const active = value.includes(s.key);
        return (
          <button key={s.key} type="button" onClick={() => toggle(s.key)} title={s.hint}
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${active
              ? "border-brand-500/60 bg-gradient-to-r from-brand-500/30 to-accent-500/20 text-brand-100"
              : "border-ink-700 bg-ink-800 text-ink-400 hover:bg-ink-700"}`}>
            {s.label}
          </button>
        );
      })}
      {value.length === 0 && (
        <span className="ml-1 self-center rounded bg-ink-800 px-2 py-0.5 text-[10px] text-ink-400">
          Silent — no reminders will be sent
        </span>
      )}
    </div>
  );
}

// Human-friendly "in 2h 15m" / "started 4 min ago" / "3d ago" delta for a startAt.
function relTime(iso: string): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const min = Math.round(abs / 60_000);
  const hr = Math.round(abs / 3_600_000);
  const day = Math.round(abs / 86_400_000);
  const label = day >= 2 ? `${day}d` : hr >= 2 ? `${hr}h` : min >= 1 ? `${min} min` : "under a min";
  return diffMs >= 0 ? `in ${label}` : `${label} ago`;
}
// Absolute local time — "Fri 8 Aug · 6:30 PM".
function absTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short", day: "numeric", month: "short",
    hour: "numeric", minute: "2-digit",
  });
}

// Landing / directory for /class. Two lists (live now + upcoming) plus a form
// to schedule a new class OR start one immediately. Ad-hoc "Start now" and a
// planned schedule both create a joinable room id — the class page itself is
// the same either way.
function ClassLanding() {
  const nav = useNavigate();
  const [schedules, setSchedules] = useState<{ live: ScheduledClass[]; upcoming: ScheduledClass[] }>({ live: [], upcoming: [] });
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<{ loggedIn: boolean; username?: string }>({ loggedIn: false });
  const [mineOnly, setMineOnly] = useState(false);
  // Persisted view mode. Coaches with 20+ scheduled classes want a dense list
  // that skims like a calendar; casual users prefer the info-rich cards.
  const [view, setView] = useState<"cards" | "list">(() => {
    try { return (localStorage.getItem("cg_class_view") as "cards" | "list") || "cards"; }
    catch { return "cards"; }
  });
  useEffect(() => { try { localStorage.setItem("cg_class_view", view); } catch { /* */ } }, [view]);
  const [form, setForm] = useState({
    title: "", coach: "", durationMin: 60,
    // Default start = next quarter-hour (15 min pad so the coach can share the
    // link before the class begins).
    startAt: (() => {
      const d = new Date(Date.now() + 15 * 60_000);
      d.setSeconds(0, 0);
      d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15);
      // toISOString gives UTC; <input type="datetime-local"> wants "yyyy-MM-ddThh:mm"
      // in LOCAL time — build it manually.
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    })(),
    notes: "",
    recurrence: "none" as "none" | "weekly",
    recurrenceCount: 8,
    // Weekday mask for recurring series (Sun=0..Sat=6). Empty => classic every-7-days
    // cadence from startAt. Chips in the form let coach flip individual days on/off
    // (e.g. [1,3,5] for a Mon/Wed/Fri pattern).
    recurrenceWeekdays: [] as number[],
    // Invitee emails — free-text (comma / newline / space separated). Server
    // parses + dedupes + validates. Empty = no reminders sent (except to coach's
    // own email, which the scheduler always emails when known).
    invitees: "",
    // Which reminder stages should fire. Default = 24h + 15min (matches the
    // pre-6f behaviour). ["m15"] = only the last-minute nudge; [] = no reminders.
    reminderStages: ["h24", "m15"] as string[],
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${(import.meta.env.VITE_API_BASE ?? "").toString()}/api/class/schedule`, { credentials: "include" });
      const j = await r.json();
      setSchedules({ live: j.live ?? [], upcoming: j.upcoming ?? [] });
    } catch { /* silent */ }
    finally { setLoading(false); }
  };
  useEffect(() => { refresh(); }, []);
  // Pull the current session so the schedule form can pre-fill the coach name and
  // the "Mine only" toggle can show up when the caller has any owned classes.
  useEffect(() => {
    fetch("/auth/me", { credentials: "include" })
      .then((r) => r.json())
      .then((j) => {
        setMe({ loggedIn: !!j?.loggedIn, username: j?.username });
        if (j?.loggedIn && j.username) setForm((f) => (f.coach ? f : { ...f, coach: j.username }));
      })
      .catch(() => { /* not signed in — leave defaults */ });
  }, []);

  const anyMine = [...schedules.live, ...schedules.upcoming].some((c) => c.mine);
  const filterCards = (arr: ScheduledClass[]) => mineOnly ? arr.filter((c) => c.mine) : arr;
  const visLive = filterCards(schedules.live);
  const visUpcoming = filterCards(schedules.upcoming);

  const cancel = async (c: ScheduledClass) => {
    if (!c.mine) return;
    if (!confirm(`Cancel "${c.title}"? This deletes the schedule; any recordings for the room stay accessible.`)) return;
    try {
      const res = await fetch(`${(import.meta.env.VITE_API_BASE ?? "").toString()}/api/class/schedule/${encodeURIComponent(c._id)}`,
        { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error(`cancel failed: ${res.status}`);
      refresh();
    } catch (e: any) { alert(e?.message || "Couldn't cancel"); }
  };
  // Edit-target state — when set, an EditOverlay renders over the landing. Saving
  // POSTs a PATCH and refreshes the list.
  const [editing, setEditing] = useState<ScheduledClass | null>(null);
  const saveEdit = async (patch: { title: string; coach: string; notes: string; durationMin: number; invitees: string; reminderStages: string[] }, propagate: boolean) => {
    if (!editing) return;
    const url = new URL(`${(import.meta.env.VITE_API_BASE ?? "").toString()}/api/class/schedule/${encodeURIComponent(editing._id)}`, window.location.origin);
    if (propagate && editing.seriesId) url.searchParams.set("scope", "series");
    try {
      const res = await fetch(url.toString().replace(window.location.origin, ""), {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`edit failed: ${res.status}`);
      setEditing(null);
      refresh();
    } catch (e: any) { alert(e?.message || "Couldn't save edit"); }
  };

  const cancelSeries = async (c: ScheduledClass) => {
    if (!c.mine || !c.seriesId) return;
    if (!confirm(`Cancel every FUTURE class in "${c.title}" series? Past classes and their recordings stay.`)) return;
    try {
      const res = await fetch(`${(import.meta.env.VITE_API_BASE ?? "").toString()}/api/class/schedule/series/${encodeURIComponent(c.seriesId)}`,
        { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error(`cancel series failed: ${res.status}`);
      refresh();
    } catch (e: any) { alert(e?.message || "Couldn't cancel series"); }
  };

  const startNow = () => nav(`/class/${newRoomId()}`);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setSubmitting(true);
    try {
      const res = await fetch(`${(import.meta.env.VITE_API_BASE ?? "").toString()}/api/class/schedule`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title, coach: form.coach, notes: form.notes,
          durationMin: Number(form.durationMin) || 60,
          // <input datetime-local> gives a local wall time with no zone. new Date()
          // parses it in the user's tz, which is exactly what we want here.
          startAt: new Date(form.startAt).toISOString(),
          recurrence: form.recurrence,
          recurrenceCount: form.recurrence === "weekly" ? Number(form.recurrenceCount) || 1 : 1,
          recurrenceWeekdays: form.recurrence === "weekly" ? form.recurrenceWeekdays : [],
          invitees: form.invitees,
          reminderStages: form.reminderStages,
        }),
      });
      if (!res.ok) throw new Error(`create failed: ${res.status}`);
      const created: ScheduledClass = await res.json();
      // Show the coach the room they just created (with a copy-invite button).
      nav(`/class/${encodeURIComponent(created._id)}`);
    } catch (e: any) {
      setError(e?.message || "Couldn't schedule class");
    } finally { setSubmitting(false); }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-8">
      <header className="flex items-baseline justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-ink-500">Live class</div>
          <h1 className="font-display text-2xl text-white">🎥 Classroom</h1>
        </div>
        <button onClick={startNow}
          className="rounded-xl2 bg-gradient-to-r from-brand-600 to-accent-500 px-4 py-2 text-sm font-semibold text-white shadow-lg hover:from-brand-500 hover:to-accent-400">
          ▶ Start now
        </button>
      </header>

      {/* "Mine only" filter — only surfaces when the caller actually has any
          scheduled classes. Keeps the landing simple for pure students.
          Cards / List toggle sits on the right of the same row so both view
          controls stay together. */}
      <div className="flex flex-wrap items-center gap-2">
        {anyMine && (
          <>
            <span className="text-xs text-ink-400">Show:</span>
            <button onClick={() => setMineOnly(false)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${!mineOnly
                ? "border-brand-500/50 bg-brand-500/15 text-brand-100"
                : "border-ink-700 bg-ink-900 text-ink-400 hover:bg-ink-800"}`}>All classes</button>
            <button onClick={() => setMineOnly(true)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${mineOnly
                ? "border-amber-400/60 bg-amber-500/20 text-amber-100"
                : "border-ink-700 bg-ink-900 text-ink-400 hover:bg-ink-800"}`}>👑 Mine only</button>
          </>
        )}
        {(schedules.live.length + schedules.upcoming.length) > 0 && (
          <div className="ml-auto flex items-center gap-1 rounded-full border border-ink-700 bg-ink-900 p-0.5">
            <button onClick={() => setView("cards")}
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${view === "cards"
                ? "bg-brand-500/25 text-brand-100"
                : "text-ink-400 hover:text-white"}`}
              title="Rich cards with notes + actions">▦ Cards</button>
            <button onClick={() => setView("list")}
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${view === "list"
                ? "bg-brand-500/25 text-brand-100"
                : "text-ink-400 hover:text-white"}`}
              title="Dense one-line per class">☰ List</button>
          </div>
        )}
      </div>

      {/* Live now — pulsing rose highlight so it draws the eye. Empty when nothing's live. */}
      {visLive.length > 0 && (
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-rose-300">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-rose-500 shadow-[0_0_6px] shadow-rose-500" />
            Live now
          </h2>
          {view === "cards" ? (
            <div className="grid gap-3 md:grid-cols-2">
              {visLive.map((c) => <ClassCard key={c._id} c={c} tone="live" onCancel={c.mine ? () => cancel(c) : undefined} onCancelSeries={c.mine && c.seriesId ? () => cancelSeries(c) : undefined} onEdit={c.mine ? () => setEditing(c) : undefined} />)}
            </div>
          ) : (
            <div className="divide-y divide-ink-800 overflow-hidden rounded-xl2 border border-rose-500/40 bg-gradient-to-br from-rose-500/5 via-ink-900 to-ink-900">
              {visLive.map((c) => <ClassRow key={c._id} c={c} tone="live" onCancel={c.mine ? () => cancel(c) : undefined} onCancelSeries={c.mine && c.seriesId ? () => cancelSeries(c) : undefined} onEdit={c.mine ? () => setEditing(c) : undefined} />)}
            </div>
          )}
        </section>
      )}

      <section>
        <h2 className="mb-2 flex items-baseline justify-between text-sm font-semibold text-white">
          <span>📆 Upcoming</span>
          <span className="text-[10px] font-normal text-ink-500">
            {loading ? "loading…" : `${visUpcoming.length} scheduled${mineOnly ? " · yours" : ""}`}
          </span>
        </h2>
        {!loading && visUpcoming.length === 0 ? (
          <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-6 text-center text-sm text-ink-400">
            {mineOnly
              ? <>You haven't scheduled any classes yet. Fill in the form below to create one.</>
              : <>No upcoming classes. Schedule one below or <button className="text-brand-400 hover:underline" onClick={startNow}>start now</button>.</>}
          </div>
        ) : view === "cards" ? (
            <div className="grid gap-3 md:grid-cols-2">
              {visUpcoming.map((c) => <ClassCard key={c._id} c={c} tone="upcoming" onCancel={c.mine ? () => cancel(c) : undefined} onCancelSeries={c.mine && c.seriesId ? () => cancelSeries(c) : undefined} onEdit={c.mine ? () => setEditing(c) : undefined} />)}
            </div>
          ) : (
            <div className="divide-y divide-ink-800 overflow-hidden rounded-xl2 border border-ink-700 bg-ink-900">
              {visUpcoming.map((c) => <ClassRow key={c._id} c={c} tone="upcoming" onCancel={c.mine ? () => cancel(c) : undefined} onCancelSeries={c.mine && c.seriesId ? () => cancelSeries(c) : undefined} onEdit={c.mine ? () => setEditing(c) : undefined} />)}
            </div>
          )}
      </section>

      {/* Scheduling form — brand-gradient card so it visually pairs with the Start-now
          button. No coach account gate; anyone with the URL can create + share. */}
      <section id="class-schedule-form" className="rounded-xl2 border border-brand-500/25 bg-gradient-to-br from-brand-500/10 via-ink-900 to-ink-900 p-5">
        <h2 className="mb-3 text-sm font-semibold text-brand-200">🗓️ Schedule a class</h2>
        <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
          <label className="md:col-span-2">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-ink-400">Title</span>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
              required maxLength={120}
              placeholder="e.g. Rook endgames — the Lucena position"
              className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-white placeholder:text-ink-500" />
          </label>
          <label>
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-ink-400">Coach name</span>
            <input value={form.coach} onChange={(e) => setForm({ ...form, coach: e.target.value })}
              maxLength={80} placeholder="Optional"
              className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-white placeholder:text-ink-500" />
          </label>
          <label>
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-ink-400">Duration (min)</span>
            <input type="number" min={5} max={600} step={5}
              value={form.durationMin} onChange={(e) => setForm({ ...form, durationMin: Number(e.target.value) })}
              className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-white" />
          </label>
          <label className="md:col-span-2">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-ink-400">Starts at</span>
            <input type="datetime-local" value={form.startAt}
              onChange={(e) => setForm({ ...form, startAt: e.target.value })}
              className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-white" />
          </label>
          <label>
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-ink-400">Repeats</span>
            <select value={form.recurrence} onChange={(e) => setForm({ ...form, recurrence: e.target.value as "none" | "weekly" })}
              className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-white">
              <option value="none">One-off class</option>
              <option value="weekly">Weekly — same day &amp; time</option>
            </select>
          </label>
          <label className={form.recurrence === "weekly" ? "" : "opacity-40 pointer-events-none"}>
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-ink-400">
              {form.recurrenceWeekdays.length ? "Total classes (max 12)" : "Weeks (max 12)"}
            </span>
            <input type="number" min={1} max={12} step={1}
              value={form.recurrenceCount} onChange={(e) => setForm({ ...form, recurrenceCount: Number(e.target.value) })}
              disabled={form.recurrence !== "weekly"}
              className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-white" />
          </label>
          {form.recurrence === "weekly" && (
            <div className="md:col-span-2">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-ink-400">
                Days of the week
                <span className="ml-2 font-normal normal-case text-ink-500">
                  optional — leave blank for "every 7 days from the start date"
                </span>
              </span>
              <div className="flex flex-wrap gap-1.5">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label, dow) => {
                  const active = form.recurrenceWeekdays.includes(dow);
                  return (
                    <button key={dow} type="button"
                      onClick={() => setForm((f) => ({
                        ...f,
                        recurrenceWeekdays: active
                          ? f.recurrenceWeekdays.filter((d) => d !== dow)
                          : [...f.recurrenceWeekdays, dow].sort((a, b) => a - b),
                      }))}
                      className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${active
                        ? "border-brand-500/60 bg-gradient-to-r from-brand-500/30 to-accent-500/20 text-brand-100"
                        : "border-ink-700 bg-ink-800 text-ink-400 hover:bg-ink-700"}`}>
                      {label}
                    </button>
                  );
                })}
              </div>
              {form.recurrenceWeekdays.length > 0 && (() => {
                // Live hint: warn if the picked start-date's weekday isn't in the mask,
                // since the server will 400 that. Non-blocking — coach sees + fixes.
                const dow = new Date(form.startAt).getDay();
                if (!form.recurrenceWeekdays.includes(dow)) {
                  const wname = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][dow];
                  return (
                    <p className="mt-1.5 text-[11px] text-amber-300">
                      ⚠️ Start date is a {wname} — pick it as one of the days above, or move the start date.
                    </p>
                  );
                }
                return null;
              })()}
            </div>
          )}
          <label className="md:col-span-2">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-ink-400">Notes (optional)</span>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2} maxLength={2000}
              placeholder="What you'll cover, any positions to study first…"
              className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-white placeholder:text-ink-500" />
          </label>
          <label className="md:col-span-2">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-ink-400">
              Invite emails <span className="normal-case font-normal text-ink-500">(optional — one per line, or comma-separated)</span>
            </span>
            <textarea value={form.invitees} onChange={(e) => setForm({ ...form, invitees: e.target.value })}
              rows={2}
              placeholder="alice@example.com, bob@example.com"
              className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-white placeholder:text-ink-500" />
          </label>
          <div className="md:col-span-2">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-ink-400">
              Reminder emails
              <span className="ml-2 font-normal normal-case text-ink-500">
                pick which nudges get sent (turn all off for silent classes)
              </span>
            </span>
            <StagePicker
              value={form.reminderStages}
              onChange={(next) => setForm({ ...form, reminderStages: next })}
            />
          </div>
          <div className="md:col-span-2 flex items-center justify-between gap-2">
            {error && <span className="rounded bg-rose-500/15 px-2 py-1 text-xs text-rose-200">{error}</span>}
            <button type="submit" disabled={submitting || !form.title}
              className="ml-auto rounded-lg bg-gradient-to-r from-brand-600 to-accent-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:from-brand-500 hover:to-accent-400 disabled:opacity-40">
              {submitting ? "Scheduling…" : "Schedule + get invite"}
            </button>
          </div>
        </form>
      </section>

      <MyStudents onAppendInvitees={(emails) => {
        // Merge into existing textarea, dedupe (case-insensitive) so a rapid
        // second click doesn't spam the list.
        setForm((f) => {
          const existing = new Set(
            (f.invitees || "").split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean),
          );
          const additions = emails.filter((e) => !existing.has(e.toLowerCase()));
          if (additions.length === 0) return f;
          const joined = [(f.invitees || "").trim(), ...additions].filter(Boolean).join("\n");
          return { ...f, invitees: joined };
        });
      }} />

      <p className="text-center text-[11px] text-ink-500">
        Powered by Jitsi Meet (open source video) · ChessGuru (board sync + recording + replay)
      </p>

      {editing && (
        <EditOverlay c={editing} onClose={() => setEditing(null)} onSave={saveEdit} />
      )}
    </div>
  );
}

// Small modal for editing a scheduled class. Reuses the same field shape as the
// create form (title / coach / duration / notes) — startAt intentionally omitted
// because moving a class time is a "cancel + reschedule" concern, not an edit.
// The propagate toggle appears only when the class is part of a series.
function EditOverlay({ c, onClose, onSave }:
  { c: ScheduledClass; onClose: () => void;
    onSave: (patch: { title: string; coach: string; notes: string; durationMin: number; invitees: string; reminderStages: string[] }, propagate: boolean) => void }) {
  const [title, setTitle] = useState(c.title);
  const [coach, setCoach] = useState(c.coach);
  const [notes, setNotes] = useState(c.notes || "");
  const [durationMin, setDurationMin] = useState(c.durationMin);
  // Invitees rendered as newline-joined text so the coach can paste-in a list;
  // parseInvitees() on the server normalizes back to the {email} array shape.
  const [invitees, setInvitees] = useState(
    (c.invitees ?? []).map((i) => i.email).join("\n"),
  );
  const [reminderStages, setReminderStages] = useState<string[]>(
    Array.isArray(c.reminderStages) ? c.reminderStages : ["h24", "m15"],
  );
  const [propagate, setPropagate] = useState(!!c.seriesId);
  // Coach-only: who's silenced reminders for this class? Fetched once on
  // overlay open; a 403 means we're not the creator (shouldn't happen since
  // Edit is only offered to owners, but handle gracefully anyway).
  const [optOuts, setOptOuts] = useState<Array<{ email: string; optedOutAt: string }>>([]);
  useEffect(() => {
    let cancelled = false;
    fetch(`${(import.meta.env.VITE_API_BASE ?? "").toString()}/api/class/${encodeURIComponent(c._id)}/optouts`,
          { credentials: "include" })
      .then((r) => r.ok ? r.json() : { emails: [] })
      .then((j) => { if (!cancelled) setOptOuts(j.emails ?? []); })
      .catch(() => { /* silent — panel just stays empty */ });
    return () => { cancelled = true; };
  }, [c._id]);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ title, coach, notes, durationMin: Number(durationMin) || 60, invitees, reminderStages }, propagate && !!c.seriesId);
  };
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4"
         onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg space-y-3 rounded-xl2 border border-brand-500/40 bg-gradient-to-br from-brand-500/10 via-ink-900 to-ink-900 p-5 shadow-2xl">
        <div className="flex items-baseline justify-between">
          <h3 className="font-display text-lg text-white">✏️ Edit class</h3>
          <button type="button" onClick={onClose}
            className="rounded-lg border border-ink-700 px-2.5 py-1 text-xs text-ink-300 hover:bg-ink-800">Close</button>
        </div>
        <label className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-ink-400">Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={120}
            className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-white" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-ink-400">Coach name</span>
            <input value={coach} onChange={(e) => setCoach(e.target.value)} maxLength={80}
              className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-white" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-ink-400">Duration (min)</span>
            <input type="number" min={5} max={600} step={5} value={durationMin}
              onChange={(e) => setDurationMin(Number(e.target.value))}
              className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-white" />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-ink-400">Notes</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000}
            className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-white" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-ink-400">
            Invite emails <span className="normal-case font-normal text-ink-500">(one per line — replaces existing list)</span>
          </span>
          <textarea value={invitees} onChange={(e) => setInvitees(e.target.value)} rows={3}
            placeholder="alice@example.com"
            className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-white" />
          {optOuts.length > 0 && (
            <div className="mt-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-rose-200">
                🔕 {optOuts.length} opted out <span className="ml-1 font-normal normal-case text-rose-300/80">— they won't get reminders even if listed above</span>
              </div>
              <ul className="mt-1 flex flex-wrap gap-1">
                {optOuts.map((o) => (
                  <li key={o.email} title={`opted out ${new Date(o.optedOutAt).toLocaleString()}`}
                    className="rounded bg-rose-500/15 px-2 py-0.5 text-[11px] text-rose-100 line-through">
                    {o.email}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </label>
        <div>
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-ink-400">
            Reminder emails
            <span className="ml-2 font-normal normal-case text-ink-500">turn all off for silent classes</span>
          </span>
          <StagePicker value={reminderStages} onChange={setReminderStages} />
        </div>
        {c.seriesId && (
          <label className="flex items-center gap-2 rounded-lg border border-brand-500/30 bg-brand-500/10 px-3 py-2 text-xs text-brand-100">
            <input type="checkbox" checked={propagate} onChange={(e) => setPropagate(e.target.checked)}
              className="h-4 w-4 accent-brand-500" />
            <span>Apply to every FUTURE class in this series (🔁 {c.seriesIndex}/{c.seriesTotal}). Past classes stay as-is.</span>
          </label>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose}
            className="rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-ink-200 hover:bg-ink-700">Cancel</button>
          <button type="submit"
            className="rounded-lg bg-gradient-to-r from-brand-600 to-accent-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:from-brand-500 hover:to-accent-400">
            Save changes
          </button>
        </div>
      </form>
    </div>
  );
}

// Compact one-line row — the "list" view alternative to ClassCard. Same
// affordances (title / coach / time / attended / actions / status) squeezed
// into a single horizontal strip so coaches with 20+ classes can scan a term
// at a glance. Whole row is a Link (Cancel/Edit inside use stopPropagation).
function ClassRow({ c, tone, onCancel, onCancelSeries, onEdit }:
  { c: ScheduledClass; tone: "live" | "upcoming"; onCancel?: () => void; onCancelSeries?: () => void; onEdit?: () => void }) {
  const hoverTint = tone === "live" ? "hover:bg-rose-500/10" : "hover:bg-brand-500/5";
  return (
    <Link to={`/class/${encodeURIComponent(c._id)}`}
      className={`flex items-center gap-3 px-3 py-2 text-sm transition-colors ${hoverTint}`}>
      {tone === "live" && (
        <span className="shrink-0 inline-block h-2 w-2 animate-pulse rounded-full bg-rose-500 shadow-[0_0_6px] shadow-rose-500" title="Live" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold text-white">{c.title}</span>
          {c.mine && (
            <span className="shrink-0 rounded bg-amber-500/25 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-100">Yours</span>
          )}
          {c.seriesId && c.seriesIndex && c.seriesTotal && (
            <span className="shrink-0 rounded-full border border-brand-500/40 bg-brand-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand-200" title="Part of a weekly series">
              🔁 {c.seriesIndex}/{c.seriesTotal}
            </span>
          )}
          {c.mine && (c.attendedCount ?? 0) > 0 && (
            <span className="shrink-0 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-200" title={`${c.attendedCount} attended`}>
              🧑‍🎓 {c.attendedCount}
            </span>
          )}
        </div>
        <div className="truncate text-[11px] text-ink-500">
          👑 {c.coach} · {absTime(c.startAt)} <span className="text-ink-500">· {relTime(c.startAt)}</span> · {c.durationMin} min
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {onEdit && (
          <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEdit(); }}
            className="rounded border border-brand-500/40 bg-brand-500/10 px-2 py-0.5 text-[11px] font-semibold text-brand-200 hover:bg-brand-500/20">Edit</button>
        )}
        {onCancel && (
          <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onCancel(); }}
            className="rounded border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-[11px] font-semibold text-rose-200 hover:bg-rose-500/20">Cancel</button>
        )}
        {onCancelSeries && (
          <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onCancelSeries(); }}
            className="rounded border border-rose-500/60 bg-rose-500/20 px-2 py-0.5 text-[11px] font-semibold text-rose-100 hover:bg-rose-500/30" title="Cancel every FUTURE class in this series">Cancel series</button>
        )}
        <span className={`ml-1 rounded px-2 py-0.5 text-[11px] font-semibold shadow-sm ${tone === "live"
          ? "bg-gradient-to-r from-rose-500 to-rose-400 text-white"
          : "bg-gradient-to-r from-brand-600 to-brand-500 text-white"}`}>
          {tone === "live" ? "Join →" : "Open"}
        </span>
      </div>
    </Link>
  );
}

// Single card in the live/upcoming list. Clicking the card body jumps straight
// into the room. Cancel buttons are coach-only (undefined otherwise) and stop
// the click from propagating so they don't also open the class.
function ClassCard({ c, tone, onCancel, onCancelSeries, onEdit }:
  { c: ScheduledClass; tone: "live" | "upcoming"; onCancel?: () => void; onCancelSeries?: () => void; onEdit?: () => void }) {
  const border = tone === "live"
    ? "border-rose-500/40 bg-gradient-to-br from-rose-500/10 via-ink-900 to-ink-900"
    : c.mine
      ? "border-amber-500/40 bg-gradient-to-br from-amber-500/10 via-ink-900 to-ink-900 hover:border-amber-400/60"
      : "border-ink-700 bg-ink-900 hover:border-brand-500/40";
  const cta = tone === "live"
    ? "bg-gradient-to-r from-rose-500 to-rose-400 text-white hover:from-rose-400 hover:to-rose-300"
    : "bg-gradient-to-r from-brand-600 to-brand-500 text-white hover:from-brand-500 hover:to-brand-400";
  return (
    <Link to={`/class/${encodeURIComponent(c._id)}`}
      className={`group flex flex-col gap-2 rounded-xl2 border p-4 transition-colors ${border}`}>
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold text-white">{c.title}</span>
            {c.mine && (
              <span className="shrink-0 rounded bg-amber-500/25 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-100">Yours</span>
            )}
            {c.mine && (c.attendedCount ?? 0) > 0 && (
              <span className="shrink-0 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-200"
                title="Students who've joined this class">
                🧑‍🎓 {c.attendedCount}
              </span>
            )}
            {c.seriesId && c.seriesIndex && c.seriesTotal && (
              <span className="shrink-0 rounded-full border border-brand-500/40 bg-brand-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand-200"
                title="Part of a weekly series">
                🔁 {c.seriesIndex}/{c.seriesTotal}
              </span>
            )}
          </div>
          <div className="mt-0.5 text-xs text-ink-400">👑 {c.coach} · {c.durationMin} min</div>
        </div>
        {tone === "live" && (
          <span className="shrink-0 rounded-full bg-rose-500/25 px-2 py-0.5 text-[10px] font-semibold text-rose-200">
            <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-rose-500 align-middle" />
            LIVE
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-ink-400">
          {absTime(c.startAt)} <span className="text-ink-500">· {relTime(c.startAt)}</span>
        </span>
        <div className="flex items-center gap-2">
          {onEdit && (
            <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEdit(); }}
              className="rounded-lg border border-brand-500/40 bg-brand-500/10 px-2.5 py-1 text-[11px] font-semibold text-brand-200 hover:bg-brand-500/20"
              title="Edit title / coach / notes / duration">
              Edit
            </button>
          )}
          {onCancel && (
            <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onCancel(); }}
              className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-[11px] font-semibold text-rose-200 hover:bg-rose-500/20"
              title="Cancel just this class">
              Cancel
            </button>
          )}
          {onCancelSeries && (
            <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onCancelSeries(); }}
              className="rounded-lg border border-rose-500/60 bg-rose-500/20 px-2.5 py-1 text-[11px] font-semibold text-rose-100 hover:bg-rose-500/30"
              title="Cancel every FUTURE class in this weekly series">
              Cancel series
            </button>
          )}
          <span className={`rounded-lg px-3 py-1 text-xs font-semibold shadow-sm ${cta}`}>
            {tone === "live" ? "Join →" : "Open"}
          </span>
        </div>
      </div>
      {c.notes && <p className="mt-1 line-clamp-2 text-xs text-ink-500">{c.notes}</p>}
    </Link>
  );
}

type Attendee = { userId: string | null; name: string; joinedAt: string; lastSeenAt?: string };

// Attendance list — populated from WS join/leave events by the server. Shows
// arrival order + last-seen. Refreshes every 10s so the coach's view stays fresh
// during the class without hammering the API. All roles can see it (matches
// Jitsi's own participant list) — coach-only gating is a Phase 6 policy call.
function AttendancePanel({ roomId, live, isCoach }: { roomId: string; live: number; isCoach: boolean }) {
  const [items, setItems] = useState<Attendee[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch(`${(import.meta.env.VITE_API_BASE ?? "").toString()}/api/class/${encodeURIComponent(roomId)}/attendance`);
        const j = await r.json();
        if (!cancelled) setItems(j.attendees ?? []);
      } catch { /* silent */ }
      finally { if (!cancelled) setLoading(false); }
    };
    load();
    const t = setInterval(load, 10_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [roomId]);
  // "Active now" heuristic: last-seen within the last 30s AND we still have
  // sockets in the room. Falls back to the WS live count when the row's timestamps
  // are missing (very old data).
  const now = Date.now();
  const isActive = (a: Attendee) => {
    const ls = a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : 0;
    return live > 0 && now - ls < 30_000;
  };
  return (
    <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-300">🧑‍🎓 Attendance</span>
        <span className="flex items-center gap-2 text-[10px] text-ink-500">
          <span>{loading ? "loading…" : `${items.length} joined${live > 0 ? ` · ${live} live` : ""}`}</span>
          {isCoach && items.length > 0 && (
            <a href={`${(import.meta.env.VITE_API_BASE ?? "").toString()}/api/class/${encodeURIComponent(roomId)}/attendance.csv`}
               className="rounded border border-brand-500/40 bg-brand-500/10 px-2 py-0.5 font-semibold text-brand-100 hover:bg-brand-500/20"
               title="Download attendance CSV (coach only)">
              ⬇ CSV
            </a>
          )}
        </span>
      </div>
      {!loading && items.length === 0 ? (
        <div className="text-[11px] text-ink-500">Nobody has joined this class yet.</div>
      ) : (
        <ul className="max-h-48 space-y-1 overflow-y-auto pr-1">
          {items.map((a, i) => (
            <li key={a.userId ?? `g${i}`} className="flex items-center justify-between gap-2 rounded-lg bg-ink-800/60 px-2 py-1.5 text-xs">
              <span className="flex min-w-0 items-center gap-2">
                <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${isActive(a)
                  ? "bg-emerald-400 shadow-[0_0_5px] shadow-emerald-400"
                  : "bg-ink-600"}`} />
                <span className="truncate text-ink-100">
                  {a.name}
                  {!a.userId && <span className="ml-1 text-[10px] text-ink-500">(guest)</span>}
                </span>
              </span>
              <span className="shrink-0 text-[10px] text-ink-500 tabular-nums">
                {new Date(a.joinedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Browser-side recording via MediaRecorder + getDisplayMedia. The coach picks the
// screen/tab to share, we capture it into a WebM blob, upload on Stop. Everything
// runs in the coach's browser — no server-side compositor needed. When we swap to
// self-hosted Jitsi + Jibri later, THIS hook goes away and Jibri becomes a fully
// server-side alternative that posts to the same /api/class/:id/recording endpoint.
function useRecorder(
  roomId: string | undefined,
  sync: ReturnType<typeof useClassSync>,
  onUploaded: () => void,
) {
  const [state, setState] = useState<"idle" | "recording" | "uploading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  // Timeline capture: while recording, every WS `move` frame observed by this browser
  // is stamped with elapsed-ms and pushed. We snapshot the last-known move at record
  // start so the FIRST post-start move is what triggers the initial timeline entry
  // (not whatever was already on the board when the coach hit record).
  const timelineRef = useRef<Array<{ tMs: number; move: WsMove }>>([]);
  const seenMoveRef = useRef<WsMove | null>(null);
  const startedAtRef = useRef<number | null>(null);

  // Tick elapsed seconds while recording. Not tied to state === "recording" via
  // closure so the interval always sees the latest startedAt.
  useEffect(() => {
    if (state !== "recording" || startedAt == null) return;
    const t = setInterval(() => setElapsed(Date.now() - startedAt), 500);
    return () => clearInterval(t);
  }, [state, startedAt]);

  // Every time the room's lastMove changes AFTER record-start, push a timeline entry.
  // Reference-equality check works because the sync hook allocates a new object per
  // frame — even a takeback-then-replay of the same UCI is a distinct event.
  useEffect(() => {
    if (state !== "recording" || startedAtRef.current == null) return;
    if (!sync.lastMove) return;
    if (sync.lastMove === seenMoveRef.current) return;
    seenMoveRef.current = sync.lastMove;
    timelineRef.current.push({ tMs: Date.now() - startedAtRef.current, move: sync.lastMove });
  }, [sync.lastMove, state]);

  const cleanup = () => {
    try { recRef.current?.stop(); } catch { /* */ }
    recRef.current = null;
    streamRef.current?.getTracks().forEach((t) => { try { t.stop(); } catch { /* */ } });
    streamRef.current = null;
    chunksRef.current = [];
  };

  const start = async () => {
    if (state !== "idle" && state !== "error") return;
    if (!roomId) return;
    setError(null);
    try {
      // Ask for screen + system audio. User picks a screen / window / tab in the
      // browser's native prompt. Audio may be declined silently — recording still
      // works, just no sound (we surface this in the UI subtly).
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 24 } } as MediaTrackConstraints,
        audio: true,
      });
      streamRef.current = stream;
      // Pick the first mime type the browser supports so we don't send an empty blob.
      const candidates = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
      const mime = candidates.find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) || "video/webm";
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 1_500_000 });
      recRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
      rec.onerror = () => { setError("Recorder error"); setState("error"); cleanup(); };
      // If the user stops the share via the browser's native "Stop sharing" bar, treat
      // it as a Stop: finalize the recording rather than leaving the state dangling.
      stream.getVideoTracks()[0]?.addEventListener("ended", () => { if (recRef.current?.state === "recording") stop(); });
      rec.start(1000);   // gather in 1-sec chunks so a crash doesn't lose the whole take
      const t0 = Date.now();
      startedAtRef.current = t0;
      seenMoveRef.current = sync.lastMove;   // baseline — don't record what's already on the board
      timelineRef.current = [];
      setStartedAt(t0); setElapsed(0); setState("recording");
    } catch (e: any) {
      setError(e?.name === "NotAllowedError" ? "Screen share was cancelled" : "Couldn't start recording");
      setState("error"); cleanup();
    }
  };

  const stop = async () => {
    const rec = recRef.current;
    if (!rec || !roomId) return;
    setState("uploading");
    // MediaRecorder.stop is async — chunks flush via ondataavailable BEFORE `stop` fires.
    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
      try { rec.stop(); } catch { resolve(); }
    });
    streamRef.current?.getTracks().forEach((t) => { try { t.stop(); } catch { /* */ } });
    const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || "video/webm" });
    chunksRef.current = [];
    try {
      const res = await fetch(classApiPath(roomId, "/recording"), {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: blob,
      });
      if (!res.ok) throw new Error(`upload failed: ${res.status}`);
      const meta = await res.json().catch(() => ({} as any));
      // Post the sidecar timeline. Best-effort — a failure here loses the board
      // overlay on replay but the video is safely saved.
      if (meta?.filename && timelineRef.current.length > 0) {
        try {
          await fetch(classApiPath(roomId, `/recording/${encodeURIComponent(meta.filename)}/timeline`), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ events: timelineRef.current }),
          });
        } catch { /* silent — video is safe */ }
      }
      timelineRef.current = []; startedAtRef.current = null;
      setState("idle"); setStartedAt(null); setElapsed(0);
      onUploaded();
    } catch (e: any) {
      setError(e?.message || "Upload failed"); setState("error");
    }
  };

  useEffect(() => () => cleanup(), []);   // release camera/screen on unmount
  return { state, error, elapsed, start, stop };
}

// Recordings panel — lists past .webm files for the class + coach's Record/Stop UI.
// Both roles see the list; only coach sees the record button.
function RecordingsPanel({ roomId, isCoach, sync }: { roomId: string; isCoach: boolean; sync: ReturnType<typeof useClassSync> }) {
  const [items, setItems] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(classApiPath(roomId, "/recordings"));
      const j = await r.json();
      setItems(j.recordings ?? []);
    } catch { /* */ }
    finally { setLoading(false); }
  }, [roomId]);
  useEffect(() => { refresh(); }, [refresh]);
  const rec = useRecorder(roomId, sync, refresh);

  return (
    <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-300">🎬 Recordings</span>
        {rec.state === "recording" && (
          <span className="flex items-center gap-1.5 rounded-full bg-rose-500/20 px-2 py-0.5 text-[10px] font-semibold text-rose-200">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-rose-500 shadow-[0_0_6px] shadow-rose-500" />
            REC · {fmtDuration(rec.elapsed)}
          </span>
        )}
      </div>
      {isCoach && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {rec.state === "recording" ? (
            <button onClick={rec.stop}
              className="rounded-lg bg-gradient-to-r from-rose-500 to-rose-400 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:from-rose-400 hover:to-rose-300">
              ⏹ Stop &amp; save
            </button>
          ) : (
            <button onClick={rec.start} disabled={rec.state === "uploading"}
              className="rounded-lg bg-gradient-to-r from-rose-600 to-orange-500 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:from-rose-500 hover:to-orange-400 disabled:opacity-40">
              {rec.state === "uploading" ? "Uploading…" : "🔴 Start recording"}
            </button>
          )}
          <span className="text-[10px] text-ink-500">
            Choose the tab/window to share. Recording stays in your browser until Stop.
          </span>
          {rec.error && <span className="rounded bg-rose-500/15 px-2 py-0.5 text-[10px] text-rose-200">{rec.error}</span>}
        </div>
      )}
      {loading ? (
        <div className="text-[11px] text-ink-500">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-[11px] text-ink-500">No recordings yet.</div>
      ) : (
        <ul className="space-y-1">
          {items.map((r) => (
            <li key={r.name} className="flex items-center justify-between gap-2 rounded-lg bg-ink-800/60 px-2 py-1.5 text-xs">
              <span className="truncate text-ink-200">{new Date(r.createdAt).toLocaleString()}</span>
              <span className="flex shrink-0 items-center gap-2 text-ink-400">
                <span className="tabular-nums text-[10px]">{fmtBytes(r.bytes)}</span>
                <Link to={`/class/${encodeURIComponent(roomId)}/replay/${encodeURIComponent(r.name)}`}
                   className="rounded border border-brand-500/40 bg-brand-500/10 px-2 py-0.5 font-semibold text-brand-100 hover:bg-brand-500/20">▶ Replay</Link>
                <a href={classApiPath(roomId, `/recording/${encodeURIComponent(r.name)}`)} download={r.name}
                   className="rounded border border-ink-600 bg-ink-800 px-2 py-0.5 font-semibold text-ink-200 hover:bg-ink-700">⬇</a>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Synced analysis board — moves broadcast to everyone in the room via /class-ws.
// Legal-move validation happens locally (chessground destinations) AND on the server
// (illegal frames dropped silently, sender reconciles from the next state frame).
function SyncedBoard({ sync }: { sync: ReturnType<typeof useClassSync> }) {
  const { fen, lastMove, participants, connected, role, locked, shapes,
          sendMove, sendReset, sendLock, sendTakeback, sendAnnot } = sync;
  const isCoach = role === "coach";
  // Map WsShape (thin wire format) to chessground's DrawShape. Cast orig/dest to Key
  // because chessground types are stricter than "any string".
  const boardShapes: DrawShape[] = useMemo(
    () => shapes.map((s) => ({ orig: s.orig as Key, dest: s.dest as Key | undefined, brush: s.brush || "green" })),
    [shapes],
  );
  // Right-click drag on the board fires this; we forward the shape set to the server.
  // Server echoes back an `annot` frame which updates `shapes` — no local optimism
  // needed since chessground already renders the user's drawing immediately.
  const onShapesChange = useCallback((next: DrawShape[]) => {
    const wire: WsShape[] = next.map((s) => ({
      orig: String(s.orig), dest: s.dest ? String(s.dest) : undefined, brush: s.brush || "green",
    }));
    sendAnnot(wire);
  }, [sendAnnot]);
  // Local chess.js is kept in sync with the authoritative FEN — used solely to compute
  // legal destinations so chessground shows valid drop-targets while dragging.
  const chessRef = useRef<Chess>(new Chess());
  useEffect(() => { try { chessRef.current = new Chess(fen); } catch { /* */ } }, [fen]);
  const dests = useMemo(() => destsFromChess(chessRef.current as any), [fen]);
  const turnColor: "white" | "black" = chessRef.current.turn() === "w" ? "white" : "black";
  const lastMoveArrow: [Key, Key] | undefined = lastMove
    ? [lastMove.from as Key, lastMove.to as Key] : undefined;
  // Movability gate: students can't move while the coach has the lock on.
  const canMove = isCoach || !locked;
  const movableColor: "both" | undefined = canMove ? "both" : undefined;

  const onMove = (from: Key, to: Key) => {
    // Optimistic local: apply the move immediately, then rely on the server's echo
    // to confirm. If the server rejects (illegal / locked), the follow-up `state`
    // frame will reset us to truth so the user sees the piece snap back.
    try { chessRef.current.move({ from, to, promotion: "q" }); } catch { return; }
    sendMove({ from, to, promotion: "q" });
  };

  return (
    <div className="flex flex-col gap-3">
      <Board fen={fen} orientation="white" turnColor={turnColor} movableColor={movableColor}
        dests={canMove ? dests : new Map()} lastMove={lastMoveArrow} onMove={onMove}
        shapes={boardShapes} onShapesChange={onShapesChange} />

      {/* Status strip — connection dot + role badge + participant count + lock chip. */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="flex items-center gap-1.5 text-ink-400">
          <span className={`inline-block h-2 w-2 rounded-full ${connected ? "bg-emerald-400 shadow-[0_0_6px] shadow-emerald-400" : "bg-rose-400"}`} />
          {connected ? `${participants} in room` : "Reconnecting…"}
        </span>
        <span className={`rounded-full border px-2 py-0.5 font-semibold ${isCoach
          ? "border-amber-400/60 bg-gradient-to-r from-amber-500/25 to-orange-500/15 text-amber-100"
          : "border-ink-600 bg-ink-800 text-ink-300"}`}>
          {isCoach ? "👑 Coach" : "👤 Student"}
        </span>
        {locked && (
          <span className="rounded-full border border-rose-500/50 bg-rose-500/15 px-2 py-0.5 font-semibold text-rose-200">
            🔒 Students locked
          </span>
        )}
      </div>

      {/* Coach control bar — takeback / lock toggle / reset. Distinct amber-gold
          palette so it reads as "you're the one driving the class". */}
      {isCoach && (
        <div className="rounded-xl2 border border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-orange-500/5 to-ink-900 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-amber-200">Coach controls</span>
            <span className="text-[10px] text-ink-500">only you see this</span>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <button onClick={sendTakeback}
              className="rounded-lg bg-gradient-to-r from-brand-600 to-brand-500 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:from-brand-500 hover:to-brand-400 disabled:opacity-40"
              disabled={!lastMove}>
              ↶ Takeback
            </button>
            <button onClick={() => sendLock(!locked)}
              className={`rounded-lg px-3 py-2 text-xs font-semibold shadow-sm ${locked
                ? "bg-gradient-to-r from-rose-500 to-rose-400 text-white hover:from-rose-400 hover:to-rose-300"
                : "bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:from-emerald-400 hover:to-teal-400"}`}>
              {locked ? "🔓 Unlock" : "🔒 Lock students"}
            </button>
            <button onClick={() => sendAnnot([])}
              className="rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-xs font-semibold text-ink-200 hover:bg-ink-700 disabled:opacity-40"
              disabled={shapes.length === 0}>
              🧽 Clear arrows
            </button>
            <button onClick={sendReset}
              className="rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-xs font-semibold text-ink-200 hover:bg-ink-700">
              ↺ Reset
            </button>
          </div>
          <div className="mt-2 text-[10px] text-ink-500">
            Draw arrows: <b>right-click drag</b> a square to another. Highlight: <b>right-click</b> a square.
          </div>
        </div>
      )}
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
  // Pull session identity (username) once — passed into the sync hello so the
  // server can record attendance under the user's real name. Anonymous joiners
  // pass nothing and are recorded as "Guest".
  const [me, setMe] = useState<{ userId?: string; displayName?: string }>({});
  useEffect(() => {
    fetch("/auth/me", { credentials: "include" })
      .then((r) => r.json())
      .then((j) => { if (j?.loggedIn) setMe({ userId: j.userId, displayName: j.username }); })
      .catch(() => { /* not signed in — fine */ });
  }, []);

  // No id in the URL => scheduling + landing view.
  if (!id) return <ClassLanding />;

  const inviteUrl = typeof window !== "undefined" ? window.location.href : `/class/${id}`;
  const copyInvite = async () => {
    try { await navigator.clipboard.writeText(inviteUrl); alert("Invite link copied"); }
    catch { prompt("Copy the invite link:", inviteUrl); }
  };

  const sync = useClassSync(id, me);

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
        <div className="mt-4 space-y-3">
          <AttendancePanel roomId={id} live={sync.participants} isCoach={sync.role === "coach"} />
          <RecordingsPanel roomId={id} isCoach={sync.role === "coach"} sync={sync} />
        </div>
      </section>
      {/* Video column — Jitsi iframe fills the rest. */}
      <section className="min-w-0 lg:min-h-0">
        <JitsiRoom roomId={id} displayName={userId || undefined} />
      </section>
    </div>
  );
}
