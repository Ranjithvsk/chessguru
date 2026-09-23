// Coach-side class recording (owner 2026-09-23).
//
// The upload, list, download and timeline endpoints have existed since Phase 3c,
// and two pages can already play what they return — but nothing in the app ever
// captured anything, so the store held zero files for zero classes and every
// replay was silent. This is the missing half.
//
// getDisplayMedia + MediaRecorder: the coach picks a screen or tab, and what
// they see and say is captured in their own browser and posted as one .webm on
// stop. Their microphone is mixed in explicitly — a display capture carries only
// the captured tab's audio, so without this the coach's own voice, the thing a
// lesson recording is mostly FOR, would be missing.
//
// Deliberately coach-initiated and loudly visible: a lesson full of children is
// not something to start recording quietly. The button states what is happening
// while it happens.

import { useCallback, useEffect, useRef, useState } from "react";
import { WINDOW_HOURS } from "./RecordingExpiry";

type Phase = "idle" | "asking" | "recording" | "saving" | "saved" | "failed";
/** Which of the two recorders is running.
 *
 *  "server" is better in every way that matters — it captures the whole room
 *  rather than one screen, it keeps recording if the coach's laptop closes, and
 *  it costs the coach no upload bandwidth — so it is tried first. "browser" is
 *  the fallback for when no egress worker is available, and is what the coach
 *  gets rather than nothing. */
type Mode = "server" | "browser";

/** Same tone vocabulary as the rest of the coach row. */
const BASE =
  "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium " +
  "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/70 " +
  "disabled:cursor-not-allowed disabled:opacity-40";
const IDLE = "border-ink-700/70 bg-ink-900 text-ink-200 hover:border-ink-600 hover:bg-ink-800 hover:text-white";
const LIVE = "border-rose-500/60 bg-rose-500/20 text-rose-100 hover:bg-rose-500/30";
const BUSY = "border-ink-700/70 bg-ink-900 text-ink-400";

/** MediaRecorder is fussy about container/codec support across browsers; take
 *  the first the browser admits to, and let it choose if none match. */
function pickMime(): string | undefined {
  const want = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  const MR: any = (window as any).MediaRecorder;
  if (!MR?.isTypeSupported) return undefined;
  return want.find((t) => MR.isTypeSupported(t));
}

