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
// Mongoose Connection is passed in from main.ts (via attachClassWs) so we can
// persist attendance events without pulling this file into a Nest module.
type Connection = { db?: { collection: (name: string) => any } };
let dbConn: Connection | null = null;
// PushService is optional — WS still runs without it (silent no-op for pushes).
type PushSvcLike = { sendToUser: (userId: string, payload: { title: string; body: string; url?: string; tag?: string }) => Promise<any> };
let pushSvc: PushSvcLike | null = null;

type Move = { from: string; to: string; promotion?: string };
// Chessground DrawShape subset — we serialize only the fields we care about
// (orig/dest/brush) so the frame stays small even with many annotations.
type Shape = { orig: string; dest?: string; brush?: string };
// Client → server frames.
//   hello: sent right after connect. If the client already has a coachToken
//     saved (reconnect), server verifies + resumes coach role. Otherwise the
//     first hello with no token claims the coach role for that room.
type ClientFrame =
  | { type: "hello"; coachToken?: string; userId?: string; displayName?: string }
  | { type: "move"; move: Move }
  | { type: "reset" }
  | { type: "lock"; locked: boolean }       // coach only — student moves are dropped when true
  | { type: "takeback" }                    // coach only — pops the last move
  | { type: "annot"; shapes: Shape[] }      // arrows/circles — anyone can annotate
  | { type: "ping" };
// Server → client frames. `role` sent once after hello resolves; everything else
// is broadcast to the room on state changes.
type ServerFrame =
  | { type: "role"; role: "coach" | "student"; coachToken?: string }
  | { type: "state"; fen: string; lastMove: Move | null; history: Move[]; participants: number; locked: boolean; shapes: Shape[] }
  | { type: "move"; move: Move; fen: string; participants: number; locked: boolean }
  | { type: "reset"; fen: string; participants: number; locked: boolean }
  | { type: "lock"; locked: boolean; participants: number }
  | { type: "annot"; shapes: Shape[]; participants: number }
  | { type: "participants"; participants: number }
  | { type: "pong" };

interface Room {
  fen: string;
  lastMove: Move | null;
  history: Move[];
  clients: Set<WebSocket>;
  coachToken: string | null;    // random shared secret — coach's browser keeps it
  coach: WebSocket | null;      // currently-connected coach socket (may go null between reconnects)
  locked: boolean;              // student-move lock
  shapes: Shape[];              // last-published annotation set (echoed to new joiners)
  emptyEvictAt: number | null;  // when to drop this room from memory after last client left
}

// Grace before an emptied room is evicted. Owner reported (2026-08-12) that
// when both coach + student briefly reconnect at the same moment, the room was
// being deleted between drops → fresh reconnects landed in a start-of-game
// board, wiping every move + shape. Keeping the room alive for a bit means
// transient network churn (or LiveKit-driven re-renders) doesn't erase state.
const EMPTY_EVICT_MS = 15 * 60_000;

// Sweep rooms whose eviction timestamp has passed. Called on every close so
// idle rooms don't leak — no separate timer.
function sweepEvicted(): void {
  const now = Date.now();
  for (const [id, r] of rooms) {
    if (r.clients.size === 0 && r.emptyEvictAt != null && r.emptyEvictAt <= now) rooms.delete(id);
  }
}

