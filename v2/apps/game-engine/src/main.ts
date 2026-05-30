import http from "node:http";
import {
  ch,
  decode,
  encode,
  HEARTBEAT_MS,
  type EngineInbound,
  type OutBroadcast,
  type ReplyOut,
  type ServerMsg,
} from "@chessguru/protocol";
import { newRedis } from "./redis";
import { NODE_ID } from "./node-id";
import { Cluster } from "./cluster";
import { Directory } from "./directory";
import { Registry } from "./registry";
import { Mailbox } from "./mailbox";
import { EchoGrain } from "./grain";
import { readState, writeState } from "./snapshot";

const cmd = newRedis();
const sub = newRedis();
const cluster = new Cluster(cmd, NODE_ID);
const dir = new Directory(cmd, NODE_ID);
const reg = new Registry();
const mb = new Mailbox();

const MAX_HOP = 4;

function reply(gw: string, conn: string, msg: ServerMsg): void {
  const payload: ReplyOut = { conn, msg };
  void cmd.publish(ch.wsReply(gw), encode(payload));
}

function broadcast(g: string, msg: ServerMsg): void {
  const payload: OutBroadcast = { msg };
  void cmd.publish(ch.gameOut(g), encode(payload));
}

async function activate(g: string): Promise<EchoGrain> {
  const existing = reg.get(g);
  if (existing) return existing;
  const grain = new EchoGrain();
  grain.hydrate(await readState(cmd, g)); // rehydrate after a re-placement
  reg.set(g, grain);
  return grain;
}

async function handle(evt: EngineInbound): Promise<void> {
  const g = evt.g;

  // ── ownership resolution ──────────────────────────────────────────────────
  let owner = await dir.current(g);
  if (owner === null) {
    owner = (await dir.claim(g)) ? NODE_ID : await dir.current(g);
  }
  if (owner !== NODE_ID) {
    // someone else owns it (or just claimed it) → forward, bounded
    if (!owner || evt.hop >= MAX_HOP) {
      reply(evt.gw, evt.conn, { v: 1, t: "error", g, d: { code: "no-owner", msg: "could not place game" } });
      return;
    }
    void cmd.publish(ch.engineIn(owner), encode({ ...evt, hop: evt.hop + 1 }));
    return;
  }

  // ── we are the single writer for g ────────────────────────────────────────
  await dir.renew(g);
  const grain = await activate(g);

  if (evt.kind === "append") {
    const r = grain.append(evt.text, evt.seq);
    if (!r.ok) {
      reply(evt.gw, evt.conn, { v: 1, t: "error", g, d: { code: r.code ?? "rejected", msg: "stale or out-of-order append" } });
      reply(evt.gw, evt.conn, { v: 1, t: "state", g, d: { log: grain.state().log, seq: grain.seq, from: 0 } });
      return;
    }
    // split-brain guard: only trust the write if we still hold the lease
    if (!(await dir.owns(g))) {
      reg.evict(g);
      return;
    }
    await writeState(cmd, g, grain.state());
    broadcast(g, { v: 1, t: "appended", g, d: { text: evt.text, seq: r.seq!, by: evt.by } });
    return;
  }

  // sub / resync — reply with a (partial) state snapshot to the requester
  const from = evt.kind === "resync" ? Math.max(0, evt.haveSeq) : 0;
  reply(evt.gw, evt.conn, { v: 1, t: "state", g, d: { log: grain.tail(from), seq: grain.seq, from } });
}

async function heartbeat(): Promise<void> {
  await cluster.beat();
  for (const g of reg.active()) {
    if (await dir.owns(g)) await dir.renew(g);
    else reg.evict(g); // lost the lease (e.g. GC pause > TTL) → stop serving it
  }
}

async function main(): Promise<void> {
  await cluster.register();
  await sub.subscribe(ch.engineIn(NODE_ID));
  sub.on("message", (_chan, raw) => {
    const evt = decode<EngineInbound>(raw);
    if (!evt) return;
    void mb.run(evt.g, () => handle(evt).catch((e) => console.error("[engine] handle error", e)));
  });

  setInterval(() => void heartbeat().catch(() => {}), HEARTBEAT_MS);

  const port = Number(process.env.ENGINE_PORT ?? 0);
  if (port) {
    http
      .createServer((req, res) => {
        if (req.url === "/healthz") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true, node: NODE_ID, grains: reg.active().length }));
          return;
        }
        res.writeHead(404);
        res.end();
      })
      .listen(port, () => console.log(`[engine ${NODE_ID}] healthz on :${port}`));
  }
  console.log(`[engine ${NODE_ID}] up (pid ${process.pid})`);
}

async function shutdown(): Promise<void> {
  // clean exit only — a SIGKILL (crash test) deliberately skips this so the
  // lease must expire and the game re-places elsewhere.
  for (const g of reg.active()) await dir.release(g);
  await cluster.deregister();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown().catch(() => process.exit(1)));
process.on("SIGTERM", () => void shutdown().catch(() => process.exit(1)));

void main().catch((e) => {
  console.error("[engine] fatal", e);
  process.exit(1);
});
