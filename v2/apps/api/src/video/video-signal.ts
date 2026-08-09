// From-scratch video signaling — P0 slice of CHESSGURU-VIDEO-FROM-SCRATCH.md.
//
// A minimal WebSocket message bus that relays WebRTC SDP offers/answers + ICE
// candidates between browsers in the same room. NO SFU here — for exactly 2
// participants per room, browsers establish direct P2P connections through STUN
// and pipe media browser-to-browser.
//
// URL:      wss://<host>/v2api/video-signal/<roomId>
// Protocol (JSON per frame):
//   incoming  { type: "join" }                           — implicit on connect via URL
//   outgoing  { type: "peers", peers: [<peerId>...] }    — server tells you who's here
//   outgoing  { type: "peer-join", peer: <peerId> }      — someone else joined
//   outgoing  { type: "peer-leave", peer: <peerId> }     — someone left
//   both      { type: "offer",  from, to, sdp }          — relayed to `to`
//   both      { type: "answer", from, to, sdp }          — relayed to `to`
//   both      { type: "ice",    from, to, candidate }    — relayed to `to`
//   incoming  { type: "leave" }                          — voluntary disconnect
//
// Auth: reads req.session.userId if the express-session cookie is present, else
// mints a `guest-<random>` peer id. Signed-in users can be identified by name in
// the future; for P0 pipe-through is enough.
//
// Cap: 2 clients per room (P0 does not include an SFU). 3rd tries to join → sent
// { type: "full" } and disconnected. When P2 lands with mesh/SFU, raise this cap.

import type { Server as HttpServer, IncomingMessage } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { randomBytes } from "crypto";

interface Client { ws: WebSocket; id: string; roomId: string; name: string }
type ClientMap = Map<string, Client>;   // peerId -> Client
const rooms = new Map<string, ClientMap>();

const MAX_PER_ROOM_P0 = 2;
const ROOM_RE = /^[A-Za-z0-9_-]{4,64}$/;

function send(ws: WebSocket, obj: unknown) {
  try { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); } catch { /* peer went away */ }
}

function newPeerId(): string {
  return "p_" + randomBytes(6).toString("base64url");
}

function joinRoom(roomId: string, client: Client): { ok: true; peers: string[] } | { ok: false; reason: string } {
  let room = rooms.get(roomId);
  if (!room) { room = new Map(); rooms.set(roomId, room); }
  if (room.size >= MAX_PER_ROOM_P0) return { ok: false, reason: "full" };
  room.set(client.id, client);
  const peers = [...room.keys()].filter((k) => k !== client.id);
  return { ok: true, peers };
}

function leaveRoom(client: Client) {
  const room = rooms.get(client.roomId);
  if (!room) return;
  room.delete(client.id);
  if (room.size === 0) rooms.delete(client.roomId);
  else for (const c of room.values()) send(c.ws, { type: "peer-leave", peer: client.id });
}

function forwardToPeer(client: Client, targetId: string, payload: any) {
  const room = rooms.get(client.roomId);
  if (!room) return;
  const target = room.get(targetId);
  if (!target) return;
  send(target.ws, { ...payload, from: client.id });
}

export function attachVideoSignalWs(httpServer: HttpServer) {
  const wss = new WebSocketServer({ noServer: true });
  const path = "/api/video-signal/";

  httpServer.on("upgrade", (req: IncomingMessage, socket, head) => {
    if (!req.url || !req.url.startsWith(path)) return;
    const roomId = decodeURIComponent(req.url.slice(path.length).split("?")[0] || "");
    if (!ROOM_RE.test(roomId)) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const client: Client = { ws, id: newPeerId(), roomId, name: "guest" };
      const r = joinRoom(roomId, client);
      if (!r.ok) { send(ws, { type: r.reason }); ws.close(); return; }
      // Tell the joiner who's already here (so they can send offers to each existing peer)
      send(ws, { type: "hello", self: client.id, peers: r.peers });
      // Tell existing peers a new one arrived
      const room = rooms.get(roomId)!;
      for (const c of room.values()) if (c.id !== client.id) send(c.ws, { type: "peer-join", peer: client.id });

      ws.on("message", (raw) => {
        let msg: any; try { msg = JSON.parse(String(raw)); } catch { return; }
        if (!msg || typeof msg !== "object") return;
        switch (msg.type) {
          case "offer":
          case "answer":
          case "ice":
            if (typeof msg.to === "string") forwardToPeer(client, msg.to, msg);
            break;
          case "leave":
            ws.close();
            break;
        }
      });
      ws.on("close", () => leaveRoom(client));
      ws.on("error", () => leaveRoom(client));
    });
  });
}