// role() and lookup helpers use a per-socket WeakMap so the ws frame handler can
// answer "is this socket the coach?" without stashing state on the socket object.
const socketRole = new WeakMap<WebSocket, "coach" | "student">();
// Persistent identity per socket for attendance — captured on hello. userId is
// null for anonymous joiners; name always has a value (falls back to "Guest").
const socketWho = new WeakMap<WebSocket, { userId: string | null; name: string; classId: string }>();
function mintCoachToken(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

// Fire-and-forget attendance writes. Silent on error — attendance is a nice-to-have
// stat; a Mongo hiccup must never disrupt a live class.
// Returns { firstJoin } so the caller can trigger a one-time late-alert on
// the very first insert (rejoins don't re-alert).
async function recordAttendance(classId: string, userId: string | null, name: string, kind: "join" | "leave"): Promise<{ firstJoin: boolean }> {
  if (!dbConn?.db) return { firstJoin: false };
  try {
    const col = dbConn.db.collection("classAttendance");
    const key = userId ? userId : `guest:${name}`;
    if (kind === "join") {
      const res = await col.updateOne(
        { classId, key },
        { $set: { classId, key, userId, name, lastSeenAt: new Date() },
          $setOnInsert: { joinedAt: new Date() } },
        { upsert: true },
      );
      return { firstJoin: !!res.upsertedId };
    } else {
      await col.updateOne({ classId, key }, { $set: { lastSeenAt: new Date() } });
      return { firstJoin: false };
    }
  } catch { return { firstJoin: false }; }
}

const LATE_THRESHOLD_MS = 5 * 60_000;   // 5 min after startAt → "late"

/** After a first-time join, if the class started > 5 min ago AND the joiner
 *  isn't the class's own coach, alert the coach. In-room WS frame goes to
 *  any coach socket in the same room; a push notification hits the coach's
 *  registered devices too so they get told even if their tab is closed. */
async function maybeAlertLate(room: Room, classId: string, userId: string | null, name: string): Promise<void> {
  if (!dbConn?.db) return;
  try {
    const klass: any = await dbConn.db.collection("classSchedules").findOne(
      { _id: classId as any },
      { projection: { title: 1, startAt: 1, createdByUserId: 1 } },
    );
    if (!klass || !klass.startAt) return;
    const startedMs = new Date(klass.startAt).getTime();
    const lateMs = Date.now() - startedMs;
    if (lateMs < LATE_THRESHOLD_MS) return;
    // The class's own coach is never "late" — they might join first.
    if (userId && klass.createdByUserId && userId === klass.createdByUserId) return;

    const lateMinutes = Math.round(lateMs / 60_000);
    // Persist for the weekly digest / audit (composite _id keeps it idempotent).
    const rowId = `${classId}:${userId ?? `guest:${name}`}`;
    await dbConn.db.collection("lateJoins").updateOne(
      { _id: rowId as any },
      { $setOnInsert: {
          classId, classTitle: klass.title || "", coachId: klass.createdByUserId ?? null,
          userId, name, lateMinutes, joinedAt: new Date(),
      } },
      { upsert: true },
    );

    // Broadcast a "lateJoin" frame to any coach socket connected to THIS
    // room so a coach who's already inside gets a real-time toast.
    const payload = JSON.stringify({ type: "lateJoin", name, userId, lateMinutes });
    for (const c of room.clients) {
      if (c.readyState !== WebSocket.OPEN) continue;
      const who = socketWho.get(c);
      if (who?.userId && klass.createdByUserId && who.userId === klass.createdByUserId) {
        try { c.send(payload); } catch { /* ignore */ }
      }
    }

    // Push to the coach's devices via the injected PushService (may be null
    // in dev — the WS still runs, just without push).
    if (pushSvc && klass.createdByUserId) {
      pushSvc.sendToUser(String(klass.createdByUserId), {
        title: `🕐 ${name} joined ${lateMinutes} min late`,
        body: klass.title || "Class in progress",
        url: `/class/${classId}`,
        tag: `cg-late-${classId}-${userId ?? name}`,
      }).catch(() => { /* per-service logged */ });
    }
  } catch { /* silent */ }
}

const START_FEN = new Chess().fen();

// One WebSocketServer, one rooms map for the process lifetime.
const wss = new WebSocketServer({ noServer: true });
const rooms = new Map<string, Room>();

function getRoom(id: string): Room {
  let r = rooms.get(id);
  if (!r) {
    r = { fen: START_FEN, lastMove: null, history: [], clients: new Set(),
          coachToken: null, coach: null, locked: false, shapes: [], emptyEvictAt: null };
    rooms.set(id, r);
  }
  // A returning client cancels pending eviction — they see the SAME state they
  // left, not a fresh start.
  r.emptyEvictAt = null;
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
  const send = (frame: ServerFrame) => { try { ws.send(JSON.stringify(frame)); } catch { /* */ } };

  // Snapshot current board to the new participant. Role isn't decided here — client
  // sends `hello` (optionally with its saved coachToken) and role is resolved there.
  send({ type: "state", fen: room.fen, lastMove: room.lastMove, history: room.history, participants: room.clients.size, locked: room.locked, shapes: room.shapes });
  broadcast(room, { type: "participants", participants: room.clients.size });

  const isCoach = () => socketRole.get(ws) === "coach";

  ws.on("message", (raw) => {
    let frame: ClientFrame;
    try { frame = JSON.parse(raw.toString()); } catch { return; }
    if (frame.type === "ping") { send({ type: "pong" }); return; }

    if (frame.type === "hello") {
      // Coach resolution:
      //   * client has token that matches the room's -> resume as coach
      //   * room has no coach token yet -> mint one, promote this client to coach
      //   * otherwise -> student
      if (frame.coachToken && room.coachToken && frame.coachToken === room.coachToken) {
        socketRole.set(ws, "coach"); room.coach = ws;
        send({ type: "role", role: "coach", coachToken: room.coachToken });
      } else if (!room.coachToken) {
        room.coachToken = mintCoachToken();
        socketRole.set(ws, "coach"); room.coach = ws;
        send({ type: "role", role: "coach", coachToken: room.coachToken });
      } else {
        socketRole.set(ws, "student");
        send({ type: "role", role: "student" });
      }
      // Attendance: identity comes from the hello frame (client reads it from the
      // session on its side). Anonymous joiners land as "Guest" and are keyed by
      // their supplied name — good enough for the coach's post-class list.
      const userId = typeof frame.userId === "string" && frame.userId.length ? frame.userId.slice(0, 64) : null;
      const name = typeof frame.displayName === "string" && frame.displayName.trim() ? frame.displayName.trim().slice(0, 80) : "Guest";
      socketWho.set(ws, { userId, name, classId: roomId });
      void (async () => {
        const { firstJoin } = await recordAttendance(roomId, userId, name, "join");
        if (firstJoin) await maybeAlertLate(room, roomId, userId, name);
      })();
      return;
    }

    if (frame.type === "reset") {
      if (!isCoach()) return;                            // coach-gated to prevent accidental reset by a student
      room.fen = START_FEN; room.lastMove = null; room.history = [];
      broadcast(room, { type: "reset", fen: room.fen, participants: room.clients.size, locked: room.locked });
      return;
    }

    if (frame.type === "lock") {
      if (!isCoach()) return;
      room.locked = !!frame.locked;
      broadcast(room, { type: "lock", locked: room.locked, participants: room.clients.size });
      return;
    }

    if (frame.type === "takeback") {
      if (!isCoach()) return;
      if (room.history.length === 0) return;
      room.history.pop();
      // Re-derive the FEN by replaying the shortened history from the start position.
      const c = new Chess();
      for (const m of room.history) {
        try { c.move({ from: m.from, to: m.to, promotion: (m.promotion as any) || "q" }); } catch { /* skip */ }
      }
      room.fen = c.fen();
      room.lastMove = room.history[room.history.length - 1] ?? null;
      broadcast(room, { type: "state", fen: room.fen, lastMove: room.lastMove, history: room.history, participants: room.clients.size, locked: room.locked, shapes: room.shapes });
      return;
    }

    if (frame.type === "annot") {
      // Anyone can annotate — this is a shared whiteboard. Coarse cap (64 shapes) so
      // one runaway client can't blow up state or bandwidth. Coordinates validated
      // so junk payloads never persist on the room.
      const raw = Array.isArray(frame.shapes) ? frame.shapes : [];
      const cleaned: Shape[] = [];
      for (const s of raw) {
        if (cleaned.length >= 64) break;
        if (!s || typeof s.orig !== "string") continue;
        if (!/^[a-h][1-8]$/.test(s.orig)) continue;
        if (s.dest != null && !/^[a-h][1-8]$/.test(String(s.dest))) continue;
        cleaned.push({ orig: s.orig, dest: s.dest, brush: typeof s.brush === "string" ? s.brush : undefined });
      }
      room.shapes = cleaned;
      broadcast(room, { type: "annot", shapes: room.shapes, participants: room.clients.size });
      return;
    }

    if (frame.type === "move" && frame.move && typeof frame.move.from === "string" && typeof frame.move.to === "string") {
      // Student-lock check: student moves are dropped when the coach has toggled the
      // lock. The sender still gets a state snapshot to reconcile any optimistic UI.
      if (room.locked && !isCoach()) { send({ type: "state", fen: room.fen, lastMove: room.lastMove, history: room.history, participants: room.clients.size, locked: room.locked, shapes: room.shapes }); return; }
      // Server-side chess.js is the tie-breaker: two racing clients can't diverge the
      // canonical FEN. Illegal moves are dropped silently — the sender's local board
      // will reconcile from the next authoritative state frame it receives.
      const c = new Chess(room.fen);
      let ok = false;
      try {
        const applied = c.move({ from: frame.move.from, to: frame.move.to, promotion: (frame.move.promotion as any) || "q" });
        ok = !!applied;
      } catch { ok = false; }
      if (!ok) { send({ type: "state", fen: room.fen, lastMove: room.lastMove, history: room.history, participants: room.clients.size, locked: room.locked, shapes: room.shapes }); return; }
      room.fen = c.fen();
      room.lastMove = { from: frame.move.from, to: frame.move.to, promotion: frame.move.promotion };
      room.history.push(room.lastMove);
      broadcast(room, { type: "move", move: room.lastMove, fen: room.fen, participants: room.clients.size, locked: room.locked });
    }
  });

  ws.on("close", () => {
    room.clients.delete(ws);
    // If the coach socket dropped, clear the pointer so a future hello with the token
    // can re-claim. The token itself is NOT reset — coach can reconnect and resume.
    if (room.coach === ws) room.coach = null;
    // Attendance leave — stamps lastSeenAt so the coach can see when someone left.
    const who = socketWho.get(ws);
    if (who) void recordAttendance(who.classId, who.userId, who.name, "leave");
    if (room.clients.size === 0) {
      // KEEP the room in memory for a grace window. Coach tab reloads, or a
      // simultaneous coach+student hiccup, no longer wipe the board. Actual
      // delete happens later via sweepEvicted() once the grace expires.
      room.emptyEvictAt = Date.now() + EMPTY_EVICT_MS;
      sweepEvicted();
      return;
    }
    broadcast(room, { type: "participants", participants: room.clients.size });
  });
});

