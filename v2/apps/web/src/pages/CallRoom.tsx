// CallRoom — P2a of ChessGuru's "from-scratch Zoom" build.
//
// Mesh video call (up to 8) on /v2api/api/video-signal/:room. Lex-lower id
// offers to avoid glare; early-ICE buffered per peer. `?board=1` swaps to the
// chess-native layout (Chessground + vertical video column) synced via the
// existing class-ws bus with its own effect/teardown.
//
// Ephemeral chat / raise-hand / reactions ride the server `broadcast` frame:
// server adds {from,name} and relays to everyone-else — no echo to sender, so
// every outbound send has a paired local apply.
import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Chess } from "chess.js";
import type { Key } from "chessground/types";
import Board, { destsFromChess } from "../components/Board";
import { startBackgroundBlur } from "../lib/backgroundBlur";

type PeerSummary = { id: string; name: string; userId: string | null };
type ServerMsg =
  | { type: "hello"; self: string; peers: PeerSummary[]; moderator?: string | null; as?: { userId: string | null; name: string } }
  | { type: "peer-join"; peer: string; name?: string; userId?: string | null }
  | { type: "peer-leave"; peer: string }
  | { type: "full" }
  | { type: "moderator-change"; moderator: string | null }
  | { type: "mod"; action: "force-mute" | "kicked" | "spotlight"; from?: string; name?: string; target?: string | null }
  | { type: "offer"; from: string; sdp: RTCSessionDescriptionInit }
  | { type: "answer"; from: string; sdp: RTCSessionDescriptionInit }
  | { type: "ice"; from: string; candidate: RTCIceCandidateInit | null }
  | { type: "broadcast"; from: string; name: string; subtype: string; payload: any };

type PeerState = {
  pc: RTCPeerConnection;
  remoteStream: MediaStream | null;
  pendingIce: RTCIceCandidateInit[];
  name: string;              // human-readable label for the tile
  userId: string | null;
  // Active-speaker detection: analyser + last sampled RMS. Populated when the
  // remote audio track lands (in ontrack), sampled by a shared 200ms rAF loop.
  analyser?: AnalyserNode;
  levelBuf?: Uint8Array;
  level?: number;            // 0..1 RMS, higher = louder
};

// Class-ws (shared-board) frames — subset we handle. See apps/api/src/class/class-ws.ts.
type BoardMove = { from: string; to: string; promotion?: string };
type BoardServerMsg =
  | { type: "state"; fen: string; lastMove: BoardMove | null; history: BoardMove[] }
  | { type: "move"; move: BoardMove; fen: string }
  | { type: "reset"; fen: string }
  | { type: string; [k: string]: unknown };

// Ephemeral chat message (list is not persisted; joining mid-call = blank).
type ChatMsg = { id: string; from: string; name: string; text: string; at: number; own: boolean };
// One in-flight floating reaction anchored to a peer (or self via "" or self id).
type FloatingReaction = { id: string; emoji: string; peerId: string };

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const REACTION_EMOJIS = ["👍", "👏", "❤️", "😂", "🎉", "🔥", "🤔", "👎"];
// 2s float; keep in sync with the CSS keyframe duration below.
const REACTION_LIFETIME_MS = 2000;

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

// Cheap unique id for chat messages + floating reactions. Not cryptographic —
// only needs to be unique within this session's client-side lists.
let __localIdSeq = 0;
const nextLocalId = () => `L${Date.now().toString(36)}-${(__localIdSeq++).toString(36)}`;

