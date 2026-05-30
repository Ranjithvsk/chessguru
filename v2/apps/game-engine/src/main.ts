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
import { RoundGrain } from "./grain";
import { readState, writeState } from "./snapshot";
import { persistGame } from "./mongo";

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

function gameStateMsg(g: string, grain: RoundGrain): ServerMsg {
  return {
    v: 1,
    t: "game-state",
    g,
    d: {
      fen: grain.fen(),
      moves: grain.state().moves,
      turn: grain.turn,
      ply: grain.ply,
      status: grain.status,
      result: grain.result,
      players: grain.state().players,
    },
  };
}

async function activate(g: string): Promise<RoundGrain> {
  const existing = reg.get(g);
  if (existing) return existing;
  const grain = new RoundGrain();
  grain.hydrate(await readState(cmd, g)); // rehydrate after a re-placement
  reg.set(g, grain);
  return grain;
}

async function persistIfEnded(g: string, grain: RoundGrain): Promise<void> {
  if (grain.status === "playing") return;
  const st = grain.state();
  await persistGame(g, {
    variant: "standard",
    players: st.players,
    initialFen: st.initialFen,
    moves: st.moves,
    result: st.result,
    status: st.status,
    startedAt: new Date(st.startedAt),
    finishedAt: new Date(st.finishedAt ?? Date.now()),
  }).catch((e) => console.error("[engine] persist failed", e));
}

async function handle(evt: EngineInbound): Promise<void> {
  const g = evt.g;

  // ── ownership resolution (unchanged from M0) ──────────────────────────────
  let owner = await dir.current(g);
  if (owner === null) {
    owner = (await dir.claim(g)) ? NODE_ID : await dir.current(g);
  }
  if (owner !== NODE_ID) {
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

  switch (evt.kind) {
    case "sub":
    case "resync":
      reply(evt.gw, evt.conn, gameStateMsg(g, grain));
      return;

    case "join": {
      const j = grain.join(evt.by);
      if (!(await dir.owns(g))) return void reg.evict(g);
      await writeState(cmd, g, grain.state());
      reply(evt.gw, evt.conn, { v: 1, t: "joined", g, d: { seat: j.seat, userId: evt.by } });
      broadcast(g, gameStateMsg(g, grain)); // everyone sees the updated seats
      return;
    }

    case "move": {
      const r = grain.move(evt.uci, evt.ply, evt.by);
      if (!r.ok) {
        reply(evt.gw, evt.conn, { v: 1, t: "error", g, d: { code: r.code ?? "rejected", msg: "move rejected" } });
        reply(evt.gw, evt.conn, gameStateMsg(g, grain)); // help the client re-sync
        return;
      }
      if (!(await dir.owns(g))) return void reg.evict(g); // split-brain guard
      await writeState(cmd, g, grain.state());
      broadcast(g, { v: 1, t: "moved", g, d: { uci: evt.uci, san: r.san!, ply: r.ply!, fen: r.fen!, turn: r.turn!, by: evt.by } });
      if (r.end) {
        broadcast(g, { v: 1, t: "game-end", g, d: { result: r.end.result, reason: r.end.reason, fen: r.fen! } });
        await persistIfEnded(g, grain);
      }
      return;
    }

    case "resign": {
      const r = grain.resign(evt.by);
      if (!r.ok) {
        reply(evt.gw, evt.conn, { v: 1, t: "error", g, d: { code: r.code ?? "rejected", msg: "resign rejected" } });
        return;
      }
      if (!(await dir.owns(g))) return void reg.evict(g);
      await writeState(cmd, g, grain.state());
      broadcast(g, gameStateMsg(g, grain));
      broadcast(g, { v: 1, t: "game-end", g, d: { result: r.end!.result, reason: r.end!.reason, fen: grain.fen() } });
      await persistIfEnded(g, grain);
      return;
    }
  }
}

async function heartbeat(): Promise<void> {
  await cluster.beat();
  for (const g of reg.active()) {
    if (await dir.owns(g)) await dir.renew(g);
    else reg.evict(g);
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
