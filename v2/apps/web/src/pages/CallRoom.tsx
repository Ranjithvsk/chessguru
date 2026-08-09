// CallRoom — P2a of ChessGuru's "from-scratch Zoom" build.
//
// Mesh video call page (up to 8 participants) wired to the server-side
// WebSocket signaling relay at /v2api/api/video-signal/:room. Vanilla browser
// WebRTC APIs, no libs.
//
// Topology: full mesh. Each participant holds one RTCPeerConnection per other
// participant (N-1 PCs when there are N people in the room). Role assignment
// per-pair is deterministic: the peer with the LEXICOGRAPHICALLY LOWER peerId
// offers, the other answers. This avoids glare.
//
// ICE candidates that arrive before setRemoteDescription are buffered per-peer
// — ICE can start flowing before the SDP answer lands.
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

type ServerMsg =
  | { type: "hello"; self: string; peers: string[] }
  | { type: "peer-join"; peer: string }
  | { type: "peer-leave"; peer: string }
  | { type: "full" }
  | { type: "offer"; from: string; sdp: RTCSessionDescriptionInit }
  | { type: "answer"; from: string; sdp: RTCSessionDescriptionInit }
  | { type: "ice"; from: string; candidate: RTCIceCandidateInit | null };

type PeerState = {
  pc: RTCPeerConnection;
  remoteStream: MediaStream | null;
  pendingIce: RTCIceCandidateInit[];
};

// STUN-only fallback used if the /api/video/ice-config fetch fails (e.g. guest
// visitor). TURN URLs are fetched from the server per-session so credentials are
// fresh and short-lived (~1h). See fetchIceConfig() below.
const FALLBACK_ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  ],
};

async function fetchIceConfig(): Promise<RTCConfiguration> {
  try {
    const r = await fetch("/v2api/api/video/ice-config", { credentials: "include" });
    if (!r.ok) return FALLBACK_ICE_SERVERS;
    const j = await r.json();
    return Array.isArray(j?.iceServers) && j.iceServers.length ? { iceServers: j.iceServers } : FALLBACK_ICE_SERVERS;
  } catch { return FALLBACK_ICE_SERVERS; }
}

type Status =
  | "connecting"        // opening WS / getUserMedia
  | "waiting"           // in room, no peers yet
  | "negotiating"       // SDP handshake in progress with >=1 peer
  | "connected"         // at least one peer connection live
  | "full"              // server rejected: room already has 8
  | "denied"            // getUserMedia rejected
  | "error"             // catch-all
  | "left";             // user hit Leave

