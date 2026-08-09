// CallRoom — P0 of ChessGuru's "from-scratch Zoom" build.
//
// A 1:1 video call page wired to the server-side WebSocket signaling relay at
// /v2api/api/video-signal/:room. Uses vanilla browser WebRTC APIs, no libs.
//
// Role assignment is deterministic: the peer with the LEXICOGRAPHICALLY LOWER
// peerId offers, the other answers. This avoids extra signaling round-trips
// and glare (both sides offering at once).
//
// Buffers ICE candidates that arrive before setRemoteDescription — a common
// race because ICE can start flowing before the SDP answer lands.
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

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  ],
};

type Status =
  | "connecting"        // opening WS / getUserMedia
  | "waiting"           // in room, no peer yet
  | "negotiating"       // SDP handshake in progress
  | "connected"         // peer connection live
  | "full"              // server rejected: room already has 2
  | "denied"            // getUserMedia rejected
  | "error"             // catch-all
  | "left";             // user hit Leave

export default function CallRoomPage() {
  const { room = "" } = useParams<{ room: string }>();

  const [status, setStatus] = useState<Status>("connecting");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [hasRemote, setHasRemote] = useState(false);

  // Refs — held outside React state because they never trigger re-renders
  // and we need stable identity across effect closures.
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const selfIdRef = useRef<string>("");
  const peerIdRef = useRef<string>("");
  // ICE candidates buffered while remoteDescription is still null.
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);

  // Send a JSON message to the signaling server (guarded — WS may be gone).
  const send = (msg: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  // Build a fresh RTCPeerConnection and wire the standard handlers.
  const createPc = (peerId: string): RTCPeerConnection => {
    const pc = new RTCPeerConnection(ICE_SERVERS);

    pc.onicecandidate = (e) => {
      // Send null too — signals end-of-candidates to the remote.
      send({ type: "ice", to: peerId, candidate: e.candidate });
    };
    pc.ontrack = (e) => {
      const [stream] = e.streams;
      if (remoteVideoRef.current && stream) {
        remoteVideoRef.current.srcObject = stream;
        setHasRemote(true);
      }
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === "connected") setStatus("connected");
      else if (s === "failed" || s === "disconnected") setStatus("negotiating");
    };

    // Attach our local tracks so the remote receives us.
    const local = localStreamRef.current;
    if (local) for (const t of local.getTracks()) pc.addTrack(t, local);

    return pc;
  };

  // I offer if my id sorts before theirs. Deterministic, no glare.
  const shouldOffer = (self: string, other: string) => self < other;

  const startOffer = async (peerId: string) => {
    const pc = pcRef.current;
    if (!pc) return;
    setStatus("negotiating");
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    send({ type: "offer", to: peerId, sdp: offer });
  };

  const handleOffer = async (from: string, sdp: RTCSessionDescriptionInit) => {
    if (!pcRef.current) pcRef.current = createPc(from);
    peerIdRef.current = from;
    const pc = pcRef.current;
    setStatus("negotiating");
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    // Drain any ICE that arrived before we had a remote description.
    for (const c of pendingIceRef.current) {
      try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {/* stale */}
    }
    pendingIceRef.current = [];
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    send({ type: "answer", to: from, sdp: answer });
  };

  const handleAnswer = async (sdp: RTCSessionDescriptionInit) => {
    const pc = pcRef.current;
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    for (const c of pendingIceRef.current) {
      try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {/* stale */}
    }
    pendingIceRef.current = [];
  };

  const handleIce = async (candidate: RTCIceCandidateInit | null) => {
    if (!candidate) return; // end-of-candidates marker; nothing to add
    const pc = pcRef.current;
    if (!pc || !pc.remoteDescription) {
      // Race: candidate arrived before remote SDP. Buffer for later.
      pendingIceRef.current.push(candidate);
      return;
    }
    try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {/* stale */}
  };

  // Full teardown — used by unmount + Leave button + peer-leave.
  const teardown = () => {
    if (pcRef.current) { try { pcRef.current.close(); } catch {} pcRef.current = null; }
    if (localStreamRef.current) {
      for (const t of localStreamRef.current.getTracks()) t.stop();
      localStreamRef.current = null;
    }
    if (wsRef.current) { try { wsRef.current.close(); } catch {} wsRef.current = null; }
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    setHasRemote(false);
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
            // If a peer is ALREADY here, decide role and maybe offer.
            const other = msg.peers[0];
            if (other) {
              peerIdRef.current = other;
              pcRef.current = createPc(other);
              if (shouldOffer(msg.self, other)) await startOffer(other);
              else setStatus("negotiating"); // wait for their offer
            }
            break;
          }
          case "peer-join": {
            // We were alone; someone joined. Only one of us offers.
            peerIdRef.current = msg.peer;
            if (!pcRef.current) pcRef.current = createPc(msg.peer);
            if (shouldOffer(selfIdRef.current, msg.peer)) await startOffer(msg.peer);
            else setStatus("negotiating");
            break;
          }
          case "peer-leave": {
            if (pcRef.current) { try { pcRef.current.close(); } catch {} pcRef.current = null; }
            if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
            pendingIceRef.current = [];
            peerIdRef.current = "";
            setHasRemote(false);
            setStatus("waiting");
            break;
          }
          case "full": {
            setStatus("full");
            break;
          }
          case "offer":  await handleOffer(msg.from, msg.sdp); break;
          case "answer": await handleAnswer(msg.sdp); break;
          case "ice":    await handleIce(msg.candidate); break;
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

  // ---- Splash screens ------------------------------------------------------
  if (status === "denied") return <Splash title="Camera & mic permission needed"
    body="Allow camera and microphone access in your browser, then reload this page." detail={errorMsg} />;
  if (status === "full")   return <Splash title="This room is full"
    body="Only 2 people can be in a room at a time in P0." />;
  if (status === "left")   return <Splash title="You left the call" />;
  if (status === "error")  return <Splash title="Something went wrong" body={errorMsg} />;

  // ---- Live call view ------------------------------------------------------

  return (
    <div className="min-h-screen bg-ink-950 text-white flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 border-b border-ink-700">
        <Link to="/academy" className="text-ink-300 hover:text-white text-sm">← Back</Link>
        <div className="text-xs text-ink-300">
          <span className="font-mono">{room}</span>
          <span className="mx-2 text-ink-500">·</span>
          <span>{status}</span>
        </div>
      </header>

      <main className="relative flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-4xl aspect-video rounded-xl2 border border-ink-700 bg-black overflow-hidden shadow-lg">
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className={`w-full h-full object-cover ${hasRemote ? "" : "hidden"}`}
          />
          {!hasRemote && (
            <div className="w-full h-full flex flex-col items-center justify-center text-center px-6">
              <div className="h-12 w-12 rounded-full border-2 border-brand-600 border-t-transparent animate-spin mb-4" />
              <p className="text-lg text-white">Waiting for the other person to join…</p>
              <p className="mt-2 text-sm text-ink-300">
                Room <span className="font-mono">{room}</span>
              </p>
            </div>
          )}
        </div>

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
          onClick={leave}
          className="rounded-xl2 px-4 py-2 text-sm bg-rose-600 hover:bg-rose-500 text-white"
        >
          ☎️ Leave
        </button>
      </footer>
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
