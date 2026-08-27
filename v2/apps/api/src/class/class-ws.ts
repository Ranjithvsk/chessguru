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
import { resolveEligibility, isStudentEligible } from "./class-eligibility";
// Mongoose Connection is passed in from main.ts (via attachClassWs) so we can
// persist attendance events without pulling this file into a Nest module.
type Connection = { db?: { collection: (name: string) => any } };
let dbConn: Connection | null = null;
// PushService is optional — WS still runs without it (silent no-op for pushes).
type PushSvcLike = { sendToUser: (userId: string, payload: { title: string; body: string; url?: string; tag?: string }) => Promise<any> };
let pushSvc: PushSvcLike | null = null;

type Move = { from: string; to: string; promotion?: string };
// Tree node stored on the room — { move, children }. Root is a virtual
// pre-move node with no `move`. Coach playing a new move at a rewound
// cursor now APPENDS a variation instead of truncating the future
// (matches Lichess-analysis semantics + /openings free-play tree).
type TreeNode = { move: Move; children: TreeNode[] };
// Chessground DrawShape subset — we serialize only the fields we care about
// (orig/dest/brush) so the frame stays small even with many annotations.
type Shape = { orig: string; dest?: string; brush?: string };
type Orientation = "white" | "black";
// Client → server frames.
//   hello: sent right after connect. If the client already has a coachToken
//     saved (reconnect), server verifies + resumes coach role. Otherwise the
//     first hello with no token claims the coach role for that room.
type ClientFrame =
  | { type: "hello"; coachToken?: string; userId?: string; displayName?: string; intendedRole?: "coach" | "student" }
  | { type: "move"; move: Move }
  | { type: "reset" }
  | { type: "loadFen"; fen: string }        // coach only — set the board to an arbitrary position
  | { type: "lock"; locked: boolean }       // coach only — student moves are dropped when true
  | { type: "takeback" }                    // coach only — pops the last move (legacy: destructive)
  | { type: "seek"; cursorIdx?: number; path?: number[] }     // coach only — jump cursor to a specific ply (0 = startFen, history.length = live) OR to a tree path
  | { type: "promote-variation"; path: number[] }             // coach only — swap node at path with sibling to its left (one step toward mainline)
  | { type: "make-mainline"; path: number[] }                 // coach only — for every ancestor along path with idx>0, swap into position 0
  | { type: "delete-from"; path: number[] }                   // coach only — remove node at path + subtree; cursor moves to parent
  | { type: "stepBack" }                    // coach only — cursor--, keeps history so students can step forward again
  | { type: "stepForward" }                 // coach only — cursor++
  | { type: "annot"; shapes: Shape[] }      // arrows/circles — anyone can annotate
  | { type: "pointer"; x: number; y: number } // coach only — live cursor over board (normalized 0..1)
  | { type: "pointer-off" }                   // coach only — cursor left the board
  | { type: "orientation"; orientation: Orientation } // coach only — flip board for everyone
  | { type: "ping" };
// Server → client frames. `role` sent once after hello resolves; everything else
// is broadcast to the room on state changes.
type ServerFrame =
  | { type: "role"; role: "coach" | "student"; coachToken?: string }
  | { type: "state"; fen: string; startFen: string; lastMove: Move | null; history: Move[]; cursorIdx: number; tree: TreeNode[]; cursorPath: number[]; participants: number; locked: boolean; shapes: Shape[]; orientation: Orientation }
  | { type: "move"; move: Move; fen: string; startFen: string; history: Move[]; cursorIdx: number; tree: TreeNode[]; cursorPath: number[]; participants: number; locked: boolean }
  | { type: "reset"; fen: string; participants: number; locked: boolean }
  | { type: "lock"; locked: boolean; participants: number }
  | { type: "annot"; shapes: Shape[]; participants: number }
  | { type: "pointer"; x: number; y: number }  // coach's live cursor over the board (normalized 0..1)
  | { type: "pointer-off" }                    // coach's cursor left the board (students hide the dot)
  | { type: "orientation"; orientation: Orientation }
  | { type: "participants"; participants: number }
  | { type: "pong" };