/** Explicit close by the coach — broadcasts a `classEnded` frame so every
 *  connected student's tab bails out of the room, then closes each socket and
 *  deletes the room from memory (no grace — coach ENDED it, they're not coming
 *  back to this room id). Called from the HTTP end-class endpoint. Safe to
 *  call for a room id that isn't in memory (no-op). */
export function closeClassRoom(id: string, reason: string = "coach_left"): { closed: number } {
  const room = rooms.get(id);
  if (!room) return { closed: 0 };
  const frame = JSON.stringify({ type: "classEnded", reason });
  let n = 0;
  for (const c of room.clients) {
    if (c.readyState === WebSocket.OPEN) {
      try { c.send(frame); } catch { /* ignore */ }
      n++;
    }
    try { c.close(1000, "class-ended"); } catch { /* ignore */ }
  }
  rooms.delete(id);
  return { closed: n };
}

// Live-attendance snapshot — who is currently connected to this class right
// now (in-memory, no mongo round-trip). Returns [] when nobody has joined
// this process's room; the class may still have a stored attendance history.
// De-duplicated on userId (or on the anon guest name) so a rejoined tab
// doesn't inflate the count.
export function getLiveAttendees(classId: string): Array<{ userId: string | null; name: string }> {
  const room = rooms.get(classId);
  if (!room) return [];
  const seen = new Set<string>();
  const out: Array<{ userId: string | null; name: string }> = [];
  for (const client of room.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    const who = socketWho.get(client);
    if (!who) continue;
    const key = who.userId ? `u:${who.userId}` : `g:${who.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ userId: who.userId, name: who.name });
  }
  return out;
}

// Wire the upgrade handshake into Nest's http server. Only handles class-ws paths;
// any other upgrade attempt is destroyed so we don't accidentally answer for another
// (future) WebSocket path. Conn is Nest's mongoose Connection — used for attendance
// writes (fire-and-forget so a Mongo hiccup never disrupts the live class).
export function attachClassWs(server: HttpServer, conn?: Connection, push?: PushSvcLike): void {
  if (conn) dbConn = conn;
  if (push) pushSvc = push;
  server.on("upgrade", (req, socket, head) => {
    if (parseRoomId(req.url) == null) return; // let another handler (or default) close it
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });
}
