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
  LiveKitRoom, VideoConference,
  RoomAudioRenderer, ControlBar,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { api } from "../lib/api";

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
        <h1 className="font-display text-xl text-white">ChessGuru Live isn't turned on yet</h1>
        <p className="text-sm">
          The video server (LiveKit) hasn't been configured on the API. This is the P0 of
          the <b>ChessGuru Live</b> rollout — see
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
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-400">
        <span>🎥 <b className="text-white">{room}</b> · you're joining as <b className="text-brand-300">{role}</b></span>
        <Link to="/class" className="hover:text-white">← All classes</Link>
      </div>
      <div className="rounded-xl2 border border-ink-700 bg-ink-900" style={{ height: "78vh" }} data-lk-theme="default">
        <LiveKitRoom
          serverUrl={tokenData.url}
          token={tokenData.token}
          connect
          video
          audio
          onError={(e) => setErrMsg(e.message)}
          style={{ height: "100%" }}
        >
          <VideoConference />
          <ControlBar />
          <RoomAudioRenderer />
        </LiveKitRoom>
      </div>
      <p className="mt-2 text-[10px] text-ink-500">
        ChessGuru Live · P0 shell. Coach controls, screen share, chat, breakouts and recording ship in P1
        (see PROJECT_MASTER/plans/CHESSGURU-LIVE-VIDEO-PLATFORM.md).
      </p>
    </div>
  );
}
