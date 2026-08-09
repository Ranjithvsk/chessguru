// From-scratch video signaling — P0/P1 slice of CHESSGURU-VIDEO-FROM-SCRATCH.md.
//
// A minimal WebSocket message bus that relays WebRTC SDP offers/answers + ICE
// candidates between browsers in the same room. NO SFU here — for exactly 2
// participants per room, browsers establish direct P2P connections through STUN
// (P0) or TURN (P1) and pipe media browser-to-browser.
//
// URL:      wss://<host>/v2api/api/video-signal/<roomId>
// Protocol (JSON per frame):
//   incoming  { type: "join" }                           — implicit on connect via URL
//   outgoing  { type: "hello", self: <peerId>, peers: [<peerId>...], as: {userId, name} | null }
//   outgoing  { type: "peer-join", peer: <peerId> }      — someone else joined
//   outgoing  { type: "peer-leave", peer: <peerId> }     — someone left
//   both      { type: "offer",  from, to, sdp }          — relayed to `to`
//   both      { type: "answer", from, to, sdp }          — relayed to `to`
//   both      { type: "ice",    from, to, candidate }    — relayed to `to`
//   incoming  { type: "leave" }                          — voluntary disconnect
//
// P1 additions on top of P0:
//   - Cookie-authed via ChessGuru session (cgsid): looks up the session in mongo,
//     stamps the connection with (userId, username). Guests still allowed but
//     tagged as guest for attendance.
//   - Attendance rows written to classAttendance on join + refreshed on leave
//     (same schema as class-ws.ts / class-attendance.controller.ts). One row
//     per (classId=roomId, key). Rejoins update lastSeenAt but preserve joinedAt.
//   - Room cap still 2 (P0 promise — SFU lands in P2).

import type { Server as HttpServer, IncomingMessage } from "http";
import type { Connection } from "mongoose";
import { WebSocketServer, WebSocket } from "ws";
import { randomBytes } from "crypto";

interface Client { ws: WebSocket; id: string; roomId: string; userId: string | null; name: string; key: string }
type ClientMap = Map<string, Client>;
interface Room { clients: ClientMap; moderator: string | null }
const rooms = new Map<string, Room>();

// P0 = 2 (direct P2P). P2a = 8 (mesh; each client holds N-1 peer connections
// so beyond ~5 the per-client upload cost swamps consumer wifi -- SFU lands
// in P2b to raise this).
const MAX_PER_ROOM = 8;
const ROOM_RE = /^[A-Za-z0-9_-]{4,64}$/;

function send(ws: WebSocket, obj: unknown) {
  try { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); } catch { /* peer gone */ }
}
function newPeerId(): string { return "p_" + randomBytes(6).toString("base64url"); }

// Parse the cgsid cookie value (URL-encoded `s:<sid>.<sig>`) → return bare sid.
// We DON'T HMAC-verify here — sids are 32 chars of randomBytes (256 bits), guessing
// is cryptographically impossible; and if a valid cookie is stolen the game is over
// regardless of HMAC. Mongo lookup on the sid is the real proof of session.
function extractSid(cookieHeader?: string): string | null {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(/(?:^|;\s*)cgsid=([^;]+)/);
  if (!m) return null;
  const raw = decodeURIComponent(m[1] || "");
  const stripped = raw.startsWith("s:") ? raw.slice(2) : raw;
  const dot = stripped.indexOf(".");
  return dot === -1 ? stripped : stripped.slice(0, dot);
}

async function resolveIdentity(conn: Connection | null, cookieHeader?: string): Promise<{ userId: string | null; username: string }> {
  const sid = extractSid(cookieHeader);
  if (!sid || !conn) return { userId: null, username: "Guest" };
  try {
    const row: any = await conn.db!.collection("sessions").findOne({ _id: sid as any });
    if (!row?.session) return { userId: null, username: "Guest" };
    const payload = typeof row.session === "string" ? JSON.parse(row.session) : row.session;
    if (!payload?.userId) return { userId: null, username: "Guest" };
    return { userId: String(payload.userId), username: String(payload.username || payload.userId) };
  } catch { return { userId: null, username: "Guest" }; }
}

// Attendance: same shape as class-ws / class-attendance.controller.ts. Idempotent
// upsert per (classId, key) so rejoins don't create duplicate rows.
async function writeJoin(conn: Connection | null, client: Client) {
  if (!conn) return;
  try {
    const now = new Date();
    await conn.db!.collection("classAttendance").updateOne(
      { classId: client.roomId, key: client.key },
      { $setOnInsert: { joinedAt: now }, $set: { lastSeenAt: now, name: client.name, userId: client.userId } },
      { upsert: true },
    );
  } catch { /* log-only failure; don't take down the call */ }
}
async function writeLeave(conn: Connection | null, client: Client) {
  if (!conn) return;
  try {
    await conn.db!.collection("classAttendance").updateOne(
      { classId: client.roomId, key: client.key },
      { $set: { lastSeenAt: new Date() } },
    );
  } catch { /* log-only */ }
}

