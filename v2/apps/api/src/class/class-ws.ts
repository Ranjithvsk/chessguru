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
// nag = short glyph appended to SAN (!, ?, !!, ??, !?, ?!, ±, ∓, +-, -+, =, +=, =+, ∞).
// comment = coach's free-form text shown under the move. Both optional; empty/absent means none.
// shapes = arrows/circles the coach drew while THIS position was on the board.
// Per-node (not global) so navigating back to a taught position brings its
// markup back. Owner request 2026-09-02: "save that in the move until removed".
// Preserved across tree mutations (promote, delete, load-tree, etc.).
type TreeNode = { move: Move; nag?: string; comment?: string; shapes?: Shape[]; children: TreeNode[] };
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
  | { type: "annotate-move"; path: number[]; nag?: string | null; comment?: string | null }  // coach only — set/clear NAG glyph + text comment on the node at path (null clears)
  | { type: "load-tree"; startFen?: string; tree: TreeNode[]; cursorPath?: number[] }  // coach only — replace tree wholesale (Teach Opening: repertoire / corpus / etc.)
  | { type: "stepBack" }                    // coach only — cursor--, keeps history so students can step forward again
  | { type: "stepForward" }                 // coach only — cursor++
  | { type: "annot"; shapes: Shape[] }      // arrows/circles — anyone can annotate
  | { type: "pointer"; x: number; y: number } // coach only — live cursor over board (normalized 0..1)
  | { type: "pointer-off" }                   // coach only — cursor left the board
  | { type: "orientation"; orientation: Orientation } // coach only — flip board for everyone
  | { type: "ping" }
  // ── Challenge mode (2026-09-01, owner directive):
  // Coach freezes the class board and asks students to find good moves on
  // their OWN boards. Coach's board stays static. Students explore locally
  // and each move is recorded server-side. When time expires or the coach
  // hits Reveal, all boards snap back to the coach's board and the coach
  // sees every student's move sequence in SAN notation.
  | { type: "challenge:start"; positionFen: string; startFen?: string; prompt?: string; durationSec: number }  // coach only
  | { type: "challenge:move";  fromFen: string; move: Move; san: string; nextFen: string }                    // student only — one attempted move
  | { type: "challenge:snapshot"; movesSan: string[]; finalFen?: string; tree?: ChallengeTreeNode[] }         // student only — full current-line SAN + full variation tree; replaces movesSan+tree
  | { type: "challenge:end" };                                                                                 // coach only OR auto-fired by server timer
// Server → client frames. `role` sent once after hello resolves; everything else
// is broadcast to the room on state changes.
type ServerFrame =
  | { type: "role"; role: "coach" | "student"; coachToken?: string }
  | { type: "state"; fen: string; startFen: string; lastMove: Move | null; history: Move[]; cursorIdx: number; tree: TreeNode[]; cursorPath: number[]; participants: number; locked: boolean; shapes: Shape[]; startShapes: Shape[]; orientation: Orientation }
  | { type: "move"; move: Move; fen: string; startFen: string; history: Move[]; cursorIdx: number; tree: TreeNode[]; cursorPath: number[]; participants: number; locked: boolean }
  | { type: "reset"; fen: string; participants: number; locked: boolean }
  | { type: "lock"; locked: boolean; participants: number }
  | { type: "annot"; shapes: Shape[]; participants: number }
  | { type: "pointer"; x: number; y: number }  // coach's live cursor over the board (normalized 0..1)
  | { type: "pointer-off" }                    // coach's cursor left the board (students hide the dot)
  | { type: "orientation"; orientation: Orientation }
  | { type: "participants"; participants: number }
  | { type: "pong" }
  // ── Challenge mode broadcast frames.
  | { type: "challenge_start"; positionFen: string; startFen: string; prompt: string; durationSec: number; endsAt: number; startedAt: number }
  | { type: "challenge_progress"; answered: number; total: number; remainingSec: number }   // coach-only detail; students see just remaining
  | { type: "challenge_end"; positionFen: string; startedAt?: number; answers?: (ChallengeAnswer & { correct?: boolean | null })[] };            // answers only sent to coach

interface ChallengeTreeNode {
  from: string;
  to: string;
  promotion?: string;
  san: string;
  children: ChallengeTreeNode[];
}

interface ChallengeAnswer {
  userId: string;
  displayName: string;
  movesSan: string[];      // full sequence in the order the student tried (branches collapse to newest attempt)
  tree?: ChallengeTreeNode[];  // full variation tree from positionFen — used by coach's answers panel to render branches as PGN with (parens) instead of a flat line
  firstMoveAt?: number;    // ms — used for "time-to-first-move" analytics
  lastMoveAt?: number;
  finalFen?: string;       // fen after their last move
}

/** Sanitize an untrusted tree payload from the student. Enforces per-node
 *  shape (from/to squares, san ≤ 15 chars, single-char promotion), fanout
 *  cap (32/level), and a total-node budget so a rogue client can't blow up
 *  the room or Mongo. */
