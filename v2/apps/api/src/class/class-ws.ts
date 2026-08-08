// Live-class board sync — Phase 2 of the video-coaching plan (owner 2026-08-08).
//
// A tiny WebSocket message bus on top of the existing Nest HTTP server. Not part of a
// Nest module intentionally — this is stateful in-memory, not request/response, and
// wiring it via @WebSocketGateway would drag in @nestjs/platform-socket.io just to
// register one path. Attaches directly to the underlying http.Server via `upgrade`.
//
// Design:
//   - Rooms are keyed by class id from the URL: /class-ws/<id>
//   - Server keeps { fen, lastMove, moveHistory[] } per room in memory
//   - On connect: server sends a `state` frame with the current position
//   - On `move` frame: server updates state and broadcasts to everyone in the room
//     (echo included, so the sender's own board reconciles from server-truth)
//   - On `reset` frame: server clears the room's board back to the starting position
//   - Rooms auto-evict when the last participant disconnects
//
// Not doing here (Phase 3):
//   - Move validation (server just relays — clients trust chess.js locally)
//   - Coach vs student roles (right now anyone can move; last writer wins)
//   - Persistence across API restarts (in-memory is fine for live sessions)
//   - Auth (URL is the shared secret; MVP scope matches the video call itself)
//
// URL example: wss://harinitharanjith.com/v2api/class-ws/abc123

import type { Server as HttpServer, IncomingMessage } from "http";
// ws v8 doesn't ship types (they moved to @types/ws which we haven't installed to
// keep the api's dep footprint small). Minimal ambient types below cover exactly
// what we use — extend if you touch this file and hit new TS7016 errors.
import { WebSocketServer, WebSocket } from "ws";
import { Chess } from "chess.js";

type Move = { from: string; to: string; promotion?: string };
type ClientFrame =
  | { type: "move"; move: Move }
  | { type: "reset" }
  | { type: "ping" };
type ServerFrame =
  | { type: "state"; fen: string; lastMove: Move | null; history: Move[]; participants: number }
  | { type: "move"; move: Move; fen: string; participants: number }
  | { type: "reset"; fen: string; participants: number }
  | { type: "participants"; participants: number }
  | { type: "pong" };

interface Room {
  fen: string;
  lastMove: Move | null;
  history: Move[];
  clients: Set<WebSocket>;
}

const START_FEN = new Chess().fen();

// One WebSocketServer, one rooms map for the process lifetime.
const wss = new WebSocketServer({ noServer: true });
const rooms = new Map<string, Room>();

function getRoom(id: string): Room {
  let r = rooms.get(id);
  if (!r) { r = { fen: START_FEN, lastMove: null, history: [], clients: new Set() }; rooms.set(id, r); }
  return r;
}

function broadcast(room: Room, frame: ServerFrame): void {
  const payload = JSON.stringify(frame);
  for (const c of room.clients) {
    if (c.readyState === WebSocket.OPEN) { try { c.send(payload); } catch { /* ignore */ } }
  }
}

// Match /class-ws/<id> (and /v2api/class-ws/<id> if the strip-prefix ever changes).
function parseRoomId(url: string | undefined): string | null {
  if (!url) return null;
  const m = /\/class-ws\/([A-Za-z0-9_-]{1,64})(?:\?|$)/.exec(url);
  return m && m[1] ? m[1] : null;
}

wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
  const roomId = parseRoomId(req.url);
  if (!roomId) { try { ws.close(1008, "bad room"); } catch { /* */ } return; }
  const room = getRoom(roomId);
  room.clients.add(ws);

  // Snapshot the current board to the new participant.
  const send = (frame: ServerFrame) => { try { ws.send(JSON.stringify(frame)); } catch { /* */ } };
  send({ type: "state", fen: room.fen, lastMove: room.lastMove, history: room.history, participants: room.clients.size });
  // Let everyone else know a new participant joined (drives the "N in room" counter).
  broadcast(room, { type: "participants", participants: room.clients.size });

  ws.on("message", (raw) => {
    let frame: ClientFrame;
    try { frame = JSON.parse(raw.toString()); } catch { return; }
    if (frame.type === "ping") { send({ type: "pong" }); return; }
    if (frame.type === "reset") {
      room.fen = START_FEN; room.lastMove = null; room.history = [];
      broadcast(room, { type: "reset", fen: room.fen, participants: room.clients.size });
      return;
    }
    if (frame.type === "move" && frame.move && typeof frame.move.from === "string" && typeof frame.move.to === "string") {
      // Server-side chess.js is the tie-breaker: two racing clients can't diverge the
      // canonical FEN. Illegal moves are dropped silently — the sender's local board
      // will reconcile from the next authoritative state frame it receives.
      const c = new Chess(room.fen);
      let ok = false;
      try {
        const applied = c.move({ from: frame.move.from, to: frame.move.to, promotion: (frame.move.promotion as any) || "q" });
        ok = !!applied;
      } catch { ok = false; }
      if (!ok) { send({ type: "state", fen: room.fen, lastMove: room.lastMove, history: room.history, participants: room.clients.size }); return; }
      room.fen = c.fen();
      room.lastMove = { from: frame.move.from, to: frame.move.to, promotion: frame.move.promotion };
      room.history.push(room.lastMove);
      broadcast(room, { type: "move", move: room.lastMove, fen: room.fen, participants: room.clients.size });
    }
  });

  ws.on("close", () => {
    room.clients.delete(ws);
    if (room.clients.size === 0) { rooms.delete(roomId); return; }
    broadcast(room, { type: "participants", participants: room.clients.size });
  });
});

// Wire the upgrade handshake into Nest's http server. Only handles class-ws paths;
// any other upgrade attempt is destroyed so we don't accidentally answer for another
// (future) WebSocket path.
export function attachClassWs(server: HttpServer): void {
  server.on("upgrade", (req, socket, head) => {
    if (parseRoomId(req.url) == null) return; // let another handler (or default) close it
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });
}