type PeerSummary = { id: string; name: string; userId: string | null };
function joinRoom(roomId: string, client: Client): { ok: true; peers: PeerSummary[]; moderator: string } | { ok: false; reason: string } {
  let room = rooms.get(roomId);
  if (!room) { room = { clients: new Map(), moderator: null }; rooms.set(roomId, room); }
  if (room.clients.size >= MAX_PER_ROOM) return { ok: false, reason: "full" };
  room.clients.set(client.id, client);
  // First joiner = moderator (the "coach" convention). Persists until they leave.
  if (!room.moderator) room.moderator = client.id;
  const peers: PeerSummary[] = [];
  for (const c of room.clients.values()) if (c.id !== client.id) peers.push({ id: c.id, name: c.name, userId: c.userId });
  return { ok: true, peers, moderator: room.moderator };
}
function leaveRoom(client: Client) {
  const room = rooms.get(client.roomId);
  if (!room) return;
  room.clients.delete(client.id);
  if (room.clients.size === 0) { rooms.delete(client.roomId); return; }
  // Moderator left: hand the crown to the next longest-in-room (Map preserves
  // insertion order). Broadcast moderator-change so all clients update the 👑.
  if (room.moderator === client.id) {
    const next = room.clients.values().next().value;
    room.moderator = next ? next.id : null;
    for (const c of room.clients.values()) send(c.ws, { type: "moderator-change", moderator: room.moderator });
  }
  for (const c of room.clients.values()) send(c.ws, { type: "peer-leave", peer: client.id });
}
function forwardToPeer(client: Client, targetId: string, payload: any) {
  const room = rooms.get(client.roomId);
  if (!room) return;
  const target = room.clients.get(targetId);
  if (!target) return;
  send(target.ws, { ...payload, from: client.id });
}

export function attachVideoSignalWs(httpServer: HttpServer, conn: Connection | null) {
  const wss = new WebSocketServer({ noServer: true });
  const path = "/api/video-signal/";

  httpServer.on("upgrade", async (req: IncomingMessage, socket, head) => {
    if (!req.url || !req.url.startsWith(path)) return;
    const roomId = decodeURIComponent(req.url.slice(path.length).split("?")[0] || "");
    if (!ROOM_RE.test(roomId)) { socket.destroy(); return; }

    // Resolve identity BEFORE finishing the upgrade so the peerId + attendance
    // row carry the real user id if they're signed in.
    const ident = await resolveIdentity(conn, req.headers?.cookie);

    wss.handleUpgrade(req, socket, head, (ws) => {
      const peerId = newPeerId();
      const key = ident.userId || `guest:${peerId}`;
      const client: Client = { ws, id: peerId, roomId, userId: ident.userId, name: ident.username, key };

      const r = joinRoom(roomId, client);
      if (!r.ok) { send(ws, { type: r.reason }); ws.close(); return; }

      send(ws, { type: "hello", self: client.id, peers: r.peers, moderator: r.moderator, as: { userId: client.userId, name: client.name } });
      const room = rooms.get(roomId)!;
      for (const c of room.clients.values()) if (c.id !== client.id) send(c.ws, { type: "peer-join", peer: client.id, name: client.name, userId: client.userId });
      writeJoin(conn, client);

      ws.on("message", (raw) => {
        let msg: any; try { msg = JSON.parse(String(raw)); } catch { return; }
        if (!msg || typeof msg !== "object") return;
        const room = rooms.get(client.roomId);
        const isMod = !!room && room.moderator === client.id;
        switch (msg.type) {
          case "offer":
          case "answer":
          case "ice":
            if (typeof msg.to === "string") forwardToPeer(client, msg.to, msg);
            break;
          case "broadcast": {
            // Generic room-wide relay for chat / raise-hand / reactions /
            // captions / any client-driven ephemeral event.
            if (!room) break;
            const outbound = { type: "broadcast", from: client.id, name: client.name, subtype: msg.subtype, payload: msg.payload };
            for (const c of room.clients.values()) if (c.id !== client.id) send(c.ws, outbound);
            break;
          }
          case "mod": {
            // Moderator-only commands: mute-all, kick, spotlight. Rejected
            // silently for non-mods (no error surface = no info-leak on
            // whether the target exists).
            if (!isMod || !room) break;
            const action = String(msg.action || "");
            if (action === "mute-all") {
              for (const c of room.clients.values()) if (c.id !== client.id) send(c.ws, { type: "mod", action: "force-mute", from: client.id, name: client.name });
            } else if (action === "kick" && typeof msg.target === "string") {
              const target = room.clients.get(msg.target);
              if (target) { send(target.ws, { type: "mod", action: "kicked", from: client.id, name: client.name }); try { target.ws.close(); } catch {} }
            } else if (action === "spotlight" && (typeof msg.target === "string" || msg.target === null)) {
              const spot = msg.target;
              for (const c of room.clients.values()) send(c.ws, { type: "mod", action: "spotlight", target: spot, from: client.id });
            }
            break;
          }
          case "leave":
            ws.close();
            break;
        }
      });
      const cleanup = () => { leaveRoom(client); writeLeave(conn, client); };
      ws.on("close", cleanup);
      ws.on("error", cleanup);
    });
  });
}