function sanitizeChallengeTree(input: any, budget: { count: number }): ChallengeTreeNode[] {
  if (!Array.isArray(input)) return [];
  const out: ChallengeTreeNode[] = [];
  for (const n of input) {
    if (budget.count <= 0) break;
    if (out.length >= 32) break;
    if (!n || typeof n !== "object") continue;
    const from = typeof n.from === "string" && /^[a-h][1-8]$/.test(n.from) ? n.from : null;
    const to   = typeof n.to   === "string" && /^[a-h][1-8]$/.test(n.to)   ? n.to   : null;
    const san  = typeof n.san  === "string" && n.san.length > 0 && n.san.length <= 15 ? n.san : null;
    if (!from || !to || !san) continue;
    const promotion = typeof n.promotion === "string" && n.promotion.length === 1 ? n.promotion : undefined;
    budget.count--;
    out.push({ from, to, promotion, san, children: sanitizeChallengeTree(n.children, budget) });
  }
  return out;
}

interface Challenge {
  positionFen: string;     // starting position, frozen for the duration
  startFen: string;        // preserved for notation numbering
  prompt: string;
  startedAt: number;
  endsAt: number;
  answers: Map<string, ChallengeAnswer>;   // userId → answer
  timer: ReturnType<typeof setTimeout> | null;
  progressTimer: ReturnType<typeof setInterval> | null;
}

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
  shapes: Shape[];              // shapes for the CURRENT cursor position (mirror of tree-node's own shapes; broadcast in state/annot)
  startShapes: Shape[];         // arrows/circles drawn at the starting position (cursorPath = []); tree nodes carry their own .shapes
  orientation: Orientation;     // board POV — coach can flip; students always mirror
  emptyEvictAt: number | null;  // when to drop this room from memory after last client left
  challenge: Challenge | null;  // active "find the good moves" session; null when idle
}

// Grace before an emptied room is evicted. Owner reported (2026-08-12) that
// when both coach + student briefly reconnect at the same moment, the room was
// being deleted between drops → fresh reconnects landed in a start-of-game
// board, wiping every move + shape. Keeping the room alive for a bit means
// transient network churn (or LiveKit-driven re-renders) doesn't erase state.
// Owner directive 2026-09-01: raised from 15 min → 4 hours so a coach
// with a long break between periods doesn't get evicted. State is also
// persisted to `classBoardState` now, so even beyond 4 hours the room
// re-materialises on next connect — this just avoids the DB round-trip
// for the common case.
const EMPTY_EVICT_MS = 4 * 60 * 60_000;

// Sweep rooms whose eviction timestamp has passed. Called on every close so
// idle rooms don't leak — no separate timer.
function sweepEvicted(): void {
  const now = Date.now();
  for (const [id, r] of rooms) {
    if (r.clients.size === 0 && r.emptyEvictAt != null && r.emptyEvictAt <= now) {
      // If the room had an active challenge, clear the timers so we don't
      // leak setTimeout handles + fire on a deleted room.
      if (r.challenge) {
        if (r.challenge.timer) clearTimeout(r.challenge.timer);
        if (r.challenge.progressTimer) clearInterval(r.challenge.progressTimer);
        r.challenge = null;
      }
      rooms.delete(id);
    }
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
          coachToken: null, coach: null, locked: true, shapes: [], startShapes: [], orientation: "white", emptyEvictAt: null,
          challenge: null };
    rooms.set(id, r);
    // Async restore from DB — a room evicted or a server restart shouldn't
    // wipe the coach's setup + moves. When the restore finishes, broadcast
    // a fresh `state` frame so any already-connected clients pick it up.
    // Non-fatal on error.
    void restoreRoomFromDb(id, r);
  }
  // A returning client cancels pending eviction — they see the SAME state they
  // left, not a fresh start.
  r.emptyEvictAt = null;
  return r;
}

