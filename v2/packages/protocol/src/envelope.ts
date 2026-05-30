// Wire protocol — M0 subset (ADR-0008 D3: JSON now, versioned envelope, binary reserved).
// The `v` field lets us evolve without a break; a future codec can swap JSON for MessagePack.
export const PROTOCOL_VERSION = 1 as const;

// ── client → server ─────────────────────────────────────────────────────────
export interface HelloMsg  { v: 1; t: "hello";  d?: { token?: string } }
export interface SubMsg    { v: 1; t: "sub";    g: string }
export interface UnsubMsg  { v: 1; t: "unsub";  g: string }
export interface AppendMsg { v: 1; t: "append"; g: string; d: { text: string; seq: number } }
export interface ResyncMsg { v: 1; t: "resync"; g: string; d: { haveSeq: number } }
export interface PingMsg   { v: 1; t: "ping";   d: { ts: number } }
export type ClientMsg = HelloMsg | SubMsg | UnsubMsg | AppendMsg | ResyncMsg | PingMsg;

// ── server → client ─────────────────────────────────────────────────────────
export interface HelloOkMsg  { v: 1; t: "hello-ok"; d: { node: string; conn: string } }
export interface StateMsg    { v: 1; t: "state";    g: string; d: { log: string[]; seq: number; from: number } }
export interface AppendedMsg { v: 1; t: "appended"; g: string; d: { text: string; seq: number; by: string } }
export interface ErrorMsg    { v: 1; t: "error";    g?: string; d: { code: string; msg: string } }
export interface PongMsg     { v: 1; t: "pong";     d: { ts: number } }
export type ServerMsg = HelloOkMsg | StateMsg | AppendedMsg | ErrorMsg | PongMsg;

// ── internal: gateway → owning engine node (over game:in:{node}) ─────────────
// Carries a return address (gw + conn) so the engine can target replies, plus a
// hop counter so a mis-routed event is forwarded a bounded number of times.
export interface RoutedAddr { gw: string; conn: string; by: string; hop: number }
export interface InAppend extends RoutedAddr { kind: "append"; g: string; text: string; seq: number }
export interface InSub    extends RoutedAddr { kind: "sub" | "resync"; g: string; haveSeq: number }
export type EngineInbound = InAppend | InSub;

// ── internal: engine → gateway ───────────────────────────────────────────────
export interface ReplyOut     { conn: string; msg: ServerMsg } // ws:reply:{gw}  — targeted to one socket
export interface OutBroadcast { msg: ServerMsg }               // game:out:{g}   — fan-out to all subscribers