export default function CallRoomPage() {
  const { room = "" } = useParams<{ room: string }>();
  const [searchParams] = useSearchParams();
  const boardMode = searchParams.get("board") === "1";

  const [status, setStatus] = useState<Status>("connecting");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [sharing, setSharing] = useState(false);
  // Background-blur toggle (MediaPipe SelfieSegmenter → canvas.captureStream).
  const [blur, setBlur] = useState(false);
  // Set while startBackgroundBlur is loading WASM+model — disables the button
  // to avoid double-clicks that would spawn two segmenter pipelines.
  const [blurLoading, setBlurLoading] = useState(false);
  // Drives grid render; mirrors peersRef.keys() on every join/leave.
  const [peerIds, setPeerIds] = useState<string[]>([]);

  // ---- Ephemeral interaction state ---------------------------------------
  // Chat drawer + unread counter (cleared on open); raise-hand as a peerId
  // array (includes self); reaction popover + in-flight floating emojis.
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatUnread, setChatUnread] = useState(0);
  const [chatDraft, setChatDraft] = useState("");
  const [raisedHands, setRaisedHands] = useState<string[]>([]);
  const [ownHandUp, setOwnHandUp] = useState(false);
  const [reactionOpen, setReactionOpen] = useState(false);
  const [floaters, setFloaters] = useState<FloatingReaction[]>([]);

  // Refs — stable identity, no re-renders. peersRef map is what actually holds
  // per-peer state; peerIds state array is the render trigger.
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, PeerState>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);
  const selfIdRef = useRef<string>("");
  const selfNameRef = useRef<string>("You");
  // Fetched from /api/video/ice-config (or fallback) before any PC is built.
  const iceConfigRef = useRef<RTCConfiguration>(FALLBACK_ICE_SERVERS);
  // Screen-share display stream — kept so we can stop its tracks + restore cam.
  const displayStreamRef = useRef<MediaStream | null>(null);
  // Background-blur pipeline handle. Non-null while blur is active.
  const blurControlRef = useRef<{ output: MediaStream; stop: () => void } | null>(null);
  // Shared AudioContext for active-speaker detection (one per page, reused).
  const audioCtxRef = useRef<AudioContext | null>(null);
  // Peer id of the current loudest speaker (or null). Drives tile spotlight.
  const [activeSpeaker, setActiveSpeaker] = useState<string | null>(null);
  // Moderator = first joiner in the room. Auto-updates on moderator-change
  // (i.e. current moderator left). Drives 👑 badge + gate on mute-all button.
  const [moderatorId, setModeratorId] = useState<string | null>(null);
  // Server-relayed spotlight (moderator's pick). Not yet rendered as a bigger
  // tile — the state is here so we can wire the UI in the next slice. For
  // now it just powers a subtle "spotlighted" ring on the picked tile.
  const [spotlightId, setSpotlightId] = useState<string | null>(null);
  // Auto-scroll the chat list to bottom on new message OR on open.
  const chatListRef = useRef<HTMLDivElement>(null);
  // Track timers so unmount can clear them (avoids setState-on-unmount warnings).
  const floaterTimersRef = useRef<Set<number>>(new Set());
  // Client-side recording: MediaRecorder holds the encoder; recordChunks holds
  // the incoming webm blobs; recordStartedAt drives the mm:ss counter. On stop
  // we assemble one Blob and trigger a browser download — no server upload in
  // P0 (would need a chunked-upload backend + storage decisions).
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);
  const [recordStartedAt, setRecordStartedAt] = useState<number | null>(null);
  const [recordElapsed, setRecordElapsed] = useState(0);

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

  // Fire a floating reaction on a tile (peerId "" or selfIdRef.current → self view).
  const spawnFloater = (peerId: string, emoji: string) => {
    const id = nextLocalId();
    setFloaters((f) => [...f, { id, peerId, emoji }]);
    const t = window.setTimeout(() => {
      setFloaters((f) => f.filter((x) => x.id !== id));
      floaterTimersRef.current.delete(t);
    }, REACTION_LIFETIME_MS);
    floaterTimersRef.current.add(t);
  };

  const sendChat = () => {
    const text = chatDraft.trim();
    if (!text) return;
    // Local push first — server does not echo to sender.
    setChatMsgs((m) => [...m, { id: nextLocalId(), from: selfIdRef.current || "self",
      name: selfNameRef.current, text, at: Date.now(), own: true }]);
    send({ type: "broadcast", subtype: "chat", payload: { text } });
    setChatDraft("");
  };

  const toggleHand = () => {
    const next = !ownHandUp;
    setOwnHandUp(next);
    // Local mirror keyed to self id ("" pre-hello → migrated on hello arrival).
    const self = selfIdRef.current;
    setRaisedHands((cur) => {
      const s = new Set(cur);
      if (next) s.add(self); else s.delete(self);
      return [...s];
    });
    send({ type: "broadcast", subtype: "hand-toggle", payload: { up: next } });
  };

  // Moderator-only room controls. Server silently drops mod commands from
  // non-moderator peers, so these are safe to expose UI-side too (defence in depth
  // is via the isMod gate below hiding the buttons).
  const iAmMod = !!moderatorId && moderatorId === selfIdRef.current;
  const muteAll = () => { if (!iAmMod) return; send({ type: "mod", action: "mute-all" }); };
  const kickPeer = (peerId: string) => { if (!iAmMod) return; send({ type: "mod", action: "kick", target: peerId }); };
  const spotlightPeer = (peerId: string | null) => {
    if (!iAmMod) return;
    setSpotlightId(peerId);   // local echo (server also broadcasts back to sender)
    send({ type: "mod", action: "spotlight", target: peerId });
  };

  const sendReaction = (emoji: string) => {
    // Local echo first — anchor to the self id (or "" pre-hello, matching
    // spawnFloater's self-view convention). Same reason as chat: no server echo.
    spawnFloater(selfIdRef.current, emoji);
    send({ type: "broadcast", subtype: "reaction", payload: { emoji } });
    setReactionOpen(false);
  };

  // Live captions — browser SpeechRecognition (Chrome/Edge/Safari). Local
  // transcript broadcast via the same `broadcast` primitive; recipients render
  // the latest speaker+text in an overlay bar for CAPTION_TTL ms.
  //
  // Not "self-hosted" (Google's speech backend on Chrome). Whisper.cpp on
  // Mumbai is the follow-up upgrade path; wire is identical, only the
  // transcript source changes.
  const CAPTION_TTL = 5000;
  const [captionsOn, setCaptionsOn] = useState(false);
  const [caption, setCaption] = useState<{ from: string; name: string; text: string; at: number } | null>(null);
  const speechRecRef = useRef<any>(null);
  const captionSupported = typeof window !== "undefined" && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  const startCaptions = () => {
    if (captionsOn) return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    let rec: any;
    try { rec = new SR(); } catch { return; }
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";
    rec.onresult = (ev: any) => {
      // Grab the newest result (interim OR final) and broadcast it.
      let latest = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        latest = ev.results[i][0].transcript;
      }
      if (!latest.trim()) return;
      const payload = { text: latest.trim(), final: !!ev.results[ev.results.length - 1]?.isFinal };
      // Local echo
      setCaption({ from: selfIdRef.current || "self", name: selfNameRef.current || "You", text: payload.text, at: Date.now() });
      send({ type: "broadcast", subtype: "caption", payload });
    };
    rec.onerror = () => { /* mic denied / no-speech — silent */ };
    rec.onend = () => {
      // Auto-restart while user still wants captions on (SpeechRecognition ends
      // itself after silence or errors).
      if (captionsOn && speechRecRef.current === rec) { try { rec.start(); } catch {} }
    };
    try { rec.start(); } catch { return; }
    speechRecRef.current = rec;
    setCaptionsOn(true);
  };
  const stopCaptions = () => {
    const rec = speechRecRef.current;
    speechRecRef.current = null;
    if (rec) { try { rec.stop(); } catch {} }
    setCaptionsOn(false);
    setCaption(null);
  };

  // Auto-clear caption bar after CAPTION_TTL ms of no updates.
  useEffect(() => {
    if (!caption) return;
    const iv = setTimeout(() => setCaption((c) => (c && Date.now() - c.at >= CAPTION_TTL ? null : c)), CAPTION_TTL + 100);
    return () => clearTimeout(iv);
  }, [caption]);

  // Auto-scroll the chat drawer whenever the list grows OR opens with content.
  useEffect(() => {
    if (!chatOpen) return;
    const el = chatListRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatMsgs.length, chatOpen]);

  // Clear unread badge on open.
  useEffect(() => { if (chatOpen) setChatUnread(0); }, [chatOpen]);

  // Clear all floater timers on unmount.
  useEffect(() => () => {
    for (const t of floaterTimersRef.current) clearTimeout(t);
    floaterTimersRef.current.clear();
  }, []);

  // Build one RTCPeerConnection for a remote peer, wire handlers, store in peersRef.
  // `peer` may be just an id (older peer-join without name) or a full summary.
  const createPc = (peerOrId: string | PeerSummary): PeerState => {
    const peerId = typeof peerOrId === "string" ? peerOrId : peerOrId.id;
    const name   = typeof peerOrId === "string" ? peerId : (peerOrId.name || peerId);
    const userId = typeof peerOrId === "string" ? null   : peerOrId.userId;
    const pc = new RTCPeerConnection(iceConfigRef.current);
    const state: PeerState = { pc, remoteStream: null, pendingIce: [], name, userId };
    peersRef.current.set(peerId, state);

    // Send null too — signals end-of-candidates to the remote.
    pc.onicecandidate = (e) => send({ type: "ice", to: peerId, candidate: e.candidate });
    pc.ontrack = (e) => {
      const [stream] = e.streams;
      const cur = peersRef.current.get(peerId);
      if (cur && stream) {
        cur.remoteStream = stream;
        // Active-speaker analyser on the remote AUDIO track — sampled by the
        // shared rAF loop in useEffect. Skipped for video-only streams.
        try {
          const audio = stream.getAudioTracks();
          if (audio.length && !cur.analyser) {
            const ctx = audioCtxRef.current || (audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)());
            const source = ctx.createMediaStreamSource(new MediaStream(audio));
            const an = ctx.createAnalyser();
            an.fftSize = 256;
            source.connect(an);
            cur.analyser = an;
            cur.levelBuf = new Uint8Array(an.frequencyBinCount);
          }
        } catch { /* AudioContext may fail if not user-gestured; skip silently */ }
        syncPeerIds();
      }
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

  // Route a `broadcast` frame from another peer to the right feature. Each
  // subtype's payload shape is validated defensively — a malformed frame from
  // a bad client shouldn't tank the room.
  const handleBroadcast = (from: string, name: string, subtype: string, payload: any) => {
    if (subtype === "chat") {
      const text = typeof payload?.text === "string" ? payload.text : "";
      if (!text) return;
      setChatMsgs((m) => [
        ...m,
        { id: nextLocalId(), from, name: name || from, text, at: Date.now(), own: false },
      ]);
      // Only bump unread if drawer is closed. Uses functional set to stay
      // correct even if multiple broadcasts land in the same tick.
      setChatUnread((u) => (chatOpen ? 0 : u + 1));
      return;
    }
    if (subtype === "hand-toggle") {
      const up = !!payload?.up;
      setRaisedHands((cur) => {
        const s = new Set(cur);
        if (up) s.add(from); else s.delete(from);
        return [...s];
      });
      return;
    }
    if (subtype === "reaction") {
      const emoji = typeof payload?.emoji === "string" ? payload.emoji : "";
      if (!emoji) return;
      spawnFloater(from, emoji);
      return;
    }
    if (subtype === "caption") {
      const text = typeof payload?.text === "string" ? payload.text : "";
      if (!text) return;
      setCaption({ from, name, text, at: Date.now() });
      return;
    }
    // Unknown subtypes: silently ignored — forward-compat with future features.
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
    if (blurControlRef.current) {
      try { blurControlRef.current.stop(); } catch { /* already stopped */ }
      blurControlRef.current = null;
    }
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close(); } catch { /* already closed */ }
      audioCtxRef.current = null;
    }
    if (speechRecRef.current) {
      try { speechRecRef.current.stop(); } catch { /* already stopped */ }
      speechRecRef.current = null;
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
            if (msg.as?.name) selfNameRef.current = msg.as.name;
            if (msg.moderator !== undefined) setModeratorId(msg.moderator ?? null);
            // If we raised our hand before hello landed, the local mirror was
            // keyed to "" — migrate it to the real self id so tiles line up.
            setRaisedHands((cur) => {
              if (!cur.includes("")) return cur;
              const s = new Set(cur);
              s.delete(""); s.add(msg.self);
              return [...s];
            });
            // For each peer already in the room, spin up a PC + apply pairwise offerer rule.
            for (const other of msg.peers) {
              const otherId = typeof other === "string" ? other : other.id;
              if (peersRef.current.has(otherId)) continue;
              createPc(other);
              if (shouldOffer(msg.self, otherId)) await startOffer(otherId);
            }
            syncPeerIds();
            if (msg.peers.length > 0) setStatus("negotiating");
            break;
          }
          case "peer-join": {
            if (!peersRef.current.has(msg.peer)) {
              const summary: PeerSummary = { id: msg.peer, name: msg.name || msg.peer, userId: msg.userId ?? null };
              createPc(summary);
            }
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
            // Leaver's hand goes down; pending floaters die with their timer.
            setRaisedHands((cur) => (cur.includes(msg.peer) ? cur.filter((p) => p !== msg.peer) : cur));
            break;
          }
          case "full": setStatus("full"); break;
          case "moderator-change": setModeratorId(msg.moderator ?? null); break;
          case "mod": {
            // Server-side auth check already ran; act on the action.
            if (msg.action === "force-mute") {
              const s = localStreamRef.current;
              if (s) for (const t of s.getAudioTracks()) t.enabled = false;
              setMicOn(false);
            } else if (msg.action === "kicked") {
              // Server closes the ws immediately after; anticipate that.
              stopRecording(); stopCaptions(); teardown(); setStatus("left");
            } else if (msg.action === "spotlight") {
              setSpotlightId(msg.target ?? null);
            }
            break;
          }
          case "offer":  await handleOffer(msg.from, msg.sdp); break;
          case "answer": await handleAnswer(msg.from, msg.sdp); break;
          case "ice":    await handleIce(msg.from, msg.candidate); break;
          case "broadcast": handleBroadcast(msg.from, msg.name, msg.subtype, msg.payload); break;
        }
      };
    })();

    return () => { cancelled = true; teardown(); };
    // Room id fully drives the effect; nothing else should re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);

  // Active-speaker detection: every 250ms sample each peer's analyser RMS,
  // pick the loudest above a noise-gate threshold, expose as activeSpeaker
  // state → drives the spotlight ring on the tile. Cheap: one interval,
  // O(N) tiny sample per tick.
  useEffect(() => {
    const iv = setInterval(() => {
      let winner: string | null = null;
      let max = 0;
      for (const [id, state] of peersRef.current) {
        const an = state.analyser, buf = state.levelBuf;
        if (!an || !buf) continue;
        an.getByteFrequencyData(buf as any);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i]! * buf[i]!;
        const rms = Math.sqrt(sum / buf.length) / 255;
        state.level = rms;
        if (rms > max && rms > 0.05) { max = rms; winner = id; }   // noise gate
      }
      setActiveSpeaker(winner);
    }, 250);
    return () => clearInterval(iv);
  }, []);

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
  const leave = () => { stopRecording(); stopCaptions(); teardown(); setStatus("left"); };

  // Background blur: MediaPipe SelfieSegmenter → composite canvas → captureStream.
  // On enable, swap the outgoing video track on every PC + self-view srcObject
  // to the processed track. On disable, restore the raw camera track.
  // Sharing takes precedence: turning on share while blur is up will disable
  // blur first (see toggleShare); starting blur while sharing is a no-op.
  const toggleBlur = async () => {
    if (blurLoading) return;
    if (blur) {
      // Turn OFF — restore raw camera track everywhere.
      const cam = localStreamRef.current;
      const camTrack = cam?.getVideoTracks()[0];
      if (blurControlRef.current) {
        try { blurControlRef.current.stop(); } catch { /* */ }
        blurControlRef.current = null;
      }
      if (camTrack) {
        for (const state of peersRef.current.values()) {
          const sender = state.pc.getSenders().find((s) => s.track?.kind === "video");
          try { await sender?.replaceTrack(camTrack); } catch { /* peer gone */ }
        }
      }
      if (localVideoRef.current && cam) localVideoRef.current.srcObject = cam;
      setBlur(false);
      return;
    }
    // Turn ON.
    if (sharing) return; // display track owns the video sender right now
    const cam = localStreamRef.current;
    if (!cam) return;
    setBlurLoading(true);
    let handle: { output: MediaStream; stop: () => void };
    try {
      handle = await startBackgroundBlur(cam);
    } catch (err) {
      console.warn("[blur] failed to start MediaPipe pipeline:", err);
      setBlur(false);
      setBlurLoading(false);
      return;
    }
    blurControlRef.current = handle;
    const blurredTrack = handle.output.getVideoTracks()[0];
    if (blurredTrack) {
      for (const state of peersRef.current.values()) {
        const sender = state.pc.getSenders().find((s) => s.track?.kind === "video");
        try { await sender?.replaceTrack(blurredTrack); } catch { /* peer gone */ }
      }
    }
    if (localVideoRef.current) localVideoRef.current.srcObject = handle.output;
    setBlur(true);
    setBlurLoading(false);
  };

  // Client-side recording — captures whatever the LOCAL user is broadcasting
  // (camera+mic or, when sharing, the display surface). Not a full "record
  // the whole call" — capturing remote streams too requires canvas compositing
  // via canvas.captureStream, planned for the next slice.
  const startRecording = () => {
    if (recording) return;
    const primary = displayStreamRef.current || localStreamRef.current;
    if (!primary) return;
    // Mux: video from primary (camera or display), audio from the ACTUAL mic
    // (display capture won't grab our voice on most browsers).
    const tracks: MediaStreamTrack[] = [];
    for (const t of primary.getVideoTracks()) tracks.push(t);
    const localAudio = localStreamRef.current?.getAudioTracks() || [];
    for (const t of localAudio) tracks.push(t);
    if (tracks.length === 0) return;
    const mix = new MediaStream(tracks);
    // Pick the best codec MediaRecorder actually supports today. VP9 is a good
    // default; falls back to VP8 or the browser's default if not available.
    const mimeCandidates = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ];
    let mime = "";
    for (const c of mimeCandidates) {
      if ((window.MediaRecorder as any)?.isTypeSupported?.(c)) { mime = c; break; }
    }
    let rec: MediaRecorder;
    try { rec = mime ? new MediaRecorder(mix, { mimeType: mime, videoBitsPerSecond: 2_500_000 }) : new MediaRecorder(mix); }
    catch { return; }
    recordChunksRef.current = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) recordChunksRef.current.push(e.data); };
    rec.onstop = () => {
      const blob = new Blob(recordChunksRef.current, { type: mime || "video/webm" });
      recordChunksRef.current = [];
      // 1) Trigger the local download for immediate access.
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      a.download = `chessguru-${room}-${stamp}.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      // 2) Fire-and-forget upload to /api/class/<room>/recording so students
      //    can rewatch later. Same endpoint the legacy in-app viewer already
      //    supports (raw application/octet-stream). Silent on failure so a
      //    dropped upload doesn't undo the local download.
      fetch(`/v2api/api/class/${encodeURIComponent(room)}/recording`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/octet-stream" },
        body: blob,
      }).then((r) => {
        if (r.ok) console.log(`[recording] uploaded to server (${blob.size} bytes)`);
        else console.warn(`[recording] server upload failed HTTP ${r.status}`);
      }).catch((e) => console.warn(`[recording] upload error`, e));
    };
    rec.start(2000);   // 2s chunks — safety against a mid-recording crash losing everything
    recorderRef.current = rec;
    setRecording(true);
    setRecordStartedAt(Date.now());
  };
  const stopRecording = () => {
    const rec = recorderRef.current;
    if (!rec || rec.state === "inactive") { setRecording(false); setRecordStartedAt(null); return; }
    try { rec.stop(); } catch { /* ignore */ }
    recorderRef.current = null;
    setRecording(false);
    setRecordStartedAt(null);
  };

  // Tick the mm:ss elapsed counter while recording is live.
  useEffect(() => {
    if (!recording || !recordStartedAt) { setRecordElapsed(0); return; }
    const iv = setInterval(() => setRecordElapsed(Math.floor((Date.now() - recordStartedAt) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [recording, recordStartedAt]);

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
    // Start sharing — screen capture replaces the video sender wholesale, so
    // any active background blur is redundant. Tear it down BEFORE prompting
    // for getDisplayMedia so a user-cancel leaves us in a clean state.
    if (blur) {
      if (blurControlRef.current) {
        try { blurControlRef.current.stop(); } catch { /* */ }
        blurControlRef.current = null;
      }
      setBlur(false);
    }
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
  // Derived Set for O(1) hand lookups in tile render.
  const handSet = new Set(raisedHands);
  const selfHandUp = ownHandUp || handSet.has(selfIdRef.current);

  return (
    <div className="min-h-screen bg-ink-950 text-white flex flex-col">
      {/* Keyframes for the floating-reaction animation. Scoped to this page. */}
      <style>{`
        @keyframes cgFloatUp {
          0%   { transform: translate(-50%, 0) scale(0.9); opacity: 0; }
          15%  { transform: translate(-50%, -12px) scale(1.1); opacity: 1; }
          80%  { transform: translate(-50%, -100px) scale(1); opacity: 1; }
          100% { transform: translate(-50%, -140px) scale(0.9); opacity: 0; }
        }
        .cg-float-up { animation: cgFloatUp 2s ease-out forwards; }
      `}</style>

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

      <div className="relative flex-1 flex min-h-0">
        <main className="relative flex-1 flex items-stretch justify-center p-4">
          {boardMode
            ? <BoardMainArea room={room} peerIds={peerIds} peersRef={peersRef} localVideoRef={localVideoRef}
                camOn={camOn} handSet={handSet} selfHandUp={selfHandUp} selfId={selfIdRef.current}
                floaters={floaters} activeSpeaker={activeSpeaker}
                moderatorId={moderatorId} spotlightId={spotlightId} iAmMod={iAmMod}
                onKick={kickPeer} onSpotlight={spotlightPeer} />
            : <ClassicMainArea room={room} peerIds={peerIds} peersRef={peersRef} localVideoRef={localVideoRef}
                camOn={camOn} handSet={handSet} selfHandUp={selfHandUp} selfId={selfIdRef.current}
                floaters={floaters} activeSpeaker={activeSpeaker}
                moderatorId={moderatorId} spotlightId={spotlightId} iAmMod={iAmMod}
                onKick={kickPeer} onSpotlight={spotlightPeer} />}
        </main>

        {chatOpen && (
          <aside className="w-[320px] shrink-0 bg-ink-900 border-l border-ink-700 flex flex-col">
            <div className="flex items-center justify-between px-3 py-2 border-b border-ink-700">
              <div className="text-sm font-semibold text-white">Chat</div>
              <button
                onClick={() => setChatOpen(false)}
                className="text-ink-300 hover:text-white text-xs"
                aria-label="Close chat"
              >
                ✕
              </button>
            </div>
            <div ref={chatListRef} className="flex-1 overflow-y-auto p-3 space-y-2">
              {chatMsgs.length === 0 ? (
                <div className="text-ink-400 text-sm text-center pt-6">
                  No messages yet — say hi!
                </div>
              ) : (
                chatMsgs.map((m) => (
                  <div key={m.id} className={`flex flex-col ${m.own ? "items-end" : "items-start"}`}>
                    <div className="text-[10px] text-brand-400 mb-0.5 truncate max-w-[260px]">
                      {m.own ? "You" : m.name}
                    </div>
                    <div
                      className={`max-w-[260px] px-2.5 py-1.5 rounded-xl2 text-sm break-words ${
                        m.own ? "bg-brand-600 text-white" : "bg-ink-800 text-white"
                      }`}
                    >
                      {m.text}
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="border-t border-ink-700 p-2 flex items-end gap-2">
              <textarea
                value={chatDraft}
                onChange={(e) => setChatDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendChat();
                  }
                }}
                rows={1}
                placeholder="Type a message…"
                className="flex-1 resize-none rounded-lg bg-ink-800 border border-ink-700 px-2 py-1.5 text-sm text-white placeholder:text-ink-500 focus:outline-none focus:border-brand-600 max-h-24"
              />
              <button
                onClick={sendChat}
                disabled={!chatDraft.trim()}
                className="rounded-lg px-3 py-1.5 text-sm bg-brand-600 hover:bg-brand-500 disabled:opacity-40 disabled:cursor-not-allowed text-white"
              >
                Send
              </button>
            </div>
          </aside>
        )}
      </div>

      {/* Live-captions overlay — a single bar just above the footer with the
       *  most recent speaker + text, auto-clears after CAPTION_TTL ms. */}
      {caption && (
        <div className="relative flex justify-center pointer-events-none">
          <div className="absolute -top-1 -translate-y-full max-w-3xl mx-auto rounded-lg bg-black/75 px-4 py-2 text-white text-sm shadow-lg">
            <span className="text-brand-300 font-semibold mr-2">{caption.name}:</span>{caption.text}
          </div>
        </div>
      )}
      <footer className="relative flex items-center justify-center gap-3 py-4 border-t border-ink-700 bg-ink-900">
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
          onClick={toggleHand}
          className={`rounded-xl2 px-4 py-2 text-sm ${ownHandUp ? "bg-amber-500 hover:bg-amber-400 text-white" : "bg-ink-800 hover:bg-ink-700 text-white"}`}
          aria-pressed={ownHandUp}
        >
          {ownHandUp ? "✋ Lower hand" : "✋ Raise hand"}
        </button>
        <button
          onClick={toggleShare}
          className={`rounded-xl2 px-4 py-2 text-sm ${sharing ? "bg-emerald-600 hover:bg-emerald-500" : "bg-ink-800 hover:bg-ink-700"} text-white`}
        >
          {sharing ? "🛑 Stop sharing" : "🖥️ Share screen"}
        </button>
        <button
          onClick={toggleBlur}
          disabled={blurLoading || sharing}
          title={sharing ? "Stop screen share to enable blur" : (blur ? "Turn off background blur" : "Blur your background (MediaPipe, on-device)")}
          className={`rounded-xl2 px-4 py-2 text-sm ${blur ? "bg-emerald-600 hover:bg-emerald-500" : "bg-ink-800 hover:bg-ink-700"} text-white disabled:opacity-40 disabled:cursor-not-allowed`}
          aria-pressed={blur}
        >
          {blurLoading ? "🌫️ Loading…" : (blur ? "🌫️ Blur on" : "🌫️ Blur off")}
        </button>
        <button
          onClick={recording ? stopRecording : startRecording}
          className={`rounded-xl2 px-4 py-2 text-sm ${recording ? "bg-rose-600 hover:bg-rose-500" : "bg-ink-800 hover:bg-ink-700"} text-white`}
          title={recording ? "Stop recording and download .webm" : "Record your camera + mic to a local .webm file"}
        >
          {recording ? `⏹ ${Math.floor(recordElapsed / 60)}:${String(recordElapsed % 60).padStart(2, "0")}` : "🔴 Record"}
        </button>
        <button
          onClick={captionsOn ? stopCaptions : startCaptions}
          disabled={!captionSupported}
          className={`rounded-xl2 px-4 py-2 text-sm ${captionsOn ? "bg-brand-600 hover:bg-brand-500" : "bg-ink-800 hover:bg-ink-700"} text-white disabled:opacity-40`}
          title={captionSupported
            ? (captionsOn ? "Stop live captions" : "Turn on live captions (browser SpeechRecognition)")
            : "Live captions need Chrome, Edge, or Safari"}
        >
          {captionsOn ? "CC ON" : "CC"}
        </button>
        {iAmMod && (
          <button
            onClick={muteAll}
            className="rounded-xl2 px-4 py-2 text-sm bg-amber-600 hover:bg-amber-500 text-white"
            title="Mute everyone else (moderator only)"
          >
            🔇 Mute all
          </button>
        )}
        {/* Reactions button + popover. Popover is absolutely positioned above
            the button so it doesn't shift the footer's flex layout. */}
        <div className="relative">
          <button
            onClick={() => setReactionOpen((v) => !v)}
            className={`rounded-xl2 px-4 py-2 text-sm ${reactionOpen ? "bg-brand-600 hover:bg-brand-500" : "bg-ink-800 hover:bg-ink-700"} text-white`}
            aria-haspopup="true"
            aria-expanded={reactionOpen}
          >
            😀 React
          </button>
          {reactionOpen && (
            <div
              className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 flex gap-1 bg-ink-800 border border-ink-700 rounded-xl2 px-2 py-1.5 shadow-lg z-20"
              role="menu"
            >
              {REACTION_EMOJIS.map((e) => (
                <button
                  key={e}
                  onClick={() => sendReaction(e)}
                  className="text-xl hover:scale-125 transition-transform px-1"
                  aria-label={`React with ${e}`}
                >
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={() => setChatOpen((v) => !v)}
          className={`relative rounded-xl2 px-4 py-2 text-sm ${chatOpen ? "bg-brand-600 hover:bg-brand-500" : "bg-ink-800 hover:bg-ink-700"} text-white`}
          aria-pressed={chatOpen}
        >
          💬 Chat
          {!chatOpen && chatUnread > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] leading-[18px] font-semibold text-center">
              {chatUnread > 99 ? "99+" : chatUnread}
            </span>
          )}
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
  handSet: Set<string>;
  selfHandUp: boolean;
  selfId: string;
  floaters: FloatingReaction[];
  activeSpeaker: string | null;
  moderatorId: string | null;
  spotlightId: string | null;
  iAmMod: boolean;
  onKick: (peerId: string) => void;
  onSpotlight: (peerId: string | null) => void;
};

function ClassicMainArea({
  room, peerIds, peersRef, localVideoRef, camOn,
  handSet, selfHandUp, selfId, floaters, activeSpeaker,
  moderatorId, spotlightId, iAmMod, onKick, onSpotlight,
}: MainAreaProps) {
  // Explicit cols per count — keeps cell aspect predictable vs auto-fit.
  let gridCols = "grid-cols-1";
  if (peerIds.length === 2) gridCols = "grid-cols-2";
  else if (peerIds.length >= 3 && peerIds.length <= 4) gridCols = "grid-cols-2";
  else if (peerIds.length >= 5 && peerIds.length <= 6) gridCols = "grid-cols-3";
  else if (peerIds.length >= 7) gridCols = "grid-cols-3";

  // Reactions anchored to self view render inside the PIP; ones anchored to a
  // peer render inside their RemoteTile. "" is treated as self (pre-hello).
  const selfFloaters = floaters.filter((f) => f.peerId === selfId || f.peerId === "");

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
              getName={() => peersRef.current.get(id)?.name || id}
              isActive={activeSpeaker === id}
              handUp={handSet.has(id)}
              floaters={floaters.filter((f) => f.peerId === id)}
              isModerator={moderatorId === id}
              isSpotlighted={spotlightId === id}
              showModControls={iAmMod}
              onKick={kickPeer}
              onSpotlight={spotlightPeer}
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
        {selfHandUp && (
          <div className="absolute top-1 right-1 text-2xl bg-black/50 rounded-full px-2 py-1 leading-none">✋</div>
        )}
        {selfFloaters.map((f) => (
          <div
            key={f.id}
            className="cg-float-up absolute left-1/2 bottom-2 text-3xl pointer-events-none select-none"
          >
            {f.emoji}
          </div>
        ))}
      </div>
    </div>
  );
}

// Chess-native layout: board left, videos as a vertical column right (or a
// horizontal strip below the board on narrow widths). Reset lives under board.
function BoardMainArea({
  room, peerIds, peersRef, localVideoRef, camOn,
  handSet, selfHandUp, selfId, floaters, activeSpeaker,
  moderatorId, spotlightId, iAmMod, onKick, onSpotlight,
}: MainAreaProps) {
  const { fen, lastMove, dests, sendMove, sendReset, connected } = useSharedBoard(room);

  const lastMoveTuple: [Key, Key] | undefined = lastMove ? [lastMove.from as Key, lastMove.to as Key] : undefined;

  // No optimistic apply — server echoes back and applyFen re-derives. Promotion
  // is omitted; server defaults to "q" (fine for P0; picker is future work).
  const onBoardMove = (from: Key, to: Key) => sendMove(String(from), String(to));

  const selfFloaters = floaters.filter((f) => f.peerId === selfId || f.peerId === "");

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
          {selfHandUp && (
            <div className="absolute top-1 right-1 text-2xl bg-black/50 rounded-full px-2 py-1 leading-none">✋</div>
          )}
          {selfFloaters.map((f) => (
            <div
              key={f.id}
              className="cg-float-up absolute left-1/2 bottom-2 text-2xl pointer-events-none select-none"
            >
              {f.emoji}
            </div>
          ))}
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
              getName={() => peersRef.current.get(id)?.name || id}
              isActive={activeSpeaker === id}
              handUp={handSet.has(id)}
              floaters={floaters.filter((f) => f.peerId === id)}
              isModerator={moderatorId === id}
              isSpotlighted={spotlightId === id}
              showModControls={iAmMod}
              onKick={onKick}
              onSpotlight={onSpotlight}
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
  getName,
  isActive,
  handUp,
  floaters,
  isModerator,
  isSpotlighted,
  showModControls,
  onKick,
  onSpotlight,
}: {
  peerId: string;
  index: number;
  getStream: () => MediaStream | null;
  getName?: () => string;
  isActive?: boolean;
  handUp?: boolean;
  floaters?: FloatingReaction[];
  isModerator?: boolean;
  isSpotlighted?: boolean;
  showModControls?: boolean;
  onKick?: (peerId: string) => void;
  onSpotlight?: (peerId: string | null) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stream = getStream();
  const name = getName ? getName() : `Peer ${index + 1}`;

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  // Ring precedence: spotlight (amber) > active-speaker (emerald) > default border.
  const ring = isSpotlighted
    ? "ring-2 ring-amber-400 shadow-[0_0_16px_rgba(251,191,36,0.4)]"
    : isActive
      ? "ring-2 ring-emerald-400 shadow-[0_0_16px_rgba(52,211,153,0.35)]"
      : "border border-ink-700";
  return (
    <div className={`relative aspect-video rounded-lg bg-ink-900 overflow-hidden ${ring}`}>
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
      <div className="absolute bottom-1 left-1 flex items-center gap-1 px-2 py-0.5 rounded bg-black/60 text-[11px] text-white">
        {isModerator && <span title="Moderator">👑</span>}
        {isActive && <span className="text-emerald-300">🎤</span>}
        <span className="truncate max-w-[140px]">{name}</span>
      </div>
      {handUp && (
        <div className="absolute top-1 right-1 text-2xl bg-black/50 rounded-full px-2 py-1 leading-none">✋</div>
      )}
      {showModControls && (
        <div className="absolute top-1 left-1 flex gap-1 opacity-0 hover:opacity-100 transition-opacity">
          <button onClick={() => onSpotlight?.(isSpotlighted ? null : peerId)}
            className="text-[10px] rounded bg-amber-600/90 hover:bg-amber-500 text-white px-1.5 py-0.5"
            title={isSpotlighted ? "Un-spotlight this peer" : "Spotlight this peer for everyone"}>
            {isSpotlighted ? "★" : "☆"}
          </button>
          <button onClick={() => onKick?.(peerId)}
            className="text-[10px] rounded bg-rose-600/90 hover:bg-rose-500 text-white px-1.5 py-0.5"
            title="Remove from call">
            ✕
          </button>
        </div>
      )}
      {floaters && floaters.length > 0 && floaters.map((f) => (
        <div
          key={f.id}
          className="cg-float-up absolute left-1/2 bottom-2 text-3xl pointer-events-none select-none"
        >
          {f.emoji}
        </div>
      ))}
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