export default function ClassRecordButton({ room }: { room: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [mode, setMode] = useState<Mode>("server");
  const [secs, setSecs] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const streams = useRef<MediaStream[]>([]);
  const startedAt = useRef<number>(0);
  const ticker = useRef<number | null>(null);

  const cleanup = useCallback(() => {
    if (ticker.current) { window.clearInterval(ticker.current); ticker.current = null; }
    for (const s of streams.current) { for (const t of s.getTracks()) { try { t.stop(); } catch { /* gone */ } } }
    streams.current = [];
    recRef.current = null;
  }, []);

  // A server recording outlives this tab, so a coach who reloads must find the
  // button already showing "recording" rather than an idle one that would start
  // a second capture of the same lesson.
  useEffect(() => {
    let dead = false;
    fetch(`/v2api/api/class/${encodeURIComponent(room)}/recording/server/status`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (dead || !d?.recording) return;
        setMode("server");
        startedAt.current = d.since ? new Date(d.since).getTime() : Date.now();
        setSecs(Math.max(0, Math.floor((Date.now() - startedAt.current) / 1000)));
        ticker.current = window.setInterval(() => setSecs(Math.floor((Date.now() - startedAt.current) / 1000)), 1000);
        setPhase("recording");
      })
      .catch(() => { /* no server recorder — the button stays idle */ });
    return () => { dead = true; };
  }, [room]);

  // A BROWSER recording left running when the coach closes the tab would be lost
  // with no trace, so stop and flush on unmount. A server one is left alone: it
  // is meant to survive this tab.
  useEffect(() => () => { try { recRef.current?.stop(); } catch { /* */ } cleanup(); }, [cleanup]);

  async function save(blob: Blob) {
    setPhase("saving");
    try {
      // The server names the file itself (an ISO stamp) and ignores anything we
      // suggest, so do not pretend otherwise by sending one.
      const r = await fetch(`/v2api/api/class/${encodeURIComponent(room)}/recording`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/octet-stream" },
        body: blob,
      });
      if (!r.ok) throw new Error(String(r.status));
      setPhase("saved");
      // Leave it saying "Saved" for longer than a toast: this is the coach's cue
      // that a 24-hour clock has started, and the thing they have to act on.
      window.setTimeout(() => setPhase("idle"), 20000);
    } catch (e: any) {
      setErr(`Could not save (${e?.message ?? "error"}). The recording is lost.`);
      setPhase("failed");
    }
  }

  /** Server-side, via LiveKit Egress. Returns false if it is not available, so
   *  the caller can fall back rather than leaving the coach with no recorder. */
  async function startServer(): Promise<boolean> {
    try {
      const r = await fetch(`/v2api/api/class/${encodeURIComponent(room)}/recording/server/start`, {
        method: "POST", credentials: "include",
      });
      if (!r.ok) return false;
      setMode("server");
      startedAt.current = Date.now();
      setSecs(0);
      ticker.current = window.setInterval(() => setSecs(Math.floor((Date.now() - startedAt.current) / 1000)), 1000);
      setPhase("recording");
      return true;
    } catch { return false; }
  }

  async function stopServer() {
    setPhase("saving");
    try {
      await fetch(`/v2api/api/class/${encodeURIComponent(room)}/recording/server/stop`, {
        method: "POST", credentials: "include",
      });
      if (ticker.current) { window.clearInterval(ticker.current); ticker.current = null; }
      setPhase("saved");
      window.setTimeout(() => setPhase("idle"), 6000);
    } catch {
      setErr("Could not stop the recording cleanly.");
      setPhase("failed");
    }
  }

  async function start() {
    setErr(null);
    // Try the server first; only ask the coach to share a screen if it cannot.
    setPhase("asking");
    if (await startServer()) return;
    setMode("browser");
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setErr("This browser cannot record a screen."); setPhase("failed"); return;
    }
    setPhase("asking");
    try {
      const display: MediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 15 },      // a chessboard does not need 60fps, and this keeps files small
        audio: true,                    // tab audio, where the browser offers it
      });
      streams.current.push(display);

      // Mix the coach's microphone in. Without it the recording has the board but
      // not the teaching.
      const tracks = [...display.getVideoTracks()];
      let mic: MediaStream | null = null;
      try {
        mic = await navigator.mediaDevices.getUserMedia({ audio: true });
        streams.current.push(mic);
      } catch { /* no mic permission — record what we can rather than nothing */ }

      const ctx = new AudioContext();
      const dest = ctx.createMediaStreamDestination();
      let anyAudio = false;
      for (const s of [display, mic].filter(Boolean) as MediaStream[]) {
        if (!s.getAudioTracks().length) continue;
        ctx.createMediaStreamSource(s).connect(dest);
        anyAudio = true;
      }
      if (anyAudio) tracks.push(...dest.stream.getAudioTracks());

      const mixed = new MediaStream(tracks);
      const mimeType = pickMime();
      const rec = new MediaRecorder(mixed, mimeType ? { mimeType } : undefined);
      chunks.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      rec.onstop = () => {
        cleanup();
        const blob = new Blob(chunks.current, { type: mimeType ?? "video/webm" });
        chunks.current = [];
        // The server refuses anything over 500MB; say so here rather than
        // uploading for minutes and then losing it to a 413.
        if (blob.size > 500 * 1024 * 1024) {
          setErr(`Recording is ${(blob.size / 1048576).toFixed(0)}MB — over the 500MB limit and not saved. Record in shorter parts.`);
          setPhase("failed");
        } else if (blob.size > 0) void save(blob);
        else { setErr("Nothing was captured."); setPhase("failed"); }
      };
      // The browser's own "Stop sharing" bar must end the recording too, or the
      // coach stops sharing and the recorder keeps writing a frozen frame.
      display.getVideoTracks()[0]?.addEventListener("ended", () => { try { rec.stop(); } catch { /* */ } });

      rec.start(5_000);                 // flush every 5s so a crash loses seconds, not the lesson
      recRef.current = rec;
      startedAt.current = Date.now();
      setSecs(0);
      ticker.current = window.setInterval(() => setSecs(Math.floor((Date.now() - startedAt.current) / 1000)), 1000);
      setPhase("recording");
    } catch {
      cleanup();
      setPhase("idle");                 // the coach cancelled the picker; not an error
    }
  }

  function stop() {
    if (mode === "server") { void stopServer(); return; }
    try { recRef.current?.stop(); } catch { /* */ }
  }

  const mmss = `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
  const label =
    phase === "recording" ? mmss
    : phase === "asking" ? "Starting…"
    : phase === "saving" ? "Saving…"
    : phase === "saved" ? "Saved"
    : "Record";

  return (
    <>
      <button
        onClick={phase === "recording" ? stop : phase === "idle" || phase === "failed" ? start : undefined}
        disabled={phase === "asking" || phase === "saving"}
        aria-pressed={phase === "recording"}
        title={
          phase === "recording"
            ? (mode === "server"
                ? "Recording the whole room on the server — click to stop and save"
                : "Recording your screen — click to stop and save")
            : "Record this class to the academy"
        }
        className={`${BASE} ${phase === "recording" ? LIVE : phase === "asking" || phase === "saving" ? BUSY : IDLE}`}
      >
        <span
          aria-hidden
          className={`inline-block h-2.5 w-2.5 rounded-full ${phase === "recording" ? "bg-rose-400 animate-pulse" : "bg-ink-500"}`}
        />
        <span className={phase === "recording" ? "tabular-nums" : "hidden sm:inline"}>{label}</span>
      </button>
      {phase === "saved" && (
        <span className="text-[11px] font-medium text-amber-300">
          Saved · kept {WINDOW_HOURS}h —{" "}
          <a href="/dashboard#recordings" className="underline">download it</a>
        </span>
      )}
      {err && <span className="text-[11px] font-medium text-rose-300">{err}</span>}
    </>
  );
}
