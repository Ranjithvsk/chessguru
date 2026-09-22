// Watch a live class without anyone in it knowing (owner 2026-09-22).
//
// The invisibility is enforced on the SERVER, not here — class-ws keeps an
// observer off the participant count, the roster, the attendance register and
// the join/leave announcements, and ignores every frame it sends; LiveKit marks
// the audio/video identity `hidden` so the watcher is not a face in the call.
// This page's job is to obtain the grant and then get out of the way, reusing
// the real SharedClassBoard so what the watcher sees is literally what the class
// sees, not a second rendering that could drift from it.

import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import SharedClassBoard from "../components/SharedClassBoard";
import { post, get, API_BASE } from "../lib/api";

type Grant = { ok: true; token: string; classId: string; expiresAt: string; title?: string };
type LKToken = { ok: true; token: string; url: string };

export default function ClassWatch() {
  const { id = "" } = useParams();
  const [grant, setGrant] = useState<Grant | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [audio, setAudio] = useState<"off" | "joining" | "on" | "failed">("off");
  const lkRef = useRef<any>(null);
  const sinkRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const g = await post<Grant>(`/api/class/${encodeURIComponent(id)}/observe-token`, {});
        if (!dead) setGrant(g);
      } catch {
        if (!dead) setErr("You are not allowed to watch this class, or it does not exist.");
      }
    })();
    return () => { dead = true; };
  }, [id]);

  // Audio/video is opt-in and separate from the board. It is the part that costs
  // bandwidth and the part most likely to fail on a locked-down network, and a
  // watcher usually wants to read the board rather than listen.
  async function listen() {
    if (audio !== "off") return;
    setAudio("joining");
    try {
      const t = await get<LKToken>(`/api/livekit/token?room=${encodeURIComponent(id)}&role=observer`);
      const { Room, RoomEvent } = await import("livekit-client");
      const room = new Room();
      lkRef.current = room;
      room.on(RoomEvent.TrackSubscribed, (track: any) => {
        if (!sinkRef.current) return;
        if (track.kind === "audio" || track.kind === "video") {
          const el = track.attach();
          if (track.kind === "video") { el.style.width = "100%"; el.style.borderRadius = "10px"; }
          sinkRef.current.appendChild(el);
        }
      });
      await room.connect(t.url, t.token);
      setAudio("on");
    } catch {
      setAudio("failed");
    }
  }
  useEffect(() => () => { try { lkRef.current?.disconnect(); } catch { /* gone */ } }, []);

  if (err) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="rounded-2xl border border-rose-300 bg-rose-50 p-5 text-rose-900">
          <div className="text-lg font-bold">Cannot watch this class</div>
          <p className="mt-1 text-sm">{err}</p>
          <Link to="/dashboard" className="mt-3 inline-block text-sm font-semibold underline">Back to dashboard</Link>
        </div>
      </div>
    );
  }
  if (!grant) return <div className="p-6 text-sm text-ink-400">Getting permission…</div>;

  return (
    <div className="mx-auto max-w-6xl p-4">
      <header className="mb-3 flex flex-wrap items-center gap-3">
        <span className="rounded-full bg-violet-600 px-3 py-1 text-xs font-black uppercase tracking-wider text-white">
          👁 Watching silently
        </span>
        <h1 className="text-lg font-black text-ink-900">{grant.title || "Class"}</h1>
        <div className="flex-1" />
        {audio === "off" && (
          <button onClick={listen} className="rounded-lg border border-ink-300 bg-white px-3 py-1.5 text-xs font-bold text-ink-700 hover:bg-ink-50">
            🔊 Also listen
          </button>
        )}
        {audio === "joining" && <span className="text-xs text-ink-400">connecting audio…</span>}
        {audio === "on" && <span className="text-xs font-bold text-emerald-600">🔊 listening</span>}
        {audio === "failed" && <span className="text-xs font-bold text-rose-600">audio unavailable</span>}
        <Link to={`/watch/${encodeURIComponent(id)}/replay`} className="rounded-lg border border-ink-300 bg-white px-3 py-1.5 text-xs font-bold text-ink-700 hover:bg-ink-50">
          ⏪ Replay
        </Link>
      </header>

      <p className="mb-3 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-900">
        Nobody in this class can see you. You are not in the participant count, the roster or the
        attendance register, no join or leave is announced, and the board ignores anything you do.
      </p>

      <SharedClassBoard room={id} observerToken={grant.token} />
      <div ref={sinkRef} className="mt-4 grid gap-2 sm:grid-cols-2" />
      <p className="mt-4 text-[11px] text-ink-400">Class room <code>{id}</code> · API {API_BASE || "same origin"}</p>
    </div>
  );
}