interface Room {
  fen: string;
  /** FEN the current move sequence started from — default = standard opening,
   *  reset on `loadFen` (setup position). Sent in every state broadcast so the
   *  client can render notation from an arbitrary starting position ("1... Kb8"
   *  when the coach loaded a mid-game FEN with black to move). */
  startFen: string;
  /** Full variation tree from startFen. Coach playing a new move at a rewound
   *  cursor creates a variation (sibling child) instead of truncating the
   *  future — matches Lichess-analysis + /openings semantics. */
  tree: TreeNode[];
  /** Cursor into the tree: array of child indices from root. Empty = at
   *  startFen (no moves played yet). Mainline is always the FIRST child at
   *  each depth (index 0). */
  cursorPath: number[];
  lastMove: Move | null;
  /** Legacy: linear "mainline up to cursor" — kept in sync from tree +
   *  cursorPath so pre-tree clients still render notation. Removed once
   *  every client ships with tree-aware rendering. */
  history: Move[];
  /** How many moves of `history` are currently shown. cursorIdx === history.length
   *  means "at latest position (live)". cursorIdx < history.length means the
   *  coach is reviewing a past position; students see the same past position
   *  because fen/lastMove reflect it. A NEW move from the live position (or
   *  from a rewound position) truncates any moves after cursorIdx (like a text
   *  editor's undo → new type). Owner-asked 2026-08-12 for prev/next arrows so
   *  a coach can walk through a game without destroying the move list. */
  cursorIdx: number;
  clients: Set<WebSocket>;
  coachToken: string | null;    // random shared secret — coach's browser keeps it
  coach: WebSocket | null;      // currently-connected coach socket (may go null between reconnects)
  locked: boolean;              // student-move lock
  shapes: Shape[];              // last-published annotation set (echoed to new joiners)
  orientation: Orientation;     // board POV — coach can flip; students always mirror
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
    // Default LOCKED so students can't scramble the board just by clicking a
    // piece — owner reported 2026-08-12 that "students were controlling
    // moves". Coach can unlock via the footer 🔒 toggle for interactive drills.
    r = { fen: START_FEN, startFen: START_FEN, tree: [], cursorPath: [], lastMove: null, history: [], cursorIdx: 0, clients: new Set(),
          coachToken: null, coach: null, locked: true, shapes: [], orientation: "white", emptyEvictAt: null };
    rooms.set(id, r);
  }
  // A returning client cancels pending eviction — they see the SAME state they
  // left, not a fresh start.
  r.emptyEvictAt = null;
  return r;
}

// Re-derive fen + lastMove from history[0..cursorIdx]. Called after any
// cursor/history change so `room.fen` is always the SEEN position, not the
// latest-move position (they diverge whenever the coach steps back).
/** Walk the tree along cursorPath, collecting the moves for legacy
 *  `history` + `cursorIdx` fields (still emitted for backward compat). */
function nodesAt(tree: TreeNode[], path: number[]): TreeNode[] {
  const out: TreeNode[] = [];
  let cur = tree;
  for (const idx of path) {
    const n = cur[idx];
    if (!n) break;
    out.push(n);
    cur = n.children;
  }
  return out;
}
function pathMoves(tree: TreeNode[], path: number[]): Move[] {
  return nodesAt(tree, path).map((n) => n.move);
}
/** Fen after applying every move along cursorPath. Falls back to a fresh
 *  game if startFen is corrupt so a bad frame can't wedge the room. */