// ═══════════════════════════════════════════════════════════════════════
// Room persistence (2026-09-01) — survives server restart + eviction.
//
// Owner report: "when coach tab inactive and coach position is lost, only
// new class is created". Root cause: room state (coach token + board tree
// + setup) was in-memory only. Server restarts (frequent during a day of
// deploys) wiped every room; 15-min idle eviction also wiped state.
//
// Design: on every mutation, debounce (1s) a save to a `classBoardState`
// collection. On first client into a fresh in-memory room, restore from
// that collection if present. Small enough that a single upsert is cheap.
// ═══════════════════════════════════════════════════════════════════════
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
function scheduleRoomSave(classId: string): void {
  if (!dbConn?.db) return;
  const existing = saveTimers.get(classId);
  if (existing) clearTimeout(existing);
  saveTimers.set(classId, setTimeout(() => {
    saveTimers.delete(classId);
    const room = rooms.get(classId);
    if (!room) return;
    const doc = {
      coachToken: room.coachToken,
      fen: room.fen,
      startFen: room.startFen,
      tree: room.tree,
      cursorPath: room.cursorPath,
      cursorIdx: room.cursorIdx,
      history: room.history,
      lastMove: room.lastMove,
      locked: room.locked,
      shapes: room.shapes,
      startShapes: room.startShapes,     // per-position shapes are also stored inside tree nodes; startShapes covers the pre-first-move root position
      orientation: room.orientation,
      updatedAt: new Date(),
    };
    void dbConn!.db!.collection("classBoardState")
      .updateOne({ _id: classId as any }, { $set: doc }, { upsert: true })
      .catch((e: any) => console.warn("[class-ws] classBoardState save failed:", e?.message));
  }, 1000));
}
async function restoreRoomFromDb(classId: string, room: Room): Promise<void> {
  if (!dbConn?.db) return;
  try {
    const doc: any = await dbConn.db.collection("classBoardState").findOne({ _id: classId as any });
    if (!doc) return;
    // Only restore if the in-memory room is still a pristine default —
    // avoid clobbering fresh writes from an eager coach who moved before
    // restore returned.
    if (rooms.get(classId) !== room) return;
    if (room.fen !== START_FEN || room.tree.length > 0) return;
    if (typeof doc.coachToken === "string") room.coachToken = doc.coachToken;
    if (typeof doc.fen === "string") room.fen = doc.fen;
    if (typeof doc.startFen === "string") room.startFen = doc.startFen;
    if (Array.isArray(doc.tree)) room.tree = doc.tree;
    if (Array.isArray(doc.cursorPath)) room.cursorPath = doc.cursorPath;
    if (Array.isArray(doc.history)) room.history = doc.history;
    if (typeof doc.cursorIdx === "number") room.cursorIdx = doc.cursorIdx;
    if (doc.lastMove && typeof doc.lastMove === "object") room.lastMove = doc.lastMove;
    if (typeof doc.locked === "boolean") room.locked = doc.locked;
    if (Array.isArray(doc.shapes)) room.shapes = doc.shapes;
    if (Array.isArray(doc.startShapes)) room.startShapes = doc.startShapes;
    if (doc.orientation === "white" || doc.orientation === "black") room.orientation = doc.orientation;
    // Make sure room.shapes reflects the RESTORED cursor position (tree
    // may have per-node shapes at a non-root cursor; without this the
    // initial state broadcast to newly-connected clients could carry stale
    // shapes from before the eviction).
    room.shapes = shapesAtCursor(room);
    // Broadcast the restored state to any clients that connected while the
    // restore was in flight (rare, but possible on a rapid page reload).
    if (room.clients.size > 0) {
      broadcast(room, { type: "state", fen: room.fen, startFen: room.startFen, lastMove: room.lastMove, history: room.history, cursorIdx: room.cursorIdx, tree: room.tree, cursorPath: room.cursorPath, participants: room.clients.size, locked: room.locked, shapes: room.shapes, startShapes: room.startShapes, orientation: room.orientation });
    }
  } catch (e: any) {
    console.warn("[class-ws] classBoardState restore failed:", e?.message);
  }
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

// State-mutating frame types — after broadcasting these we schedule a
// persistence save. Ephemeral frames (participants, pointer, pong, role,
// challenge_*) don't touch board state, no need to save.
const PERSIST_FRAME_TYPES = new Set(["state", "move", "reset", "lock", "annot", "orientation"]);
function broadcast(room: Room, frame: ServerFrame): void {
  const payload = JSON.stringify(frame);
  for (const c of room.clients) {
    if (c.readyState === WebSocket.OPEN) { try { c.send(payload); } catch { /* ignore */ } }
  }
  if (PERSIST_FRAME_TYPES.has((frame as any).type)) {
    // Find the classId that owns this room. Cheap linear scan; rooms Map
    // typically has ≤ dozens of entries in a live class window.
    for (const [id, r] of rooms) { if (r === room) { scheduleRoomSave(id); break; } }
  }
}

/** Get shapes for the position currently at cursorPath. Returns startShapes
 *  when cursor is at root; otherwise the tree-node's own shapes (empty when
 *  that node was never annotated). Owner directive 2026-09-02: shapes are
 *  saved PER POSITION so navigating back to a taught position brings its
 *  arrows/circles back. */
function shapesAtCursor(room: Room): Shape[] {
  if (room.cursorPath.length === 0) return room.startShapes;
  let cur = room.tree;
  let target: TreeNode | null = null;
  for (const idx of room.cursorPath) {
    const n = cur[idx];
    if (!n) return [];
    target = n;
    cur = n.children;
  }
  return target?.shapes ?? [];
}

/** Write shapes to the position currently at cursorPath. Root writes
 *  startShapes; deeper writes the tree-node's own shapes. Empty arrays are
 *  stored as absent (delete field) to keep persisted docs small. */
function setShapesAtCursor(room: Room, shapes: Shape[]): void {
  if (room.cursorPath.length === 0) {
    room.startShapes = shapes;
    return;
  }
  let cur = room.tree;
  let target: TreeNode | null = null;
  for (const idx of room.cursorPath) {
    const n = cur[idx];
    if (!n) return;
    target = n;
    cur = n.children;
  }
  if (!target) return;
  if (shapes.length === 0) delete target.shapes;
  else target.shapes = shapes;
}

/** Re-sync room.shapes to the current cursor position + broadcast annot so
 *  every client's board shows THAT position's arrows/circles. Called after
 *  any position/cursor change. If the new position was never annotated,
 *  clients see an empty markup layer (equivalent to the old
 *  clearShapesAndBroadcast behaviour). */
function syncShapesToPosition(room: Room): void {
  const next = shapesAtCursor(room);
  // Only broadcast if the visible shape set actually changes — avoids
  // needless annot frames on every no-op navigation.
  const prev = room.shapes;
  const same = prev.length === next.length && prev.every((s, i) => {
    const q = next[i]!;
    return s.orig === q.orig && s.dest === q.dest && s.brush === q.brush;
  });
  room.shapes = next;
  if (same) return;
  broadcast(room, { type: "annot", shapes: room.shapes, participants: room.clients.size });
}

function studentCount(room: Room): number {
  let n = 0;
  for (const c of room.clients) if (socketRole.get(c) === "student") n++;
  return n;
}

/** End the active challenge (auto-fired by timer OR by coach). Broadcasts
 *  `challenge_end` to everyone, sends the collected answers to the coach
 *  only, persists to `classChallenges`, and clears room.challenge. Safe to
 *  call twice — second call is a no-op. */
function endChallenge(room: Room, classId: string): void {
  const ch = room.challenge;
  if (!ch) return;
  if (ch.timer)         { clearTimeout(ch.timer); }
  if (ch.progressTimer) { clearInterval(ch.progressTimer); }
  room.challenge = null;
  const answers = [...ch.answers.values()];
  // Everyone: board is un-frozen. Students snap back to coach's live board.
  broadcast(room, { type: "challenge_end", positionFen: ch.positionFen, startedAt: ch.startedAt });
  // Coach: sees every answer with the SAN sequence.
  if (room.coach && room.coach.readyState === WebSocket.OPEN) {
    try { room.coach.send(JSON.stringify({ type: "challenge_end", positionFen: ch.positionFen, startedAt: ch.startedAt, answers })); } catch { /* */ }
  }
  // Persist so coaches can review after class + students can see their own
  // attempt in /history later. Fire-and-forget.
  if (dbConn?.db && answers.length > 0) {
    void dbConn.db.collection("classChallenges").insertOne({
      classId,
      positionFen: ch.positionFen,
      startFen: ch.startFen,
      prompt: ch.prompt,
      startedAt: new Date(ch.startedAt),
      endedAt: new Date(),
      answers: answers.map((a) => ({
        userId: a.userId,
        displayName: a.displayName,
        movesSan: a.movesSan,
        tree: a.tree,
        firstMoveAt: a.firstMoveAt ? new Date(a.firstMoveAt) : undefined,
        lastMoveAt: a.lastMoveAt ? new Date(a.lastMoveAt) : undefined,
        finalFen: a.finalFen,
      })),
    }).catch((e: any) => console.warn("[class-ws] classChallenges insert failed:", e?.message));
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
  send({ type: "state", fen: room.fen, startFen: room.startFen, lastMove: room.lastMove, history: room.history, cursorIdx: room.cursorIdx, tree: room.tree, cursorPath: room.cursorPath, participants: room.clients.size, locked: room.locked, shapes: room.shapes, startShapes: room.startShapes, orientation: room.orientation });
  // Late joiner mid-challenge — inform them so their board switches to
  // challenge mode with the correct remaining time. Uses the ORIGINAL
  // durationSec so the client can display "60s challenge, 42s remaining"
  // consistently with the coach's countdown.
  if (room.challenge) {
    const remaining = Math.max(0, Math.ceil((room.challenge.endsAt - Date.now()) / 1000));
    const originalDuration = Math.ceil((room.challenge.endsAt - room.challenge.startedAt) / 1000);
    send({ type: "challenge_start",
      positionFen: room.challenge.positionFen,
      startFen: room.challenge.startFen,
      prompt: room.challenge.prompt,
      durationSec: originalDuration,
      endsAt: room.challenge.endsAt,
      startedAt: room.challenge.startedAt,
    });
    // (client sees `endsAt` and computes remaining locally — keeps clocks in sync)
    void remaining;
  }
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
      // Stale-socket detection: if room.coach still points at a socket whose
      // readyState isn't OPEN, treat it as gone. Owner report 2026-09-03:
      // 'when coach abandoned the Dream Meet class and re-login, coach is
      // shown Join class but cant join'. Half-open TCP connections (network
      // drop, no FIN) can keep room.coach pointing at a dead socket for
      // MINUTES before the OS-level timeout fires, during which time the
      // coach's re-login hits the `else` branch and gets student role.
      if (room.coach && room.coach.readyState !== WebSocket.OPEN) {
        try { room.coach.close(1000, "stale_coach_socket"); } catch { /* */ }
        room.coach = null;
      }
      let resolvedSynchronously = false;
      if (frame.coachToken && room.coachToken && frame.coachToken === room.coachToken) {
        socketRole.set(ws, "coach"); room.coach = ws;
        send({ type: "role", role: "coach", coachToken: room.coachToken });
        resolvedSynchronously = true;
      } else if (!room.coachToken) {
        room.coachToken = mintCoachToken();
        socketRole.set(ws, "coach"); room.coach = ws;
        send({ type: "role", role: "coach", coachToken: room.coachToken });
        scheduleRoomSave(roomId);   // persist mint so it survives restart
        resolvedSynchronously = true;
      } else if (frame.intendedRole === "coach" && !room.coach) {
        room.coachToken = mintCoachToken();
        socketRole.set(ws, "coach"); room.coach = ws;
        send({ type: "role", role: "coach", coachToken: room.coachToken });
        scheduleRoomSave(roomId);
        resolvedSynchronously = true;
      } else {
        socketRole.set(ws, "student");
        send({ type: "role", role: "student" });
      }
      // Diagnostic log so future 'coach cant rejoin' reports have a trace.
      try {
        console.log("[class-ws.hello]", roomId, {
          intendedRole: frame.intendedRole,
          hasFrameToken: !!frame.coachToken,
          hasRoomToken: !!room.coachToken,
          tokenMatch: frame.coachToken && room.coachToken && frame.coachToken === room.coachToken,
          roomCoach: !!room.coach,
          resolvedRole: socketRole.get(ws),
          userId: typeof frame.userId === "string" ? frame.userId.slice(0, 40) : null,
        });
      } catch { /* silent */ }
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
              const [klass, announce, user] = await Promise.all([
                dbConn!.db!.collection("classSchedules").findOne({ _id: roomId as any }, { projection: { createdByUserId: 1, academyId: 1 } }),
                dbConn!.db!.collection("classLiveAnnouncements").findOne({ _id: roomId as any }, { projection: { coachUserId: 1, academyId: 1 } }),
                dbConn!.db!.collection("users").findOne({ _id: uidForCoach as any }, { projection: { role: 1, academyId: 1 } }),
              ]);
              const creator: string | null = (klass as any)?.createdByUserId ?? (announce as any)?.coachUserId ?? null;
              const classAcademy: string | null = (klass as any)?.academyId ?? (announce as any)?.academyId ?? null;
              const uRole: string = String((user as any)?.role || "");
              const uAcademy: string | null = (user as any)?.academyId ?? null;
              // Promote if: creator match OR academy_owner of the class's
              // academy OR a coach of the class's academy. Owner report
              // 2026-09-03: 'coach cant rejoin' — the original check was
              // creator-exact only, so an academy_owner picking up an
              // abandoned session for a coach who left couldn't reclaim.
              const isOriginalCoach = creator && creator === uidForCoach;
              const isAcademyElder = uAcademy && classAcademy && uAcademy === classAcademy && (uRole === "academy_owner" || uRole === "coach");
              if (isOriginalCoach || isAcademyElder) {
                if (room.coach && room.coach !== ws) {
                  try { room.coach.close(1000, "coach_takeover"); } catch { /* */ }
                }
                room.coachToken = mintCoachToken();
                socketRole.set(ws, "coach");
                room.coach = ws;
                send({ type: "role", role: "coach", coachToken: room.coachToken });
                scheduleRoomSave(roomId);
                try { console.log("[class-ws.hello] async coach promote", roomId, { uidForCoach: uidForCoach.slice(0, 40), reason: isOriginalCoach ? "creator" : "academy_elder" }); } catch { /* */ }
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
      room.fen = START_FEN; room.startFen = START_FEN; room.tree = []; room.cursorPath = []; room.lastMove = null; room.history = []; room.cursorIdx = 0; room.startShapes = [];
      broadcast(room, { type: "reset", fen: room.fen, participants: room.clients.size, locked: room.locked });
      // Also emit a full state so tree-aware clients drop their cached tree.
      broadcast(room, { type: "state", fen: room.fen, startFen: room.startFen, lastMove: room.lastMove, history: room.history, cursorIdx: room.cursorIdx, tree: room.tree, cursorPath: room.cursorPath, participants: room.clients.size, locked: room.locked, shapes: room.shapes, startShapes: room.startShapes, orientation: room.orientation });
      syncShapesToPosition(room);
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
      broadcast(room, { type: "state", fen: room.fen, startFen: room.startFen, lastMove: room.lastMove, history: room.history, cursorIdx: room.cursorIdx, tree: room.tree, cursorPath: room.cursorPath, participants: room.clients.size, locked: room.locked, shapes: room.shapes, startShapes: room.startShapes, orientation: room.orientation });
      syncShapesToPosition(room);
      return;
    }

    if (frame.type === "load-tree") {
      // Coach-only wholesale replace — used by Teach Opening (loading a
      // repertoire entry or a corpus opening into the class board). We
      // structurally clone the incoming tree so a rogue client can't hand
      // us shared references that mutate on the room later.
      if (!isCoach()) return;
      const rawTree = (frame as any).tree;
      if (!Array.isArray(rawTree)) return;
      // Sanitize + budget-cap the tree (600 nodes across all branches so a
      // typo of an entry's tree can't blow up state or bandwidth).
      let budget = 600;
      const clone = (nodes: any[]): TreeNode[] => {
        const out: TreeNode[] = [];
        for (const n of nodes) {
          if (budget <= 0) break;
          if (!n || typeof n !== "object") continue;
          const mv = n.move;
          if (!mv || typeof mv.from !== "string" || typeof mv.to !== "string") continue;
          if (!/^[a-h][1-8]$/.test(mv.from) || !/^[a-h][1-8]$/.test(mv.to)) continue;
          const promo = mv.promotion;
          const move: Move = {
            from: mv.from, to: mv.to,
            promotion: (typeof promo === "string" && /^[qrbn]$/i.test(promo)) ? promo.toLowerCase() : undefined,
          };
          budget--;
          const kids = Array.isArray(n.children) ? clone(n.children) : [];
          const node: TreeNode = { move, children: kids };
          // Preserve annotation fields on incoming trees (repertoire / corpus
          // packs may already carry glyphs + comments).
          if (typeof n.nag === "string" && n.nag) node.nag = n.nag.slice(0, 4);
          if (typeof n.comment === "string" && n.comment) node.comment = n.comment.slice(0, 500);
          // Preserve per-position shapes from repertoire packs (validated same
          // as annot-frame shapes: orig/dest square strings, brush string).
          if (Array.isArray(n.shapes)) {
            const cleaned: Shape[] = [];
            for (const s of n.shapes) {
              if (cleaned.length >= 64) break;
              if (!s || typeof s.orig !== "string" || !/^[a-h][1-8]$/.test(s.orig)) continue;
              if (s.dest != null && !/^[a-h][1-8]$/.test(String(s.dest))) continue;
              cleaned.push({ orig: s.orig, dest: s.dest, brush: typeof s.brush === "string" ? s.brush : undefined });
            }
            if (cleaned.length > 0) node.shapes = cleaned;
          }
          out.push(node);
        }
        return out;
      };
      const cleanTree = clone(rawTree);
      // Validate startFen — if provided, must parse; else keep current room.startFen.
      let cleanStartFen = room.startFen;
      const rawStart = (frame as any).startFen;
      if (typeof rawStart === "string" && rawStart.length > 0) {
        try { cleanStartFen = new Chess(rawStart).fen(); } catch { return; }
      }
      // Validate cursorPath — clamp to what the tree can navigate.
      const rawCursor = (frame as any).cursorPath;
      const cleanCursorPath: number[] = [];
      if (Array.isArray(rawCursor)) {
        let cur = cleanTree;
        for (const raw of rawCursor) {
          const idx = Math.trunc(Number(raw));
          if (!Number.isFinite(idx) || idx < 0 || idx >= cur.length) break;
          cleanCursorPath.push(idx);
          cur = cur[idx]!.children;
        }
      }
      room.startFen = cleanStartFen;
      room.tree = cleanTree;
      room.cursorPath = cleanCursorPath;
      room.startShapes = [];   // stale start-position arrows meaningless in a fresh tree
      recomputeFromTree(room);
      broadcast(room, { type: "state", fen: room.fen, startFen: room.startFen, lastMove: room.lastMove, history: room.history, cursorIdx: room.cursorIdx, tree: room.tree, cursorPath: room.cursorPath, participants: room.clients.size, locked: room.locked, shapes: room.shapes, startShapes: room.startShapes, orientation: room.orientation });
      syncShapesToPosition(room);
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
      broadcast(room, { type: "state", fen: room.fen, startFen: room.startFen, lastMove: room.lastMove, history: room.history, cursorIdx: room.cursorIdx, tree: room.tree, cursorPath: room.cursorPath, participants: room.clients.size, locked: room.locked, shapes: room.shapes, startShapes: room.startShapes, orientation: room.orientation });
      syncShapesToPosition(room);
      return;
    }

    if (frame.type === "annotate-move") {
      // Coach-only: set (or clear) the NAG glyph + text comment on the node
      // at `path`. Non-destructive — no cursor/board change; just tree
      // metadata. Broadcast the new state so every viewer's notation panel
      // repaints.
      if (!isCoach()) return;
      const p = (frame as any).path;
      if (!Array.isArray(p) || p.length === 0) return;
      // Walk to the target node, validating each index.
      let cur = room.tree;
      let target: TreeNode | null = null;
      for (let i = 0; i < p.length; i++) {
        const idx = Math.trunc(Number(p[i]));
        if (!Number.isFinite(idx) || idx < 0 || idx >= cur.length) return;
        if (i === p.length - 1) target = cur[idx]!;
        else cur = cur[idx]!.children;
      }
      if (!target) return;
      // nag/comment: `null` (or empty string) clears the field; a non-empty
      // string sets it. Trim + cap to prevent abuse.
      const rawNag = (frame as any).nag;
      if (rawNag === null || rawNag === "") { delete target.nag; }
      else if (typeof rawNag === "string") { target.nag = rawNag.slice(0, 4); }
      const rawComment = (frame as any).comment;
      if (rawComment === null || rawComment === "") { delete target.comment; }
      else if (typeof rawComment === "string") { target.comment = rawComment.slice(0, 500); }
      broadcast(room, { type: "state", fen: room.fen, startFen: room.startFen, lastMove: room.lastMove, history: room.history, cursorIdx: room.cursorIdx, tree: room.tree, cursorPath: room.cursorPath, participants: room.clients.size, locked: room.locked, shapes: room.shapes, startShapes: room.startShapes, orientation: room.orientation });
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
      broadcast(room, { type: "state", fen: room.fen, startFen: room.startFen, lastMove: room.lastMove, history: room.history, cursorIdx: room.cursorIdx, tree: room.tree, cursorPath: room.cursorPath, participants: room.clients.size, locked: room.locked, shapes: room.shapes, startShapes: room.startShapes, orientation: room.orientation });
      syncShapesToPosition(room);
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
      room.startShapes = [];    // stale arrows/circles from the previous position are meaningless
      broadcast(room, { type: "state", fen: room.fen, startFen: room.startFen, lastMove: room.lastMove, history: room.history, cursorIdx: room.cursorIdx, tree: room.tree, cursorPath: room.cursorPath, participants: room.clients.size, locked: room.locked, shapes: room.shapes, startShapes: room.startShapes, orientation: room.orientation });
      syncShapesToPosition(room);
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
      broadcast(room, { type: "state", fen: room.fen, startFen: room.startFen, lastMove: room.lastMove, history: room.history, cursorIdx: room.cursorIdx, tree: room.tree, cursorPath: room.cursorPath, participants: room.clients.size, locked: room.locked, shapes: room.shapes, startShapes: room.startShapes, orientation: room.orientation });
      syncShapesToPosition(room);
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

    // ── Challenge mode handlers ──────────────────────────────────────────
    if (frame.type === "challenge:start") {
      if (!isCoach()) return;
      if (room.challenge) endChallenge(room, roomId);   // idempotent: one active challenge at a time
      const durationSec = Math.max(15, Math.min(15 * 60, Number(frame.durationSec) || 60));
      const positionFen = typeof frame.positionFen === "string" ? frame.positionFen : room.fen;
      const startFen = typeof frame.startFen === "string" ? frame.startFen : room.startFen;
      const prompt = typeof frame.prompt === "string" ? frame.prompt.slice(0, 200) : "";
      const now = Date.now();
      const endsAt = now + durationSec * 1000;
      const ch: Challenge = {
        positionFen, startFen, prompt, startedAt: now, endsAt,
        answers: new Map(),
        timer: setTimeout(() => endChallenge(room, roomId), durationSec * 1000),
        // Progress ticker (every 5s) — sends coach an updated "answered/total"
        // count. Cheap enough to run for every active challenge in memory.
        progressTimer: setInterval(() => {
          if (!room.challenge) return;
          const remainingSec = Math.max(0, Math.round((room.challenge.endsAt - Date.now()) / 1000));
          const total = studentCount(room);
          const answered = room.challenge.answers.size;
          if (room.coach && room.coach.readyState === WebSocket.OPEN) {
            try { room.coach.send(JSON.stringify({ type: "challenge_progress", answered, total, remainingSec })); } catch { /* */ }
          }
        }, 5_000),
      };
      room.challenge = ch;
      broadcast(room, { type: "challenge_start", positionFen, startFen, prompt, durationSec, endsAt, startedAt: now });
      return;
    }

    if (frame.type === "challenge:move") {
      if (!room.challenge) return;
      if (isCoach()) return;   // coach doesn't submit answers
      const who = socketWho.get(ws);
      if (!who || !who.userId) return;   // guests / unauthed can't be attributed
      const san = typeof frame.san === "string" ? frame.san.slice(0, 15) : "";
      if (!san) return;
      let ans = room.challenge.answers.get(who.userId);
      const now = Date.now();
      if (!ans) {
        ans = { userId: who.userId, displayName: who.name, movesSan: [], firstMoveAt: now };
        room.challenge.answers.set(who.userId, ans);
      }
      ans.lastMoveAt = now;
      if (typeof frame.nextFen === "string") ans.finalFen = frame.nextFen;
      // Note: don't push to movesSan here anymore — clients that also
      // emit `challenge:snapshot` are the ones building the tree, and
      // snapshot is authoritative for the final answer. Legacy clients
      // without snapshot support fall through to the old push path.
      // Detected by: if this is the very first move (no snapshot yet
      // came in), append. If movesSan is already populated by a
      // snapshot, leave it alone.
      if (ans.movesSan.length === 0) {
        ans.movesSan.push(san);
      }
      return;
    }

    // Full-line snapshot from the student's scratchpad tree. Replaces
    // movesSan entirely so the coach always sees the LATEST chosen line
    // (even after undo, branching, re-seeking). Owner directive
    // 2026-09-02.
    if (frame.type === "challenge:snapshot") {
      if (!room.challenge) return;
      if (isCoach()) return;
      const who = socketWho.get(ws);
      if (!who || !who.userId) return;
      const raw = Array.isArray(frame.movesSan) ? frame.movesSan : [];
      const cleaned = raw.filter((s: any) => typeof s === "string" && s.length > 0 && s.length <= 15).slice(0, 60);
      const tree = frame.tree ? sanitizeChallengeTree(frame.tree, { count: 200 }) : undefined;
      let ans = room.challenge.answers.get(who.userId);
      const now = Date.now();
      if (!ans) {
        ans = { userId: who.userId, displayName: who.name, movesSan: cleaned, tree, firstMoveAt: now };
        room.challenge.answers.set(who.userId, ans);
      } else {
        ans.movesSan = cleaned;
        if (tree !== undefined) ans.tree = tree;
      }
      ans.lastMoveAt = now;
      if (typeof frame.finalFen === "string") ans.finalFen = frame.finalFen;
      return;
    }

    if (frame.type === "challenge:end") {
      if (!isCoach()) return;
      endChallenge(room, roomId);
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
      // Persist to the CURRENT cursor position (startShapes if at root, or
      // the tree node otherwise). Room-level room.shapes mirrors it for
      // state broadcasts + save. Owner directive 2026-09-02: shapes are
      // tied to the position — navigating back brings them back.
      setShapesAtCursor(room, cleaned);
      room.shapes = cleaned;
      broadcast(room, { type: "annot", shapes: room.shapes, participants: room.clients.size });
      return;
    }

    if (frame.type === "move" && frame.move && typeof frame.move.from === "string" && typeof frame.move.to === "string") {
      // Student-lock check: student moves are dropped when the coach has toggled the
      // lock. The sender still gets a state snapshot to reconcile any optimistic UI.
      if (room.locked && !isCoach()) { send({ type: "state", fen: room.fen, startFen: room.startFen, lastMove: room.lastMove, history: room.history, cursorIdx: room.cursorIdx, tree: room.tree, cursorPath: room.cursorPath, participants: room.clients.size, locked: room.locked, shapes: room.shapes, startShapes: room.startShapes, orientation: room.orientation }); return; }
      // Server-side chess.js is the tie-breaker: two racing clients can't diverge the
      // canonical FEN. Illegal moves are dropped silently — the sender's local board
      // will reconcile from the next authoritative state frame it receives.
      const c = new Chess(room.fen);
      let ok = false;
      try {
        const applied = c.move({ from: frame.move.from, to: frame.move.to, promotion: (frame.move.promotion as any) || "q" });
        ok = !!applied;
      } catch { ok = false; }
      if (!ok) { send({ type: "state", fen: room.fen, startFen: room.startFen, lastMove: room.lastMove, history: room.history, cursorIdx: room.cursorIdx, tree: room.tree, cursorPath: room.cursorPath, participants: room.clients.size, locked: room.locked, shapes: room.shapes, startShapes: room.startShapes, orientation: room.orientation }); return; }
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
      syncShapesToPosition(room);
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

/** Push an arbitrary frame to every OPEN socket in the class room owned
 *  by `userId`. Used by REST endpoints that need to notify a specific
 *  student in-class — e.g. "coach marked your challenge answer".
 *  Returns the count of sockets that received the push (0 if the user
 *  isn't currently connected). Silent no-op on unknown room. */
export function pushToClassClient(id: string, userId: string, frame: unknown): { sent: number } {
  const room = rooms.get(id);
  if (!room) return { sent: 0 };
  const payload = JSON.stringify(frame);
  let sent = 0;
  for (const c of room.clients) {
    if (c.readyState !== WebSocket.OPEN) continue;
    const who = socketWho.get(c);
    if (who?.userId !== userId) continue;
    try { c.send(payload); sent++; } catch { /* ignore */ }
  }
  return { sent };
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
