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
function useClassSync(roomId: string | undefined) {
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
        // Hello with our saved coach token (if any) so a reconnect resumes coach role.
        try { ws.send(JSON.stringify({ type: "hello", coachToken: loadCoachToken(roomId) })); } catch { /* */ }
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
        <div className="mt-4">
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
