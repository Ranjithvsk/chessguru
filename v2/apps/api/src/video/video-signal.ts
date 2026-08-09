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
const rooms = new Map<string, ClientMap>();

const MAX_PER_ROOM_P0 = 2;
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

      send(ws, { type: "hello", self: client.id, peers: r.peers, as: { userId: client.userId, name: client.name } });
      const room = rooms.get(roomId)!;
      for (const c of room.values()) if (c.id !== client.id) send(c.ws, { type: "peer-join", peer: client.id });
      writeJoin(conn, client);

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
      const cleanup = () => { leaveRoom(client); writeLeave(conn, client); };
      ws.on("close", cleanup);
      ws.on("error", cleanup);
    });
  });
}
