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
    // game:out:{g} broadcast
    const g = chan.slice("game:out:".length);
    const b = decode<OutBroadcast>(raw);
    const subs = this.gameSubs.get(g);
    if (!b || !subs) return;
    for (const connId of subs) this.send(connId, b.msg);
  }

  private async liveNodes(): Promise<string[]> {
    return this.cmd.zrangebyscore(keys.engineNodes, Date.now() - NODE_TTL_MS, "+inf");
  }

  /** Owner of g: cached → lease → cold-placement target via the ring. */
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

  private async ensureGameSub(g: string): Promise<void> {
    if (!this.gameSubs.has(g)) {
      this.gameSubs.set(g, new Set());
      await this.sub.subscribe(ch.gameOut(g));
    }
  }

  private async onMessage(s: Socket, data: string): Promise<void> {
    const msg = decode<ClientMsg>(data);
    const conn = this.conns.get(s.id);
    if (!msg || !conn) return;

    switch (msg.t) {
      case "hello":
        conn.userId = msg.d?.token ? `u:${msg.d.token}` : `anon:${s.id.slice(0, 8)}`;
        this.send(s.id, { v: 1, t: "hello-ok", d: { node: this.gwId, conn: s.id } });
        return;

      case "ping":
        this.send(s.id, { v: 1, t: "pong", d: { ts: msg.d.ts } });
        return;

      case "sub":
        await this.ensureGameSub(msg.g);
        this.gameSubs.get(msg.g)!.add(s.id);
        conn.subs.add(msg.g);
        await this.route({ kind: "sub", g: msg.g, gw: this.gwId, conn: s.id, by: conn.userId, haveSeq: 0, hop: 0 });
        return;

      case "unsub":
        this.gameSubs.get(msg.g)?.delete(s.id);
        conn.subs.delete(msg.g);
        return;

      case "resync":
        await this.ensureGameSub(msg.g);
        this.gameSubs.get(msg.g)!.add(s.id);
        conn.subs.add(msg.g);
        await this.route({ kind: "resync", g: msg.g, gw: this.gwId, conn: s.id, by: conn.userId, haveSeq: msg.d.haveSeq, hop: 0 });
        return;

      case "append":
        await this.route({ kind: "append", g: msg.g, gw: this.gwId, conn: s.id, by: conn.userId, text: msg.d.text, seq: msg.d.seq, hop: 0 });
        return;
    }
  }

  private onClose(s: Socket): void {
    const conn = this.conns.get(s.id);
    if (conn) for (const g of conn.subs) this.gameSubs.get(g)?.delete(s.id);
    this.conns.delete(s.id);
  }
}
