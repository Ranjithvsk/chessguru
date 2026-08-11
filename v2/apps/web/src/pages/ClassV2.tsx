// ChessGuru Live (P0) — LiveKit-backed video meeting for a class.
// Flow: user visits /class-v2/<roomName>?role=coach|student → we fetch a
// signed join token from /api/livekit/token → livekit-client SDK connects →
// LiveKit React components render the grid + tracks + controls.
//
// Requires the API to have LIVEKIT_URL / _API_KEY / _API_SECRET envs. Until
// those are set, the page renders a friendly "not configured yet" splash.
import { useEffect, useState } from "react";
import { Navigate, useParams, useSearchParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  LiveKitRoom, RoomAudioRenderer, ControlBar,
  GridLayout, ParticipantTile, useTracks, useParticipants,
} from "@livekit/components-react";
import { Track } from "livekit-client";
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
function VideoRail() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  return (
    <GridLayout tracks={tracks} style={{ height: "100%" }}>
      <ParticipantTile />
    </GridLayout>
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
          The video server hasn't been configured on the API. This is the P0 of
          the <b>Dream Meet</b> rollout — see
          <code className="mx-1">PROJECT_MASTER/plans/CHESSGURU-LIVE-VIDEO-PLATFORM.md</code>
          for the plan.
        </p>
        <div className="rounded-lg bg-black/30 p-3 font-mono text-xs">
          Set these env vars on the API and restart:<br/>
          <span className="text-amber-200">LIVEKIT_URL=wss://your-livekit-host</span><br/>
          <span className="text-amber-200">LIVEKIT_API_KEY=…</span><br/>
          <span className="text-amber-200">LIVEKIT_API_SECRET=…</span>
        </div>
        <p className="text-xs">
          For a 100-hour/mo free trial, sign up at{" "}
          <a href="https://cloud.livekit.io/" target="_blank" rel="noreferrer" className="underline">cloud.livekit.io</a> and
          copy the URL + API key + secret into pm2 env.
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
          video
          audio
          onError={(e) => setErrMsg(e.message)}
          className="flex h-full min-h-0 flex-col"
        >
          {/* Top bar */}
          <div className="flex items-center justify-between gap-2 border-b border-ink-800 bg-ink-900/80 px-4 py-2.5">
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

          {/* Body: board fills the whole stage; camera + controls float over it. */}
          <div className="relative min-h-0 flex-1 bg-ink-950/40 p-2">
            {/* Board centered; it self-sizes to the largest square that fits. */}
            <div className="flex h-full w-full items-center justify-center">
              <SharedClassBoard room={room} userId={me?.userId} displayName={me?.username} />
            </div>

            {/* Floating camera PIP — small coach cam in the top-right corner. */}
            <div className="absolute right-3 top-3 w-[190px] overflow-hidden rounded-xl border border-ink-700 bg-black/70 shadow-xl">
              <div className="h-[120px]">
                <VideoRail />
              </div>
            </div>

            {/* Floating minimal controls — mic / cam / screen, bottom-center. */}
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-xl border border-ink-800 bg-ink-900/85 shadow-xl backdrop-blur">
              <ControlBar variation="minimal" controls={{ microphone: true, camera: true, screenShare: true, chat: false, leave: false }} />
            </div>
          </div>
          <RoomAudioRenderer />
        </LiveKitRoom>
      </div>
    </div>
  );
}
