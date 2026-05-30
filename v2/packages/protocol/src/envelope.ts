// Wire protocol — M1 (chess). Versioned JSON envelope (ADR-0008 D3); the `v`
// field + codec seam keep a binary/variant evolution non-breaking.
export const PROTOCOL_VERSION = 1 as const;

export type Color = "white" | "black";
export type Seat = Color | "spectator";
export type GameStatus =
  | "playing"
  | "checkmate"
  | "stalemate"
  | "insufficient"
  | "fiftymove"
  | "threefold"
  | "draw"
  | "resign";

export interface Players {
  white: string | null;
  black: string | null;
}

// ── client → server ─────────────────────────────────────────────────────────
export interface HelloMsg  { v: 1; t: "hello";  d?: { token?: string } }
export interface SubMsg    { v: 1; t: "sub";    g: string }              // spectate
export interface UnsubMsg  { v: 1; t: "unsub";  g: string }
export interface JoinMsg   { v: 1; t: "join";   g: string }              // take a seat
export interface MoveMsg   { v: 1; t: "move";   g: string; d: { uci: string; ply: number } }
export interface ResignMsg { v: 1; t: "resign"; g: string }
export interface ResyncMsg { v: 1; t: "resync"; g: string; d: { havePly: number } }
export interface PingMsg   { v: 1; t: "ping";   d: { ts: number } }
export type ClientMsg = HelloMsg | SubMsg | UnsubMsg | JoinMsg | MoveMsg | ResignMsg | ResyncMsg | PingMsg;

// ── server → client ─────────────────────────────────────────────────────────
export interface HelloOkMsg  { v: 1; t: "hello-ok"; d: { node: string; conn: string } }
export interface JoinedMsg   { v: 1; t: "joined";   g: string; d: { seat: Seat; userId: string } }
export interface GameStateMsg {
  v: 1;
  t: "game-state";
  g: string;
  d: { fen: string; moves: string[]; turn: Color; ply: number; status: GameStatus; result: string | null; players: Players };
}
export interface MovedMsg   { v: 1; t: "moved";    g: string; d: { uci: string; san: string; ply: number; fen: string; turn: Color; by: string } }
export interface GameEndMsg { v: 1; t: "game-end"; g: string; d: { result: string; reason: GameStatus; fen: string } }
export interface ErrorMsg   { v: 1; t: "error";    g?: string; d: { code: string; msg: string } }
export interface PongMsg    { v: 1; t: "pong";     d: { ts: number } }
export type ServerMsg = HelloOkMsg | JoinedMsg | GameStateMsg | MovedMsg | GameEndMsg | ErrorMsg | PongMsg;

// ── internal: gateway → owning engine node (over game:in:{node}) ─────────────
export interface RoutedAddr { gw: string; conn: string; by: string; hop: number; g: string }
export interface InSub    extends RoutedAddr { kind: "sub" }
export interface InResync extends RoutedAddr { kind: "resync"; havePly: number }
export interface InJoin   extends RoutedAddr { kind: "join" }
export interface InMove   extends RoutedAddr { kind: "move"; uci: string; ply: number }
export interface InResign extends RoutedAddr { kind: "resign" }
export type EngineInbound = InSub | InResync | InJoin | InMove | InResign;

// ── internal: engine → gateway ───────────────────────────────────────────────
export interface ReplyOut     { conn: string; msg: ServerMsg } // ws:reply:{gw}  — targeted to one socket
export interface OutBroadcast { msg: ServerMsg }               // game:out:{g}   — fan-out to all subscribers