export default function CallRoomPage() {
  const { room = "" } = useParams<{ room: string }>();

  const [status, setStatus] = useState<Status>("connecting");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [sharing, setSharing] = useState(false);
  // Ordered list of remote peer ids — drives the grid render. Kept in sync
  // with peersRef's key set on every join/leave.
  const [peerIds, setPeerIds] = useState<string[]>([]);

  // Refs — held outside React state because they never trigger re-renders
  // and we need stable identity across effect closures.
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  // One entry per remote peer in the room. Map is stable across renders; the
  // peerIds state array is what actually triggers re-renders when membership
  // changes.
  const peersRef = useRef<Map<string, PeerState>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);
  const selfIdRef = useRef<string>("");
  // RTCConfiguration fetched from /api/video/ice-config (or fallback). Populated
  // before the WS opens so every createPc() gets the right servers.
  const iceConfigRef = useRef<RTCConfiguration>(FALLBACK_ICE_SERVERS);
  // While screen-sharing: the display stream, so we can restore camera cleanly.
  // Video RTCRtpSender's track gets replaced via replaceTrack() — no SDP re-neg.
  const displayStreamRef = useRef<MediaStream | null>(null);

  // Send a JSON message to the signaling server (guarded — WS may be gone).
  const send = (msg: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  // Sync the peerIds state array from the map. Called after any structural
  // change to peersRef (join, leave, initial hello).
  const syncPeerIds = () => setPeerIds([...peersRef.current.keys()]);

  // Recompute call-level status from the current set of PCs. If any PC is
  // connected → "connected"; else if any peers exist → "negotiating"; else
  // "waiting".
  const recomputeStatus = () => {
    let anyConnected = false;
    for (const p of peersRef.current.values()) {
      if (p.pc.connectionState === "connected") { anyConnected = true; break; }
    }
    if (anyConnected) setStatus("connected");
    else if (peersRef.current.size > 0) setStatus("negotiating");
    else setStatus("waiting");
  };

  // Build a fresh RTCPeerConnection for one specific remote peer and wire the
  // standard handlers. Stores the PeerState in peersRef and returns it.
  const createPc = (peerId: string): PeerState => {
    const pc = new RTCPeerConnection(iceConfigRef.current);
    const state: PeerState = { pc, remoteStream: null, pendingIce: [] };
    peersRef.current.set(peerId, state);

    pc.onicecandidate = (e) => {
      // Send null too — signals end-of-candidates to the remote.
      send({ type: "ice", to: peerId, candidate: e.candidate });
    };
    pc.ontrack = (e) => {
      const [stream] = e.streams;
      const cur = peersRef.current.get(peerId);
      if (cur && stream) {
        cur.remoteStream = stream;
        // Nudge React so the RemoteTile picks up the new stream. syncPeerIds
        // sets a fresh array reference even if membership hasn't changed.
        syncPeerIds();
      }
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === "failed" || s === "closed") {
        // Peer gone-bad: drop it so the grid updates. peer-leave from server
        // will usually beat us here, but be defensive.
        const existing = peersRef.current.get(peerId);
        if (existing && existing.pc === pc) {
          try { pc.close(); } catch { /* already closed */ }
          peersRef.current.delete(peerId);
          syncPeerIds();
        }
      }
      recomputeStatus();
    };

    // Attach our local tracks so the remote receives us.
    const local = localStreamRef.current;
    if (local) for (const t of local.getTracks()) pc.addTrack(t, local);

    // Prefer AV1 → VP9 → H264 for video: ~30% less bandwidth at the same
    // quality vs H264 (Zoom's default). setCodecPreferences is best-effort;
    // browsers without AV1 hardware fall through the list cleanly.
    try {
      const videoTx = pc.getTransceivers().find((t) => t.receiver.track?.kind === "video" || t.sender.track?.kind === "video");
      const caps = (RTCRtpSender as any).getCapabilities?.("video");
      if (videoTx && caps?.codecs?.length) {
        const rank = (c: any) => {
          const m = String(c.mimeType || "").toLowerCase();
          if (m.includes("av1")) return 0;
          if (m.includes("vp9")) return 1;
          if (m.includes("vp8")) return 2;
          if (m.includes("h264")) return 3;
          return 4;
        };
        const preferred = [...caps.codecs].sort((a, b) => rank(a) - rank(b));
        (videoTx as any).setCodecPreferences?.(preferred);
      }
    } catch { /* older browsers — fall back to browser default */ }

    return state;
  };

  // I offer if my id sorts before theirs. Deterministic, no glare. Applied
  // pairwise, so every ordered pair has exactly one offerer.
  const shouldOffer = (self: string, other: string) => self < other;

  const startOffer = async (peerId: string) => {
    const state = peersRef.current.get(peerId);
    if (!state) return;
    setStatus("negotiating");
    const offer = await state.pc.createOffer();
    await state.pc.setLocalDescription(offer);
    send({ type: "offer", to: peerId, sdp: offer });
  };

  const handleOffer = async (from: string, sdp: RTCSessionDescriptionInit) => {
    let state = peersRef.current.get(from);
    if (!state) { state = createPc(from); syncPeerIds(); }
    setStatus("negotiating");
    await state.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    // Drain any ICE that arrived before we had a remote description.
    for (const c of state.pendingIce) {
      try { await state.pc.addIceCandidate(new RTCIceCandidate(c)); } catch {/* stale */}
    }
    state.pendingIce = [];
    const answer = await state.pc.createAnswer();
    await state.pc.setLocalDescription(answer);
    send({ type: "answer", to: from, sdp: answer });
  };

  const handleAnswer = async (from: string, sdp: RTCSessionDescriptionInit) => {
    const state = peersRef.current.get(from);
    if (!state) return;
    await state.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    for (const c of state.pendingIce) {
      try { await state.pc.addIceCandidate(new RTCIceCandidate(c)); } catch {/* stale */}
    }
    state.pendingIce = [];
  };

  const handleIce = async (from: string, candidate: RTCIceCandidateInit | null) => {
    if (!candidate) return; // end-of-candidates marker; nothing to add
    const state = peersRef.current.get(from);
    if (!state) return; // ICE for a peer we never opened; drop.
    if (!state.pc.remoteDescription) {
      // Race: candidate arrived before remote SDP. Buffer for later.
      state.pendingIce.push(candidate);
      return;
    }
    try { await state.pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {/* stale */}
  };

  // Full teardown — used by unmount + Leave button.
  const teardown = () => {
    for (const [, state] of peersRef.current) {
      try { state.pc.close(); } catch { /* already closed */ }
    }
    peersRef.current.clear();
    if (localStreamRef.current) {
      for (const t of localStreamRef.current.getTracks()) t.stop();
      localStreamRef.current = null;
    }
    if (displayStreamRef.current) {
      for (const t of displayStreamRef.current.getTracks()) t.stop();
      displayStreamRef.current = null;
    }
    if (wsRef.current) { try { wsRef.current.close(); } catch { /* already closed */ } wsRef.current = null; }
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    setPeerIds([]);
  };

  useEffect(() => {
    if (!room) { setStatus("error"); setErrorMsg("Missing room id."); return; }

    let cancelled = false;

    (async () => {
      // 1) Local media first — no point wiring signaling if we can't send anything.
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      } catch (e) {
        if (!cancelled) { setStatus("denied"); setErrorMsg(String((e as Error).message || e)); }
        return;
      }
      if (cancelled) { for (const t of stream.getTracks()) t.stop(); return; }
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      // 1b) Fetch fresh iceServers (STUN + short-lived TURN creds) before any
      //     RTCPeerConnection is constructed. Falls back to STUN-only if we
      //     can't reach the endpoint (guest / dev / network issue).
      iceConfigRef.current = await fetchIceConfig();
      if (cancelled) return;

      // 2) Signaling WebSocket.
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${proto}//${location.host}/v2api/api/video-signal/${encodeURIComponent(room)}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => { if (!cancelled) setStatus("waiting"); };
      ws.onerror = () => { if (!cancelled) { setStatus("error"); setErrorMsg("Signaling connection error."); } };
      ws.onclose = () => {
        // Server closes after sending {type:"full"}; we already switched status there.
        // Any other close is benign if we've already left.
      };

      ws.onmessage = async (ev) => {
        let msg: ServerMsg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (cancelled) return;

        switch (msg.type) {
          case "hello": {
            selfIdRef.current = msg.self;
            // For EACH peer already in the room, spin up a PC. If our id sorts
            // before theirs, we offer; else we wait for their offer.
            for (const other of msg.peers) {
              if (peersRef.current.has(other)) continue;
              createPc(other);
              if (shouldOffer(msg.self, other)) await startOffer(other);
            }
            syncPeerIds();
            if (msg.peers.length > 0) setStatus("negotiating");
            break;
          }
          case "peer-join": {
            // A new participant arrived. Spin up a PC and apply the same
            // pairwise offerer rule.
            if (!peersRef.current.has(msg.peer)) createPc(msg.peer);
            syncPeerIds();
            if (shouldOffer(selfIdRef.current, msg.peer)) await startOffer(msg.peer);
            else setStatus("negotiating");
            break;
          }
          case "peer-leave": {
            const state = peersRef.current.get(msg.peer);
            if (state) {
              try { state.pc.close(); } catch { /* already closed */ }
              peersRef.current.delete(msg.peer);
              syncPeerIds();
              recomputeStatus();
            }
            break;
          }
          case "full": {
            setStatus("full");
            break;
          }
          case "offer":  await handleOffer(msg.from, msg.sdp); break;
          case "answer": await handleAnswer(msg.from, msg.sdp); break;
          case "ice":    await handleIce(msg.from, msg.candidate); break;
        }
      };
    })();

    return () => { cancelled = true; teardown(); };
    // Room id fully drives the effect; nothing else should re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);

  const toggleMic = () => {
    const s = localStreamRef.current; if (!s) return;
    const next = !micOn;
    for (const t of s.getAudioTracks()) t.enabled = next;
    setMicOn(next);
  };
  const toggleCam = () => {
    const s = localStreamRef.current; if (!s) return;
    const next = !camOn;
    for (const t of s.getVideoTracks()) t.enabled = next;
    setCamOn(next);
  };
  const leave = () => { teardown(); setStatus("left"); };

  // Screen share: swap the outgoing video track on every peer connection to
  // the display-media track via RTCRtpSender.replaceTrack (no SDP re-neg,
  // hot swap in <200ms). On stop or displayTrack.onended, swap back to the
  // camera track. Self-view also switches to the display for feedback.
  const toggleShare = async () => {
    if (sharing) {
      // Stop sharing → put camera back.
      const display = displayStreamRef.current;
      if (display) for (const t of display.getTracks()) t.stop();
      displayStreamRef.current = null;
      const camTrack = localStreamRef.current?.getVideoTracks()[0];
      if (camTrack) {
        for (const state of peersRef.current.values()) {
          const sender = state.pc.getSenders().find((s) => s.track?.kind === "video");
          try { await sender?.replaceTrack(camTrack); } catch { /* peer gone */ }
        }
        if (localVideoRef.current && localStreamRef.current) localVideoRef.current.srcObject = localStreamRef.current;
      }
      setSharing(false);
      return;
    }
    // Start sharing
    let display: MediaStream;
    try {
      display = await (navigator.mediaDevices as any).getDisplayMedia({ video: true, audio: false });
    } catch { return; /* user cancelled */ }
    displayStreamRef.current = display;
    const shareTrack = display.getVideoTracks()[0];
    if (!shareTrack) return;
    shareTrack.onended = () => { void toggleShare(); };   // browser "Stop sharing" button
    for (const state of peersRef.current.values()) {
      const sender = state.pc.getSenders().find((s) => s.track?.kind === "video");
      try { await sender?.replaceTrack(shareTrack); } catch { /* peer gone */ }
    }
    if (localVideoRef.current) localVideoRef.current.srcObject = display;
    setSharing(true);
  };

  // ---- Splash screens ------------------------------------------------------
  if (status === "denied") return <Splash title="Camera & mic permission needed"
    body="Allow camera and microphone access in your browser, then reload this page." detail={errorMsg} />;
  if (status === "full")   return <Splash title="This room is full"
    body="Rooms are capped at 8 participants." />;
  if (status === "left")   return <Splash title="You left the call" />;
  if (status === "error")  return <Splash title="Something went wrong" body={errorMsg} />;

  // ---- Live call view ------------------------------------------------------

  // Header count includes self.
  const currentCount = peerIds.length + 1;

  // Explicit grid columns tuned per participant count. auto-fit with a min
  // width would also work; explicit keeps the cell aspect predictable.
  let gridCols = "grid-cols-1";
  if (peerIds.length === 2) gridCols = "grid-cols-2";
  else if (peerIds.length >= 3 && peerIds.length <= 4) gridCols = "grid-cols-2";
  else if (peerIds.length >= 5 && peerIds.length <= 6) gridCols = "grid-cols-3";
  else if (peerIds.length >= 7) gridCols = "grid-cols-3";

  return (
    <div className="min-h-screen bg-ink-950 text-white flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 border-b border-ink-700">
        <Link to="/academy" className="text-ink-300 hover:text-white text-sm">← Back</Link>
        <div className="text-xs text-ink-300">
          <span className="font-mono">{room}</span>
          <span className="mx-2 text-ink-500">·</span>
          <span>{currentCount}/8 in room</span>
          <span className="mx-2 text-ink-500">·</span>
          <span>{status}</span>
        </div>
      </header>

      <main className="relative flex-1 flex items-center justify-center p-4">
        {peerIds.length === 0 ? (
          <div className="w-full max-w-4xl aspect-video rounded-xl2 border border-ink-700 bg-black overflow-hidden shadow-lg">
            <div className="w-full h-full flex flex-col items-center justify-center text-center px-6">
              <div className="h-12 w-12 rounded-full border-2 border-brand-600 border-t-transparent animate-spin mb-4" />
              <p className="text-lg text-white">Waiting for someone to join…</p>
              <p className="mt-2 text-sm text-ink-300">
                Room <span className="font-mono">{room}</span> (0/8)
              </p>
            </div>
          </div>
        ) : (
          <div className={`grid ${gridCols} gap-3 w-full max-w-6xl`}>
            {peerIds.map((id, idx) => (
              <RemoteTile
                key={id}
                peerId={id}
                index={idx}
                getStream={() => peersRef.current.get(id)?.remoteStream ?? null}
              />
            ))}
          </div>
        )}

        {/* Self-view: always visible, bottom-right */}
        <div className="absolute bottom-6 right-6 w-40 h-28 rounded-lg overflow-hidden border border-white/20 shadow-lg bg-black">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
          {!camOn && (
            <div className="absolute inset-0 flex items-center justify-center bg-ink-800/90 text-xs text-ink-300">
              Camera off
            </div>
          )}
        </div>
      </main>

      <footer className="flex items-center justify-center gap-3 py-4 border-t border-ink-700 bg-ink-900">
        <button
          onClick={toggleMic}
          className={`rounded-xl2 px-4 py-2 text-sm ${micOn ? "bg-ink-800 hover:bg-ink-700" : "bg-rose-600 hover:bg-rose-500"} text-white`}
        >
          {micOn ? "🎤 Mute mic" : "🎤 Unmute"}
        </button>
        <button
          onClick={toggleCam}
          className={`rounded-xl2 px-4 py-2 text-sm ${camOn ? "bg-ink-800 hover:bg-ink-700" : "bg-rose-600 hover:bg-rose-500"} text-white`}
        >
          {camOn ? "📷 Cam off" : "📷 Cam on"}
        </button>
        <button
          onClick={toggleShare}
          className={`rounded-xl2 px-4 py-2 text-sm ${sharing ? "bg-emerald-600 hover:bg-emerald-500" : "bg-ink-800 hover:bg-ink-700"} text-white`}
        >
          {sharing ? "🛑 Stop sharing" : "🖥️ Share screen"}
        </button>
        <button
          onClick={leave}
          className="rounded-xl2 px-4 py-2 text-sm bg-rose-600 hover:bg-rose-500 text-white"
        >
          ☎️ Leave
        </button>
      </footer>
    </div>
  );
}

// One remote peer's video cell. Reads its MediaStream via getStream() on each
// render, which lets the parent keep the actual stream on peersRef (a ref) and
// still get the srcObject attached every time React re-renders — including the
// re-render triggered by ontrack via syncPeerIds().
function RemoteTile({
  peerId,
  index,
  getStream,
}: {
  peerId: string;
  index: number;
  getStream: () => MediaStream | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stream = getStream();

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  return (
    <div className="relative aspect-video rounded-lg border border-ink-700 bg-ink-900 overflow-hidden">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className={`w-full h-full object-cover ${stream ? "" : "hidden"}`}
      />
      {!stream && (
        <div className="w-full h-full flex items-center justify-center text-xs text-ink-400">
          Connecting…
        </div>
      )}
      <div className="absolute bottom-1 left-1 px-2 py-0.5 rounded bg-black/60 text-[10px] text-white font-mono">
        Peer {index + 1} · {peerId.slice(0, 6)}
      </div>
    </div>
  );
}

// Shared wrapper for pre-call / error states — one place for the card styling.
function Splash({ title, body, detail }: { title: string; body?: string; detail?: string }) {
  return (
    <div className="min-h-screen bg-ink-950 flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded-xl2 border border-ink-700 bg-ink-900 p-6 text-center">
        <h2 className="text-xl font-semibold text-white">{title}</h2>
        {body && <p className="mt-2 text-ink-300">{body}</p>}
        {detail && <p className="mt-3 text-xs text-ink-400">{detail}</p>}
        <Link to="/academy" className="mt-6 inline-block rounded-xl2 bg-brand-600 px-4 py-2 text-white">
          Back to Academy
        </Link>
      </div>
    </div>
  );
}
