// CallRoom — P2a of ChessGuru's "from-scratch Zoom" build.
//
// Mesh video call page (up to 8) on /v2api/api/video-signal/:room. Full mesh,
// lex-lower peerId offers to avoid glare. Early-ICE buffered per peer.
//
// `?board=1` opts into the chess-native layout: big Chessground on the left,
// vertical column of video tiles on the right (stacks below md:). Board state
// is synced through the EXISTING class-ws bus (/v2api/class-ws/:room) which
// validates moves server-side with chess.js and echoes to everyone, so we
// treat server as truth. The class-ws lives in its own useEffect with its own
// teardown — independent of the signaling WS.
import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Chess } from "chess.js";
import type { Key } from "chessground/types";
import Board, { destsFromChess } from "../components/Board";

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

// Class-ws (shared-board) frames — subset we handle. See apps/api/src/class/class-ws.ts.
type BoardMove = { from: string; to: string; promotion?: string };
type BoardServerMsg =
  | { type: "state"; fen: string; lastMove: BoardMove | null; history: BoardMove[] }
  | { type: "move"; move: BoardMove; fen: string }
  | { type: "reset"; fen: string }
  | { type: string; [k: string]: unknown };

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// STUN-only fallback if /api/video/ice-config fails (guest / dev / network).
// TURN URLs come per-session from that endpoint (~1h creds). See fetchIceConfig().
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
  const [searchParams] = useSearchParams();
  const boardMode = searchParams.get("board") === "1";

  const [status, setStatus] = useState<Status>("connecting");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [sharing, setSharing] = useState(false);
  // Drives grid render; mirrors peersRef.keys() on every join/leave.
  const [peerIds, setPeerIds] = useState<string[]>([]);

  // Refs — stable identity, no re-renders. peersRef map is what actually holds
  // per-peer state; peerIds state array is the render trigger.
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, PeerState>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);
  const selfIdRef = useRef<string>("");
  // Fetched from /api/video/ice-config (or fallback) before any PC is built.
  const iceConfigRef = useRef<RTCConfiguration>(FALLBACK_ICE_SERVERS);
  // Screen-share display stream — kept so we can stop its tracks + restore cam.
  const displayStreamRef = useRef<MediaStream | null>(null);

  // Guarded send to signaling — WS may be gone.
  const send = (msg: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };
  // Push peersRef membership → peerIds state (also nudges React for stream updates).
  const syncPeerIds = () => setPeerIds([...peersRef.current.keys()]);
  // any PC connected → "connected"; else any peers → "negotiating"; else "waiting".
  const recomputeStatus = () => {
    let anyConnected = false;
    for (const p of peersRef.current.values()) {
      if (p.pc.connectionState === "connected") { anyConnected = true; break; }
    }
    if (anyConnected) setStatus("connected");
    else if (peersRef.current.size > 0) setStatus("negotiating");
    else setStatus("waiting");
  };

  // Build one RTCPeerConnection for a remote peer, wire handlers, store in peersRef.
  const createPc = (peerId: string): PeerState => {
    const pc = new RTCPeerConnection(iceConfigRef.current);
    const state: PeerState = { pc, remoteStream: null, pendingIce: [] };
    peersRef.current.set(peerId, state);

    // Send null too — signals end-of-candidates to the remote.
    pc.onicecandidate = (e) => send({ type: "ice", to: peerId, candidate: e.candidate });
    pc.ontrack = (e) => {
      const [stream] = e.streams;
      const cur = peersRef.current.get(peerId);
      if (cur && stream) { cur.remoteStream = stream; syncPeerIds(); }
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === "failed" || s === "closed") {
        // Defensive drop — peer-leave from server usually beats us here.
        const existing = peersRef.current.get(peerId);
        if (existing && existing.pc === pc) {
          try { pc.close(); } catch { /* already closed */ }
          peersRef.current.delete(peerId);
          syncPeerIds();
        }
      }
      recomputeStatus();
    };

    const local = localStreamRef.current;
    if (local) for (const t of local.getTracks()) pc.addTrack(t, local);

    // Prefer AV1 → VP9 → H264: ~30% less bandwidth vs H264 at same quality.
    // Best-effort; browsers without AV1 fall through the list cleanly.
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

  // Lex-lower id offers → deterministic, no glare (one offerer per pair).
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
    if (!candidate) return; // end-of-candidates marker
    const state = peersRef.current.get(from);
    if (!state) return;
    // Race: candidate before remote SDP → buffer.
    if (!state.pc.remoteDescription) { state.pendingIce.push(candidate); return; }
    try { await state.pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {/* stale */}
  };

  // Full teardown — unmount + Leave. Signaling + media only; class-ws teardown
  // lives in its own effect and runs independently.
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
      // 1) Local media first — no signaling without a stream to send.
      let stream: MediaStream;
      try {
        // Browser-native audio quality: echo cancellation, noise suppression,
        // AGC. Chrome/Edge use their built-in RNNoise; Firefox/Safari have
        // similar. Meaningful win vs raw mic capture, zero deps or WASM setup.
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch (e) {
        if (!cancelled) { setStatus("denied"); setErrorMsg(String((e as Error).message || e)); }
        return;
      }
      if (cancelled) { for (const t of stream.getTracks()) t.stop(); return; }
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      // 1b) Fresh iceServers (STUN + short-lived TURN) before any PC is built.
      iceConfigRef.current = await fetchIceConfig();
      if (cancelled) return;

      // 2) Signaling WebSocket.
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${proto}//${location.host}/v2api/api/video-signal/${encodeURIComponent(room)}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => { if (!cancelled) setStatus("waiting"); };
      ws.onerror = () => { if (!cancelled) { setStatus("error"); setErrorMsg("Signaling connection error."); } };
      ws.onclose = () => { /* {type:"full"} already flipped status; other closes benign */ };

      ws.onmessage = async (ev) => {
        let msg: ServerMsg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (cancelled) return;

        switch (msg.type) {
          case "hello": {
            selfIdRef.current = msg.self;
            // For each peer already in the room, spin up a PC + apply pairwise offerer rule.
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
          case "full": setStatus("full"); break;
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

  // Screen share: replaceTrack the outgoing video sender on every PC (no SDP re-neg,
  // <200ms). Restore on stop / displayTrack.onended. Self-view mirrors the display.
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

  return (
    <div className="min-h-screen bg-ink-950 text-white flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 border-b border-ink-700">
        <div className="flex items-center gap-3">
          <Link to="/academy" className="text-ink-300 hover:text-white text-sm">← Back</Link>
          <Link
            to={boardMode ? `/call/${room}` : `/call/${room}?board=1`}
            className="text-brand-400 hover:text-brand-300 text-xs"
          >
            {boardMode ? "Hide board" : "♟ Chess board"}
          </Link>
        </div>
        <div className="text-xs text-ink-300">
          <span className="font-mono">{room}</span>
          <span className="mx-2 text-ink-500">·</span>
          <span>{currentCount}/8 in room</span>
          <span className="mx-2 text-ink-500">·</span>
          <span>{status}</span>
        </div>
      </header>

      <main className="relative flex-1 flex items-stretch justify-center p-4">
        {boardMode
          ? <BoardMainArea room={room} peerIds={peerIds} peersRef={peersRef} localVideoRef={localVideoRef} camOn={camOn} />
          : <ClassicMainArea room={room} peerIds={peerIds} peersRef={peersRef} localVideoRef={localVideoRef} camOn={camOn} />}
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

// Original layout: grid of remote video tiles + floating self-view PIP.
// Extracted verbatim from the pre-board version so behavior is identical.
type MainAreaProps = {
  room: string;
  peerIds: string[];
  peersRef: React.MutableRefObject<Map<string, PeerState>>;
  localVideoRef: React.RefObject<HTMLVideoElement>;
  camOn: boolean;
};

function ClassicMainArea({ room, peerIds, peersRef, localVideoRef, camOn }: MainAreaProps) {
  // Explicit cols per count — keeps cell aspect predictable vs auto-fit.
  let gridCols = "grid-cols-1";
  if (peerIds.length === 2) gridCols = "grid-cols-2";
  else if (peerIds.length >= 3 && peerIds.length <= 4) gridCols = "grid-cols-2";
  else if (peerIds.length >= 5 && peerIds.length <= 6) gridCols = "grid-cols-3";
  else if (peerIds.length >= 7) gridCols = "grid-cols-3";

  return (
    <div className="relative flex-1 flex items-center justify-center">
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
    </div>
  );
}

// Chess-native layout: board left, videos as a vertical column right (or a
// horizontal strip below the board on narrow widths). Reset lives under board.
function BoardMainArea({ room, peerIds, peersRef, localVideoRef, camOn }: MainAreaProps) {
  const { fen, lastMove, dests, sendMove, sendReset, connected } = useSharedBoard(room);

  const lastMoveTuple: [Key, Key] | undefined = lastMove ? [lastMove.from as Key, lastMove.to as Key] : undefined;

  // No optimistic apply — server echoes back and applyFen re-derives. Promotion
  // is omitted; server defaults to "q" (fine for P0; picker is future work).
  const onBoardMove = (from: Key, to: Key) => sendMove(String(from), String(to));

  return (
    <div className="flex-1 flex flex-col md:flex-row gap-4 items-stretch min-h-0">
      {/* Board column */}
      <div className="flex-1 flex flex-col items-center justify-center min-h-0">
        <div className="w-full max-w-[600px] aspect-square">
          <Board
            fen={fen}
            movableColor="both"
            dests={dests}
            lastMove={lastMoveTuple}
            onMove={onBoardMove}
            coordinates
          />
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={sendReset}
            className="rounded-xl2 px-3 py-1.5 text-xs bg-ink-800 hover:bg-ink-700 text-white border border-ink-700"
            title="Only the coach can reset — server-enforced"
          >
            ↺ Reset board
          </button>
          <span className={`text-[10px] ${connected ? "text-emerald-400" : "text-ink-500"}`}>
            {connected ? "board synced" : "board offline"}
          </span>
        </div>
      </div>

      {/* Video column (md+) / horizontal strip (below md) */}
      <div className="flex flex-row md:flex-col gap-2 md:w-[190px] shrink-0 overflow-x-auto md:overflow-y-auto md:overflow-x-hidden md:max-h-[calc(100vh-180px)]">
        {/* Self-view: mirrored small tile, first in the column */}
        <div className="relative w-[160px] md:w-full aspect-video shrink-0 rounded-lg overflow-hidden border border-white/20 bg-black">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
            style={{ transform: "scaleX(-1)" }}
          />
          {!camOn && (
            <div className="absolute inset-0 flex items-center justify-center bg-ink-800/90 text-xs text-ink-300">
              Camera off
            </div>
          )}
          <div className="absolute bottom-1 left-1 px-2 py-0.5 rounded bg-black/60 text-[10px] text-white font-mono">You</div>
        </div>
        {peerIds.length === 0 && (
          <div className="w-[160px] md:w-full aspect-video shrink-0 rounded-lg border border-ink-700 bg-ink-900 flex items-center justify-center text-[11px] text-ink-400 px-2 text-center">
            Waiting for others…
          </div>
        )}
        {peerIds.map((id, idx) => (
          <div key={id} className="w-[160px] md:w-full shrink-0">
            <RemoteTile
              peerId={id}
              index={idx}
              getStream={() => peersRef.current.get(id)?.remoteStream ?? null}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Shared board hook ----------------------------------------------------

// One WebSocket to /v2api/class-ws/:room, one chess.js engine, one state. Its own
// effect so ?board=1 toggles don't ripple into the signaling mesh.
function useSharedBoard(room: string) {
  const [fen, setFen] = useState<string>(START_FEN);
  const [lastMove, setLastMove] = useState<BoardMove | null>(null);
  const [dests, setDests] = useState(() => destsFromChess(new Chess()));
  const [connected, setConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const gameRef = useRef<Chess>(new Chess());

  // Apply an authoritative fen from the server. Server is truth; if chess.js
  // rejects it we reset so dests stops offering moves for a bogus position.
  const applyFen = (nextFen: string, nextLast: BoardMove | null) => {
    try { gameRef.current = new Chess(nextFen); }
    catch { gameRef.current = new Chess(); }
    setLastMove(nextLast);
    setFen(gameRef.current.fen());
    setDests(destsFromChess(gameRef.current));
  };

  useEffect(() => {
    if (!room) return;
    let cancelled = false;

    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${location.host}/v2api/class-ws/${encodeURIComponent(room)}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (cancelled) return;
      setConnected(true);
      // hello with no coachToken → server mints one, first joiner becomes coach.
      // Role only gates reset/lock/takeback server-side; moves are free-for-all.
      try { ws.send(JSON.stringify({ type: "hello" })); } catch { /* */ }
    };
    ws.onerror = () => { if (!cancelled) setConnected(false); };
    ws.onclose = () => { if (!cancelled) setConnected(false); };
    ws.onmessage = (ev) => {
      if (cancelled) return;
      let msg: BoardServerMsg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === "state") applyFen((msg as any).fen, (msg as any).lastMove ?? null);
      else if (msg.type === "move") applyFen((msg as any).fen, (msg as any).move);
      else if (msg.type === "reset") applyFen((msg as any).fen, null);
      // role / pong / participants / lock / annot: not needed for P0.
    };

    return () => {
      cancelled = true;
      setConnected(false);
      if (wsRef.current) {
        try { wsRef.current.close(); } catch { /* */ }
        wsRef.current = null;
      }
    };
  }, [room]);

  const sendMove = (from: string, to: string, promotion?: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify({ type: "move", move: { from, to, promotion } })); } catch { /* */ }
  };

  // Server silently drops non-coach resets. UI feedback would require tracking
  // {type:"role"} — deferred; P0 assumes the coach is the one clicking.
  const sendReset = () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify({ type: "reset" })); } catch { /* */ }
  };

  return { fen, lastMove, dests, connected, sendMove, sendReset };
}

// Remote video cell. getStream() runs each render so ontrack-triggered re-renders
// (via syncPeerIds) reattach srcObject even though the stream lives in peersRef.
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

// Shared wrapper for pre-call / error states.
function Splash({ title, body, detail }: { title: string; body?: string; detail?: string }) {
  return (
    <div className="min-h-screen bg-ink-950 flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded-xl2 border border-ink-700 bg-ink-900 p-6 text-center">
        <h2 className="text-xl font-semibold text-white">{title}</h2>
        {body && <p className="mt-2 text-ink-300">{body}</p>}
        {detail && <p className="mt-3 text-xs text-ink-400">{detail}</p>}
        <Link to="/academy" className="mt-6 inline-block rounded-xl2 bg-brand-600 px-4 py-2 text-white">Back to Academy</Link>
      </div>
    </div>
  );
}
