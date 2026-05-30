// Wire protocol — M4 (chess + clocks + flow + rating + lobby). Versioned JSON
// envelope (ADR-0008 D3); `v` + codec seam keep evolution non-breaking.
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
  | "agreement"
  | "resign"
  | "flag";

export interface Players {
  white: string | null;
  black: string | null;
}
export interface TimeControl {
  initial: number;
  increment: number;
}
export interface Clock {
  white: number;
  black: number;
}
export interface RatingDiff {
  white: number;
  black: number;
}

// ── client → server ─────────────────────────────────────────────────────────
export interface HelloMsg       { v: 1; t: "hello";  d?: { token?: string } }
export interface SubMsg         { v: 1; t: "sub";    g: string }
export interface UnsubMsg       { v: 1; t: "unsub";  g: string }
export interface CreateMsg      { v: 1; t: "create"; g: string; d: { clock: TimeControl; initialFen?: string; rated?: boolean } }
export interface JoinMsg        { v: 1; t: "join";   g: string }
export interface MoveMsg        { v: 1; t: "move";   g: string; d: { uci: string; ply: number; lag?: number } }
export interface ResignMsg      { v: 1; t: "resign"; g: string }
export interface PremoveMsg     { v: 1; t: "premove"; g: string; d: { uci: string } }
export interface DrawOfferMsg   { v: 1; t: "draw-offer";   g: string }
export interface DrawAcceptMsg  { v: 1; t: "draw-accept";  g: string }
export interface DrawDeclineMsg { v: 1; t: "draw-decline"; g: string }
export interface RematchMsg     { v: 1; t: "rematch"; g: string }
export interface ResyncMsg      { v: 1; t: "resync"; g: string; d: { havePly: number } }
export interface PingMsg        { v: 1; t: "ping";   d: { ts: number } }
// lobby
export interface SeekMsg            { v: 1; t: "seek";   d: { clock: TimeControl; rated?: boolean; ratingRange?: number } }
export interface UnseekMsg          { v: 1; t: "unseek" }
export interface ChallengeMsg       { v: 1; t: "challenge"; d: { clock: TimeControl; rated?: boolean } }
export interface ChallengeAcceptMsg { v: 1; t: "challenge-accept"; d: { id: string } }
export type ClientMsg =
  | HelloMsg | SubMsg | UnsubMsg | CreateMsg | JoinMsg | MoveMsg | ResignMsg | PremoveMsg
  | DrawOfferMsg | DrawAcceptMsg | DrawDeclineMsg | RematchMsg | ResyncMsg | PingMsg
  | SeekMsg | UnseekMsg | ChallengeMsg | ChallengeAcceptMsg;

// ── server → client ─────────────────────────────────────────────────────────
export interface HelloOkMsg  { v: 1; t: "hello-ok"; d: { node: string; conn: string } }
export interface JoinedMsg   { v: 1; t: "joined";   g: string; d: { seat: Seat; userId: string } }
export interface GameStateMsg {
  v: 1;
  t: "game-state";
  g: string;
  d: {
    fen: string;
    moves: string[];
    turn: Color;
    ply: number;
    status: GameStatus;
    result: string | null;
    players: Players;
    clock: Clock;
    timeControl: TimeControl;
    rated: boolean;
  };
}
export interface MovedMsg        { v: 1; t: "moved";    g: string; d: { uci: string; san: string; ply: number; fen: string; turn: Color; by: string; clock: Clock } }
export interface ClockMsg        { v: 1; t: "clock";    g: string; d: { clock: Clock; turn: Color; running: boolean } }
export interface OfferMsg        { v: 1; t: "offer";    g: string; d: { kind: "draw"; by: Color } }
export interface GameEndMsg      { v: 1; t: "game-end"; g: string; d: { result: string; reason: GameStatus; fen: string; clock: Clock; ratingDiff?: RatingDiff } }
export interface RematchReadyMsg { v: 1; t: "rematch-ready"; g: string; d: { game: string; white: string | null; black: string | null } }
export interface ErrorMsg        { v: 1; t: "error";    g?: string; d: { code: string; msg: string } }
export interface PongMsg         { v: 1; t: "pong";     d: { ts: number } }
// lobby
export interface SeekAckMsg          { v: 1; t: "seek-ack";          d: { seekId: string } }
export interface MatchedMsg          { v: 1; t: "matched";           d: { game: string; color: Color; opponent: string; clock: TimeControl; rated: boolean } }
export interface ChallengeCreatedMsg { v: 1; t: "challenge-created"; d: { id: string } }
export type ServerMsg =
  | HelloOkMsg | JoinedMsg | GameStateMsg | MovedMsg | ClockMsg | OfferMsg
  | GameEndMsg | RematchReadyMsg | ErrorMsg | PongMsg
  | SeekAckMsg | MatchedMsg | ChallengeCreatedMsg;

// ── internal: gateway/lobby → owning engine node (over game:in:{node}) ───────
export interface RoutedAddr { gw: string; conn: string; by: string; hop: number; g: string }
export interface InSub         extends RoutedAddr { kind: "sub" }
export interface InResync      extends RoutedAddr { kind: "resync"; havePly: number }
export interface InCreate      extends RoutedAddr { kind: "create"; clock: TimeControl; initialFen?: string; rated: boolean }
export interface InSetup       extends RoutedAddr { kind: "setup"; white: string; black: string; clock: TimeControl; rated: boolean }
export interface InJoin        extends RoutedAddr { kind: "join" }
export interface InMove        extends RoutedAddr { kind: "move"; uci: string; ply: number; lag: number }
export interface InResign      extends RoutedAddr { kind: "resign" }
export interface InPremove     extends RoutedAddr { kind: "premove"; uci: string }
export interface InDrawOffer   extends RoutedAddr { kind: "draw-offer" }
export interface InDrawAccept  extends RoutedAddr { kind: "draw-accept" }
export interface InDrawDecline extends RoutedAddr { kind: "draw-decline" }
export interface InRematch     extends RoutedAddr { kind: "rematch" }
export type EngineInbound =
  | InSub | InResync | InCreate | InSetup | InJoin | InMove | InResign | InPremove
  | InDrawOffer | InDrawAccept | InDrawDecline | InRematch;

// ── internal: gateway → lobby (over lobby:in) ────────────────────────────────
export interface LobbyAddr { gw: string; conn: string; by: string }
export interface LobbySeek      extends LobbyAddr { kind: "seek"; clock: TimeControl; rated: boolean; ratingRange?: number }
export interface LobbyUnseek    extends LobbyAddr { kind: "unseek" }
export interface LobbyChallenge extends LobbyAddr { kind: "challenge"; clock: TimeControl; rated: boolean }
export interface LobbyAccept    extends LobbyAddr { kind: "challenge-accept"; id: string }
export type LobbyInbound = LobbySeek | LobbyUnseek | LobbyChallenge | LobbyAccept;

// ── internal: engine → gateway ───────────────────────────────────────────────
export interface ReplyOut     { conn: string; msg: ServerMsg } // ws:reply:{gw}  — targeted to one socket
export interface OutBroadcast { msg: ServerMsg }               // game:out:{g}   — fan-out to all subscribers
