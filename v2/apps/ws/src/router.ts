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
import { botKey, guestId, sessionUser, trustTokens } from "./identity";

interface Conn {
  socket: Socket;
  userId: string;
  subs: Set<string>;
  tokens: number;
  last: number;
}

const RL_CAPACITY = 40; // burst
const RL_REFILL_PER_MS = 40 / 1000; // 40 msgs/sec sustained

/** Stateless relay: holds sockets, routes client events to the owning engine
 *  node, fans engine output back out. No game state lives here. */
export class Router {
  readonly gwId = process.env.GW_ID ?? `gw:${randomUUID().slice(0, 8)}`;
  private conns = new Map<string, Conn>();
  private gameSubs = new Map<string, Set<string>>();
  private ownerCache = new Map<string, { node: string; exp: number }>();
  private messagesTotal = 0;
  private rateLimitedTotal = 0;
  private botKey = "";

  constructor(
    private server: SocketServer,
    private cmd: Redis,
    private sub: Redis,
  ) {}

  async start(port: number): Promise<void> {
    this.botKey = await botKey(this.cmd);
    if (trustTokens) console.warn(`[ws ${this.gwId}] PLAY_TRUST_TOKENS=1 — hello.token is trusted (dev harness only)`);
    this.server.onConnection((s) => this.conns.set(s.id, { socket: s, userId: `anon:${s.id.slice(0, 8)}`, subs: new Set(), tokens: RL_CAPACITY, last: Date.now() }));
    this.server.onMessage((s, data) => void this.onMessage(s, data));
    this.server.onClose((s) => this.onClose(s));

    await this.sub.subscribe(ch.wsReply(this.gwId));
    this.sub.on("message", (chan, raw) => this.onBus(chan, raw));

    this.server.onMetrics(() => this.renderMetrics());
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

  private async track(g: string, connId: string): Promise<void> {
    if (!this.gameSubs.has(g)) {
      this.gameSubs.set(g, new Set());
      await this.sub.subscribe(ch.gameOut(g));
    }
    this.gameSubs.get(g)!.add(connId);
    this.conns.get(connId)?.subs.add(g);
  }

  private async onMessage(s: Socket, data: string): Promise<void> {
    const conn = this.conns.get(s.id);
    if (!conn) return;
    this.messagesTotal++;
    const now = Date.now();
    conn.tokens = Math.min(RL_CAPACITY, conn.tokens + (now - conn.last) * RL_REFILL_PER_MS);
    conn.last = now;
    if (conn.tokens < 1) {
      this.rateLimitedTotal++;
      this.send(s.id, { v: 1, t: "error", d: { code: "rate-limited", msg: "slow down" } });
      return;
    }
    conn.tokens -= 1;
    const msg = decode<ClientMsg>(data);
    if (!msg) return;
    const base = { gw: this.gwId, conn: s.id, by: conn.userId, hop: 0 };

    switch (msg.t) {
      case "hello": {
        const bot = msg.d?.bot;
        if (bot && this.botKey && bot.key === this.botKey && /^[a-z0-9_]{3,40}$/.test(bot.name)) conn.userId = `u:${bot.name}`;
        else if (trustTokens && msg.d?.token) conn.userId = `u:${msg.d.token}`;
        else conn.userId = (await sessionUser(s.cookie)) ?? guestId(msg.d?.guest, s.id.slice(0, 8));
        // Seat changed → any seek left under the old id is stale (a re-hello after
        // reconnect keeps the same id, so this is a no-op in the common case).
        if (base.by !== conn.userId && !base.by.startsWith("anon:")) this.publishLeaves(conn, base.by);
        this.send(s.id, { v: 1, t: "hello-ok", d: { node: this.gwId, conn: s.id, userId: conn.userId } });
        return;
      }

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
        if (!this.stillSubscribed(conn.userId, msg.g)) await this.route({ ...base, kind: "leave", g: msg.g });
        return;

      case "abort":
        await this.route({ ...base, kind: "abort", g: msg.g });
        return;

      case "claim":
        await this.route({ ...base, kind: "claim", g: msg.g });
        return;

      case "create":
        await this.track(msg.g, s.id);
        await this.route({ ...base, kind: "create", g: msg.g, clock: msg.d.clock, initialFen: msg.d.initialFen, rated: msg.d.rated ?? true });
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

      case "premove":
        await this.route({ ...base, kind: "premove", g: msg.g, uci: msg.d.uci });
        return;

      case "draw-offer":
        await this.route({ ...base, kind: "draw-offer", g: msg.g });
        return;

      case "draw-accept":
        await this.route({ ...base, kind: "draw-accept", g: msg.g });
        return;

      case "draw-decline":
        await this.route({ ...base, kind: "draw-decline", g: msg.g });
        return;

      case "seek":
        void this.cmd.publish(ch.lobbyIn, encode({ kind: "seek", gw: this.gwId, conn: s.id, by: conn.userId, clock: msg.d.clock, rated: msg.d.rated ?? true, ratingRange: msg.d.ratingRange }));
        return;

      case "unseek":
        void this.cmd.publish(ch.lobbyIn, encode({ kind: "unseek", gw: this.gwId, conn: s.id, by: conn.userId }));
        return;

      case "challenge":
        void this.cmd.publish(ch.lobbyIn, encode({ kind: "challenge", gw: this.gwId, conn: s.id, by: conn.userId, clock: msg.d.clock, rated: msg.d.rated ?? true }));
        return;

      case "challenge-accept":
        void this.cmd.publish(ch.lobbyIn, encode({ kind: "challenge-accept", gw: this.gwId, conn: s.id, by: conn.userId, id: msg.d.id }));
        return;

      case "rematch":
        await this.track(msg.g, s.id);
        await this.route({ ...base, kind: "rematch", g: msg.g });
        return;
    }
  }

  private renderMetrics(): string {
    return (
      `# TYPE cg_ws_connections gauge\ncg_ws_connections ${this.conns.size}\n` +
      `# TYPE cg_ws_messages_total counter\ncg_ws_messages_total ${this.messagesTotal}\n` +
      `# TYPE cg_ws_rate_limited_total counter\ncg_ws_rate_limited_total ${this.rateLimitedTotal}\n`
    );
  }

  /** Does this user still hold another socket on `g` (a second tab)? */
  private stillSubscribed(userId: string, g: string): boolean {
    for (const c of this.conns.values()) if (c.userId === userId && c.subs.has(g)) return true;
    return false;
  }

  /** Tell each game's engine the user's last socket on it is gone, so the opponent
   *  can eventually claim. Presence is per user, not per socket: a second tab keeps
   *  the player "present". */
  private publishLeaves(conn: Conn, userId: string): void {
    for (const g of conn.subs) {
      if (this.stillSubscribed(userId, g)) continue;
      void this.route({ gw: this.gwId, conn: conn.socket.id, by: userId, hop: 0, kind: "leave", g });
    }
  }

  private onClose(s: Socket): void {
    const conn = this.conns.get(s.id);
    this.conns.delete(s.id);
    if (conn) {
      for (const g of conn.subs) this.gameSubs.get(g)?.delete(s.id);
      this.publishLeaves(conn, conn.userId);
      // Without this a closed tab leaves its seek in the pool forever, and the next
      // seeker "matches" a socket that no longer exists.
      void this.cmd.publish(ch.lobbyIn, encode({ kind: "unseek", gw: this.gwId, conn: s.id, by: conn.userId }));
    }
  }
}
