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

type Phase = "idle" | "asking" | "recording" | "saving" | "saved" | "failed";

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

  // A recording left running when the coach closes the tab would be lost with no
  // trace, so stop and flush on unmount.
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
      window.setTimeout(() => setPhase("idle"), 6000);
    } catch (e: any) {
      setErr(`Could not save (${e?.message ?? "error"}). The recording is lost.`);
      setPhase("failed");
    }
  }

  async function start() {
    setErr(null);
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

  function stop() { try { recRef.current?.stop(); } catch { /* */ } }

  const mmss = `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
  const label =
    phase === "recording" ? mmss
    : phase === "asking" ? "Choose…"
    : phase === "saving" ? "Saving…"
    : phase === "saved" ? "Saved"
    : "Record";

  return (
    <>
      <button
        onClick={phase === "recording" ? stop : phase === "idle" || phase === "failed" ? start : undefined}
        disabled={phase === "asking" || phase === "saving"}
        aria-pressed={phase === "recording"}
        title={phase === "recording" ? "Stop recording and save" : "Record this class to the academy"}
        className={`${BASE} ${phase === "recording" ? LIVE : phase === "asking" || phase === "saving" ? BUSY : IDLE}`}
      >
        <span
          aria-hidden
          className={`inline-block h-2.5 w-2.5 rounded-full ${phase === "recording" ? "bg-rose-400 animate-pulse" : "bg-ink-500"}`}
        />
        <span className={phase === "recording" ? "tabular-nums" : "hidden sm:inline"}>{label}</span>
      </button>
      {err && <span className="text-[11px] font-medium text-rose-300">{err}</span>}
    </>
  );
}