function fenAtPath(startFen: string, tree: TreeNode[], path: number[]): { fen: string; last: Move | null } {
  let c: Chess;
  try { c = new Chess(startFen); } catch { c = new Chess(); }
  let last: Move | null = null;
  for (const n of nodesAt(tree, path)) {
    try {
      c.move({ from: n.move.from, to: n.move.to, promotion: (n.move.promotion as any) || "q" });
      last = n.move;
    } catch { break; }
  }
  return { fen: c.fen(), last };
}
function recomputeFromTree(room: Room): void {
  const r = fenAtPath(room.startFen, room.tree, room.cursorPath);
  room.fen = r.fen;
  room.lastMove = r.last;
  const moves = pathMoves(room.tree, room.cursorPath);
  room.history = moves;
  room.cursorIdx = moves.length;
}
/** Total plies in the current line (up to end of mainline from cursor).
 *  Used by legacy stepForward — walks one child[0] at a time from cursor. */
function extendMainlineOnce(tree: TreeNode[], path: number[]): number[] | null {
  const nodes = nodesAt(tree, path);
  const parentChildren = nodes.length === 0 ? tree : nodes[nodes.length - 1]!.children;
  if (parentChildren.length === 0) return null;
  return [...path, 0];
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
  send({ type: "state", fen: room.fen, startFen: room.startFen, lastMove: room.lastMove, history: room.history, cursorIdx: room.cursorIdx, tree: room.tree, cursorPath: room.cursorPath, participants: room.clients.size, locked: room.locked, shapes: room.shapes, orientation: room.orientation });
  broadcast(room, { type: "participants", participants: room.clients.size });

  const isCoach = () => socketRole.get(ws) === "coach";

  ws.on("message", (raw) => {
    let frame: ClientFrame;
    try { frame = JSON.parse(raw.toString()); } catch { return; }
    if (frame.type === "ping") { send({ type: "pong" }); return; }

    if (frame.type === "hello") {
      // Coach resolution (owner tightened 2026-08-12 after the "Setup button
      // disappeared after reload" bug — client hadn't been persisting the
      // coachToken between reconnects, so a reload demoted the coach to a
      // student for the rest of the class):
      //   * client has a token that matches the room's -> resume as coach
      //   * room has no coach token yet -> mint one, promote this client
      //   * room HAS a coach token but NO live coach socket AND client asked
      //     for role=coach in the URL -> honour the fresh claim, mint a new
      //     token (the old one gets orphaned — reload from a stale tab will
      //     fail its match and land as student, which is correct)
      //   * otherwise -> student
      // Immediate role decision — server sends this role right away. If the
      // synchronous checks don't promote to coach but the caller's userId
      // matches the class creator (per classSchedules/announcements), we
      // upgrade to coach ASYNCHRONOUSLY after the DB lookup. Owner report
      // 2026-08-27: coach refresh loses every function — the previous
      // synchronous "intendedRole===coach && !room.coach" path failed when
      // the old ws's close event hadn't fired yet, so room.coach still
      // pointed at the dead socket and coach fell through to student.
      let resolvedSynchronously = false;
      if (frame.coachToken && room.coachToken && frame.coachToken === room.coachToken) {
        socketRole.set(ws, "coach"); room.coach = ws;
        send({ type: "role", role: "coach", coachToken: room.coachToken });
        resolvedSynchronously = true;
      } else if (!room.coachToken) {
        room.coachToken = mintCoachToken();
        socketRole.set(ws, "coach"); room.coach = ws;
        send({ type: "role", role: "coach", coachToken: room.coachToken });
        resolvedSynchronously = true;
      } else if (frame.intendedRole === "coach" && !room.coach) {
        room.coachToken = mintCoachToken();
        socketRole.set(ws, "coach"); room.coach = ws;
        send({ type: "role", role: "coach", coachToken: room.coachToken });
        resolvedSynchronously = true;
      } else {
        socketRole.set(ws, "student");
        send({ type: "role", role: "student" });
      }
      // Session-based coach re-auth. If the caller's session identifies them
      // as the class's creator (or academy_owner), promote to coach even if
      // the token didn't match — covers "coach refresh, room.coach stale
      // because old close hasn't fired" AND "coach cleared localStorage".
      // Runs off the DB, so async — the immediate role frame already went
      // out; we upgrade + send a fresh role frame if needed.
      if (!resolvedSynchronously && frame.intendedRole === "coach") {
        const uidForCoach = typeof frame.userId === "string" ? frame.userId : null;
        if (uidForCoach && dbConn?.db) {
          void (async () => {
            try {
              const [klass, announce] = await Promise.all([
                dbConn!.db!.collection("classSchedules").findOne({ _id: roomId as any }, { projection: { createdByUserId: 1, academyId: 1 } }),
                dbConn!.db!.collection("classLiveAnnouncements").findOne({ _id: roomId as any }, { projection: { coachUserId: 1, academyId: 1 } }),
              ]);
              const creator: string | null = (klass as any)?.createdByUserId ?? (announce as any)?.coachUserId ?? null;
              if (creator && creator === uidForCoach) {
                // Boot the stale coach socket (if the pointer is a dead one
                // it's a no-op close; if it's a live one, this is a coach
                // takeover — same behaviour as re-claim after End Class).
                if (room.coach && room.coach !== ws) {
                  try { room.coach.close(1000, "coach_takeover"); } catch { /* */ }
                }
                room.coachToken = mintCoachToken();
                socketRole.set(ws, "coach");
                room.coach = ws;
                send({ type: "role", role: "coach", coachToken: room.coachToken });
              }
            } catch { /* silent — student role stays */ }
          })();
        }
      }
      // Attendance: identity comes from the hello frame (client reads it from the
      // session on its side). Anonymous joiners land as "Guest" and are keyed by
      // their supplied name — good enough for the coach's post-class list.
      const userId = typeof frame.userId === "string" && frame.userId.length ? frame.userId.slice(0, 64) : null;
      const name = typeof frame.displayName === "string" && frame.displayName.trim() ? frame.displayName.trim().slice(0, 80) : "Guest";
      socketWho.set(ws, { userId, name, classId: roomId });
      // Persisted kick check — if this user has been removed from THIS
      // class session, drop them straight away with a `kicked` frame.
      // Runs off the hello (rather than in the upgrade handshake) because
      // that's where we first learn who this socket belongs to.
      void (async () => {
        if (userId) {
          const kicks = await loadKicksForRoom(roomId);
          if (kicks.has(userId)) {
            try { ws.send(JSON.stringify({ type: "kicked", reason: "coach_removed" })); } catch { /* ignore */ }
            try { ws.close(1000, "kicked"); } catch { /* ignore */ }
            return;
          }
        }
        // Audience gate — for STUDENTS only. Non-coach clients who aren't
        // in the class's picked audience (batch / individuals / coach's
        // students) get dropped with a `not-invited` frame. The coach and
        // guests (anonymous) are always allowed — coach because they can't
        // be locked out of their own room, guests because eligibility keys
        // on userId which they don't have. Owner ask 2026-08-25.
        if (dbConn && socketRole.get(ws) !== "coach" && userId) {
          try {
            const elig = await resolveEligibility(dbConn as any, roomId, null);
            if (!isStudentEligible(elig, userId)) {
              try { ws.send(JSON.stringify({ type: "not-invited" })); } catch { /* ignore */ }
              try { ws.close(1000, "not-invited"); } catch { /* ignore */ }
              return;
            }
          } catch { /* fail-open — a mongo hiccup mustn't lock the class */ }
        }
        const { firstJoin } = await recordAttendance(roomId, userId, name, "join");
        if (firstJoin) await maybeAlertLate(room, roomId, userId, name);
      })();
      return;
    }

    if (frame.type === "reset") {
      if (!isCoach()) return;                            // coach-gated to prevent accidental reset by a student
      room.fen = START_FEN; room.startFen = START_FEN; room.tree = []; room.cursorPath = []; room.lastMove = null; room.history = []; room.cursorIdx = 0;
      broadcast(room, { type: "reset", fen: room.fen, participants: room.clients.size, locked: room.locked });
      // Also emit a full state so tree-aware clients drop their cached tree.
      broadcast(room, { type: "state", fen: room.fen, startFen: room.startFen, lastMove: room.lastMove, history: room.history, cursorIdx: room.cursorIdx, tree: room.tree, cursorPath: room.cursorPath, participants: room.clients.size, locked: room.locked, shapes: room.shapes, orientation: room.orientation });
      return;
    }

    if (frame.type === "seek") {
      // Coach-only jump. Two shapes accepted:
      //  * { path: number[] } — jump to a specific node in the tree (used by
      //    the /openings-style notation panel to seek a variation).
      //  * { cursorIdx: number } — legacy: jump N plies along the MAINLINE
      //    from root. Convert to a path of [0,0,0,...] of the requested length.
      if (!isCoach()) return;
      let nextPath: number[] | null = null;
      const p = (frame as any).path;
      if (Array.isArray(p)) {
        const cleaned: number[] = [];
        let cur = room.tree;
        for (const raw of p) {
          const idx = Math.trunc(Number(raw));
          if (!Number.isFinite(idx) || idx < 0 || idx >= cur.length) break;
          cleaned.push(idx);
          cur = cur[idx]!.children;
        }
        nextPath = cleaned;
      } else {
        const raw = Number((frame as any).cursorIdx);
        if (!Number.isFinite(raw)) return;
        const want = Math.max(0, Math.round(raw));
        // Walk mainline (child[0]) up to `want` moves.
        const built: number[] = [];
        let cur = room.tree;
        for (let i = 0; i < want; i++) {
          if (cur.length === 0) break;
          built.push(0);
          cur = cur[0]!.children;
        }
        nextPath = built;
      }
      if (!nextPath) return;
      // Idempotent — same path means no-op broadcast.
      if (nextPath.length === room.cursorPath.length && nextPath.every((v, i) => v === room.cursorPath[i])) return;
      room.cursorPath = nextPath;
      recomputeFromTree(room);
      broadcast(room, { type: "state", fen: room.fen, startFen: room.startFen, lastMove: room.lastMove, history: room.history, cursorIdx: room.cursorIdx, tree: room.tree, cursorPath: room.cursorPath, participants: room.clients.size, locked: room.locked, shapes: room.shapes, orientation: room.orientation });
      return;
    }

    if (frame.type === "promote-variation" || frame.type === "make-mainline" || frame.type === "delete-from") {
      // Coach-only tree edits — mirror useFreePlay's promoteVariation /
      // makeMainLine / deleteFrom semantics so the Dream Meet notation
      // matches /openings analysis exactly.
      if (!isCoach()) return;
      const p = (frame as any).path;
      if (!Array.isArray(p) || p.length === 0) return;
      // Validate path indices before mutating.
      const cleaned: number[] = [];
      let cur = room.tree;
      for (const raw of p) {
        const idx = Math.trunc(Number(raw));
        if (!Number.isFinite(idx) || idx < 0 || idx >= cur.length) return;
        cleaned.push(idx);
        cur = cur[idx]!.children;
      }
      if (frame.type === "promote-variation") {
        const k = cleaned[cleaned.length - 1]!;
        if (k <= 0) return;   // already mainline at this branch point
        // Walk to the parent children[] array (by ref).
        let parentArr = room.tree;
        for (let i = 0; i < cleaned.length - 1; i++) parentArr = parentArr[cleaned[i]!]!.children;
        [parentArr[k - 1], parentArr[k]] = [parentArr[k]!, parentArr[k - 1]!];
        // Cursor: if current cursorPath starts with the moved node's path,
        // adjust the index at this depth from k → k-1 so the cursor follows.
        if (room.cursorPath.length >= cleaned.length &&
            cleaned.slice(0, -1).every((v, i) => v === room.cursorPath[i]) &&
            room.cursorPath[cleaned.length - 1] === k) {
          room.cursorPath = [...cleaned.slice(0, -1), k - 1, ...room.cursorPath.slice(cleaned.length)];
        }
      } else if (frame.type === "make-mainline") {
        // For every ancestor along cleaned whose index > 0, swap into slot 0.
        let arr = room.tree;
        const nextCursor: number[] = [];
        // Track how the caller's cursor changes: whenever a slot 0 swap
        // moves the coach's cursor's node, remap accordingly.
        for (let i = 0; i < cleaned.length; i++) {
          const k = cleaned[i]!;
          if (k > 0) {
            [arr[0], arr[k]] = [arr[k]!, arr[0]!];
            // If cursor at this depth was pointing at either k or 0, remap.
            if (room.cursorPath.length > i && cleaned.slice(0, i).every((v, j) => v === room.cursorPath[j])) {
              const c = room.cursorPath[i]!;
              if (c === 0)      room.cursorPath = [...room.cursorPath.slice(0, i), k, ...room.cursorPath.slice(i + 1)];
              else if (c === k) room.cursorPath = [...room.cursorPath.slice(0, i), 0, ...room.cursorPath.slice(i + 1)];
            }
          }
          nextCursor.push(0);
          arr = arr[0]!.children;
        }
        // Prefer the promoted node itself as new cursor unless the
        // coach's cursor is deeper — keep them there.
        if (room.cursorPath.length <= cleaned.length) room.cursorPath = nextCursor;
      } else {
        // delete-from: splice node at cleaned out of its parent's children[].
        let parentArr = room.tree;
        for (let i = 0; i < cleaned.length - 1; i++) parentArr = parentArr[cleaned[i]!]!.children;
        const k = cleaned[cleaned.length - 1]!;
        parentArr.splice(k, 1);
        // If cursor was inside the deleted subtree, move it to the parent.
        if (room.cursorPath.length >= cleaned.length &&
            cleaned.every((v, i) => v === room.cursorPath[i])) {
          room.cursorPath = cleaned.slice(0, -1);
        } else if (room.cursorPath.length >= cleaned.length &&
                   cleaned.slice(0, -1).every((v, i) => v === room.cursorPath[i]) &&
                   (room.cursorPath[cleaned.length - 1] ?? -1) > k) {
          // Cursor was on a later sibling — shift its index down by 1.
          room.cursorPath = [...cleaned.slice(0, -1), room.cursorPath[cleaned.length - 1]! - 1, ...room.cursorPath.slice(cleaned.length)];
        }
      }
      recomputeFromTree(room);
      broadcast(room, { type: "state", fen: room.fen, startFen: room.startFen, lastMove: room.lastMove, history: room.history, cursorIdx: room.cursorIdx, tree: room.tree, cursorPath: room.cursorPath, participants: room.clients.size, locked: room.locked, shapes: room.shapes, orientation: room.orientation });
      return;
    }

    if (frame.type === "stepBack" || frame.type === "stepForward") {
      // Coach-only cursor walk over the tree — non-destructive. Back drops
      // the last index; forward extends into child[0] (mainline).
      if (!isCoach()) return;
      if (frame.type === "stepBack") {
        if (room.cursorPath.length === 0) return;
        room.cursorPath = room.cursorPath.slice(0, -1);
      } else {
        const extended = extendMainlineOnce(room.tree, room.cursorPath);
        if (!extended) return;
        room.cursorPath = extended;
      }
      recomputeFromTree(room);
      broadcast(room, { type: "state", fen: room.fen, startFen: room.startFen, lastMove: room.lastMove, history: room.history, cursorIdx: room.cursorIdx, tree: room.tree, cursorPath: room.cursorPath, participants: room.clients.size, locked: room.locked, shapes: room.shapes, orientation: room.orientation });
      return;
    }

    if (frame.type === "loadFen") {
      // Coach-only: replace the board with an arbitrary starting position (for
      // teaching endgames, tactics, or a paste-from-Lichess/Chess.com position).
      // Owner-asked 2026-08-12 for the ability to set up positions during class.
      // History is cleared — the loaded FEN becomes the new base position; moves
      // played from here go into a fresh history[] so takeback stops at the setup.
      if (!isCoach()) return;
      let cleanFen: string;
      try {
        const c = new Chess(frame.fen);   // constructor validates + normalizes
        cleanFen = c.fen();
      } catch {
        // Bad FEN — silently ignore rather than crash the room. Coach's modal
        // should already have chess.js-validated it client-side too.
        return;
      }
      room.fen = cleanFen;
      room.startFen = cleanFen;   // notation numbering now starts from this position
      room.tree = [];
      room.cursorPath = [];
      room.lastMove = null;
      room.history = [];
      room.cursorIdx = 0;
      room.shapes = [];    // stale arrows/circles from the previous position are meaningless
      broadcast(room, { type: "state", fen: room.fen, startFen: room.startFen, lastMove: room.lastMove, history: room.history, cursorIdx: room.cursorIdx, tree: room.tree, cursorPath: room.cursorPath, participants: room.clients.size, locked: room.locked, shapes: room.shapes, orientation: room.orientation });
      return;
    }

    if (frame.type === "lock") {
      if (!isCoach()) return;
      room.locked = !!frame.locked;
      broadcast(room, { type: "lock", locked: room.locked, participants: room.clients.size });
      return;
    }

    if (frame.type === "orientation") {
      if (!isCoach()) return;
      const next: Orientation = frame.orientation === "black" ? "black" : "white";
      if (room.orientation === next) return;
      room.orientation = next;
      broadcast(room, { type: "orientation", orientation: room.orientation });
      return;
    }

    if (frame.type === "takeback") {
      // Delete the node at cursor + move cursor back one. In tree terms:
      // splice the current node out of its parent's children array, then
      // truncate cursorPath by one. If cursor is at root there's nothing
      // to take back.
      if (!isCoach()) return;
      if (room.cursorPath.length === 0) return;
      const path = room.cursorPath;
      let parentChildren = room.tree;
      for (let i = 0; i < path.length - 1; i++) parentChildren = parentChildren[path[i]!]!.children;
      const lastIdx = path[path.length - 1]!;
      parentChildren.splice(lastIdx, 1);
      room.cursorPath = path.slice(0, -1);
      recomputeFromTree(room);
      broadcast(room, { type: "state", fen: room.fen, startFen: room.startFen, lastMove: room.lastMove, history: room.history, cursorIdx: room.cursorIdx, tree: room.tree, cursorPath: room.cursorPath, participants: room.clients.size, locked: room.locked, shapes: room.shapes, orientation: room.orientation });
      return;
    }

    if (frame.type === "pointer" || frame.type === "pointer-off") {
      // Coach-only live cursor broadcast — students see where the coach is
      // gesturing over the board even without an actual move. Dropped for
      // non-coach senders (silent — normal students shouldn't be firing this
      // anyway, but a rogue tab won't turn every student's board into a
      // 60-fps stream of noise). Not echoed back to the sender.
      if (!isCoach()) return;
      let out: ServerFrame;
      if (frame.type === "pointer") {
        // Clamp coords to [0,1] so a malformed frame can't render off-canvas.
        const x = Math.max(0, Math.min(1, Number(frame.x) || 0));
        const y = Math.max(0, Math.min(1, Number(frame.y) || 0));
        out = { type: "pointer", x, y };
      } else {
        out = { type: "pointer-off" };
      }
      const payload = JSON.stringify(out);
      for (const c of room.clients) {
        if (c === ws) continue;                     // don't echo to sender
        if (c.readyState !== WebSocket.OPEN) continue;
        try { c.send(payload); } catch { /* ignore */ }
      }
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
      if (room.locked && !isCoach()) { send({ type: "state", fen: room.fen, startFen: room.startFen, lastMove: room.lastMove, history: room.history, cursorIdx: room.cursorIdx, tree: room.tree, cursorPath: room.cursorPath, participants: room.clients.size, locked: room.locked, shapes: room.shapes, orientation: room.orientation }); return; }
      // Server-side chess.js is the tie-breaker: two racing clients can't diverge the
      // canonical FEN. Illegal moves are dropped silently — the sender's local board
      // will reconcile from the next authoritative state frame it receives.
      const c = new Chess(room.fen);
      let ok = false;
      try {
        const applied = c.move({ from: frame.move.from, to: frame.move.to, promotion: (frame.move.promotion as any) || "q" });
        ok = !!applied;
      } catch { ok = false; }
      if (!ok) { send({ type: "state", fen: room.fen, startFen: room.startFen, lastMove: room.lastMove, history: room.history, cursorIdx: room.cursorIdx, tree: room.tree, cursorPath: room.cursorPath, participants: room.clients.size, locked: room.locked, shapes: room.shapes, orientation: room.orientation }); return; }
      // Tree semantics: append the new move as a child of the node at
      // cursorPath. If a child with the same from/to/promotion already
      // exists, just move the cursor to it (don't duplicate). Playing a
      // new move at a rewound cursor now creates a VARIATION instead of
      // truncating the future (matches /openings + Lichess analysis).
      const newMove: Move = { from: frame.move.from, to: frame.move.to, promotion: frame.move.promotion };
      // Locate the parent children[] for the current cursor.
      let parentChildren = room.tree;
      for (const idx of room.cursorPath) parentChildren = parentChildren[idx]!.children;
      // Match promotion loosely: undefined ~ "q" (chess.js default).
      const norm = (p?: string) => (p || "q").toLowerCase();
      let existingIdx = parentChildren.findIndex((n) =>
        n.move.from === newMove.from && n.move.to === newMove.to && norm(n.move.promotion) === norm(newMove.promotion));
      if (existingIdx < 0) {
        parentChildren.push({ move: newMove, children: [] });
        existingIdx = parentChildren.length - 1;
      }
      room.cursorPath = [...room.cursorPath, existingIdx];
      recomputeFromTree(room);
      broadcast(room, { type: "move", move: room.lastMove!, fen: room.fen, startFen: room.startFen, history: room.history, cursorIdx: room.cursorIdx, tree: room.tree, cursorPath: room.cursorPath, participants: room.clients.size, locked: room.locked });
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

// Per-class in-memory kick registry — mirrors the `classKicks` Mongo
// collection so the ws upgrade path can gate joins without a DB round trip
// on every frame. Loaded lazily on first `hello` per room. Owner ask
// 2026-08-25 ("option to remove users from video class, by the coach, for
// that one particular video class session").
const roomKicks = new Map<string, Set<string>>();

async function loadKicksForRoom(id: string): Promise<Set<string>> {
  let s = roomKicks.get(id);
  if (s) return s;
  s = new Set();
  roomKicks.set(id, s);
  if (dbConn?.db) {
    try {
      const rows: any[] = await dbConn.db.collection("classKicks")
        .find({ classId: id }, { projection: { userId: 1 } })
        .toArray();
      for (const r of rows) if (r.userId) s.add(String(r.userId));
    } catch { /* silent — fail-open on lookup errors */ }
  }
  return s;
}

/** Called by the HTTP kick endpoint. Add the user id to this room's live
 *  kick set AND drop any of their open sockets so they see the "kicked"
 *  frame immediately instead of waiting for their tab to reconnect. */
export function kickFromClassRoom(id: string, userId: string): { dropped: number } {
  let s = roomKicks.get(id);
  if (!s) { s = new Set(); roomKicks.set(id, s); }
  s.add(userId);
  const room = rooms.get(id);
  if (!room) return { dropped: 0 };
  const frame = JSON.stringify({ type: "kicked", reason: "coach_removed" });
  let dropped = 0;
  for (const c of Array.from(room.clients)) {
    const who = socketWho.get(c);
    if (who?.userId === userId) {
      try { c.send(frame); } catch { /* ignore */ }
      try { c.close(1000, "kicked"); } catch { /* ignore */ }
      dropped++;
    }
  }
  return { dropped };
}

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
