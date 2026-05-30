import { randomUUID } from "node:crypto";
import type Redis from "ioredis";
import {
  ch,
  decode,
  encode,
  keys,
  NODE_TTL_MS,
  pickOwner,
  type ClientMsg,
  type EngineInbound,
  type OutBroadcast,
  type ReplyOut,
  type ServerMsg,
} from "@chessguru/protocol";
import type { Socket, SocketServer } from "./socket-server";

interface Conn {
  socket: Socket;
  userId: string;
  subs: Set<string>;
}

/** Stateless relay: holds sockets, routes client events to the owning engine
 *  node, fans engine output back out. No game state lives here. */
export class Router {
  readonly gwId = process.env.GW_ID ?? `gw:${randomUUID().slice(0, 8)}`;
  private conns = new Map<string, Conn>();
  private gameSubs = new Map<string, Set<string>>(); // g -> connIds
  private ownerCache = new Map<string, { node: string; exp: number }>();

  constructor(
    private server: SocketServer,
    private cmd: Redis,
    private sub: Redis,
  ) {}

  async start(port: number): Promise<void> {
    this.server.onConnection((s) => this.conns.set(s.id, { socket: s, userId: "anon", subs: new Set() }));
    this.server.onMessage((s, data) => void this.onMessage(s, data));
    this.server.onClose((s) => this.onClose(s));

    await this.sub.subscribe(ch.wsReply(this.gwId));
    this.sub.on("message", (chan, raw) => this.onBus(chan, raw));

    await this.server.listen(port);
    console.log(`[ws ${this.gwId}] listening on :${port}`);
  }

  private send(connId: string, msg: ServerMsg): void {
    this.conns.get(connId)?.socket.send(encode(msg));
  }

  private onBus(chan: string, raw: string): void {
    if (chan === ch.wsReply(this.gwId)) {
      const r = decode<ReplyOut>(raw);
      if (r) this.send(r.conn, r.msg);
      return;
    }
    const g = chan.slice("game:out:".length);
    const b = decode<OutBroadcast>(raw);
    const subs = this.gameSubs.get(g);
    if (!b || !subs) return;
    for (const connId of subs) this.send(connId, b.msg);
  }

  private async liveNodes(): Promise<string[]> {
    return this.cmd.zrangebyscore(keys.engineNodes, Date.now() - NODE_TTL_MS, "+inf");
  }

  private async resolveOwner(g: string): Promise<string | null> {
    const now = Date.now();
    const cached = this.ownerCache.get(g);
    if (cached && cached.exp > now) return cached.node;
    let node = await this.cmd.get(keys.owner(g));
    if (!node) node = pickOwner(g, await this.liveNodes());
    if (node) this.ownerCache.set(g, { node, exp: now + 3000 });
    return node;
  }

  private async route(evt: EngineInbound): Promise<void> {
    const owner = await this.resolveOwner(evt.g);
    if (!owner) {
      this.send(evt.conn, { v: 1, t: "error", g: evt.g, d: { code: "no-engine", msg: "no engine available" } });
      return;
    }
    void this.cmd.publish(ch.engineIn(owner), encode(evt));
  }

  /** Subscribe this gateway to a game's fan-out and add the socket to its set. */
  private async track(g: string, connId: string): Promise<void> {
    if (!this.gameSubs.has(g)) {
      this.gameSubs.set(g, new Set());
      await this.sub.subscribe(ch.gameOut(g));
    }
    this.gameSubs.get(g)!.add(connId);
    this.conns.get(connId)?.subs.add(g);
  }

  private async onMessage(s: Socket, data: string): Promise<void> {
    const msg = decode<ClientMsg>(data);
    const conn = this.conns.get(s.id);
    if (!msg || !conn) return;
    const base = { gw: this.gwId, conn: s.id, by: conn.userId, hop: 0 };

    switch (msg.t) {
      case "hello":
        conn.userId = msg.d?.token ? `u:${msg.d.token}` : `anon:${s.id.slice(0, 8)}`;
        this.send(s.id, { v: 1, t: "hello-ok", d: { node: this.gwId, conn: s.id } });
        return;

      case "ping":
        this.send(s.id, { v: 1, t: "pong", d: { ts: msg.d.ts } });
        return;

      case "sub":
        await this.track(msg.g, s.id);
        await this.route({ ...base, kind: "sub", g: msg.g });
        return;

      case "unsub":
        this.gameSubs.get(msg.g)?.delete(s.id);
        conn.subs.delete(msg.g);
        return;

      case "create":
        await this.track(msg.g, s.id);
        await this.route({ ...base, kind: "create", g: msg.g, clock: msg.d.clock, initialFen: msg.d.initialFen });
        return;

      case "join":
        await this.track(msg.g, s.id);
        await this.route({ ...base, kind: "join", g: msg.g });
        return;

      case "resync":
        await this.track(msg.g, s.id);
        await this.route({ ...base, kind: "resync", g: msg.g, havePly: msg.d.havePly });
        return;

      case "move":
        await this.route({ ...base, kind: "move", g: msg.g, uci: msg.d.uci, ply: msg.d.ply, lag: Math.max(0, msg.d.lag ?? 0) });
        return;

      case "resign":
        await this.route({ ...base, kind: "resign", g: msg.g });
        return;
    }
  }

  private onClose(s: Socket): void {
    const conn = this.conns.get(s.id);
    if (conn) for (const g of conn.subs) this.gameSubs.get(g)?.delete(s.id);
    this.conns.delete(s.id);
  }
}
