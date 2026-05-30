// M1 acceptance: two humans play a full untimed game to checkmate through the
// authority — with turn/legality/order enforcement, a mid-game owner crash
// (rehydration), and Mongo persistence of the finished game.
import WebSocket from "ws";
import Redis from "ioredis";
import { MongoClient } from "mongodb";
import { setTimeout as sleep } from "node:timers/promises";

const WS_URL = process.env.WS_URL ?? "ws://127.0.0.1:18080/ws";
const HTTP = process.env.WS_HTTP ?? "http://127.0.0.1:18080";
const MONGO = process.env.MONGO_URI ?? "mongodb://127.0.0.1:27017/chessguru";
const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");

let pass = 0,
  fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) {
    pass++;
    console.log(`  ✓ PASS  ${name}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL  ${name}  ${extra}`);
  }
};

class Client {
  constructor(name) {
    this.name = name;
    this.msgs = [];
    this.waiters = [];
  }
  connect() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(WS_URL);
      this.ws.on("open", res);
      this.ws.on("error", rej);
      this.ws.on("message", (d) => {
        const m = JSON.parse(d.toString());
        this.msgs.push(m);
        this.waiters = this.waiters.filter((w) => !w(m));
      });
    });
  }
  send(o) {
    this.ws.send(JSON.stringify(o));
  }
  next(pred, ms = 5000) {
    const hit = this.msgs.find(pred);
    if (hit) return Promise.resolve(hit);
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`${this.name}: timeout`)), ms);
      this.waiters.push((m) => {
        if (pred(m)) {
          clearTimeout(t);
          res(m);
          return true;
        }
        return false;
      });
    });
  }
  async hello(token) {
    await this.connect();
    this.send({ v: 1, t: "hello", d: { token } });
    await this.next((m) => m.t === "hello-ok");
  }
  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

const G = "m1-" + Math.random().toString(36).slice(2, 8);
const moved = (uci) => (m) => m.t === "moved" && m.g === G && m.d.uci === uci;
const err = (code) => (m) => m.t === "error" && m.g === G && m.d.code === code;

async function main() {
  console.log(`\n== M1 acceptance ==  game=${G}\n`);

  const A = new Client("A");
  const B = new Client("B");
  await A.hello("alice");
  await B.hello("bob");

  // ── seating ───────────────────────────────────────────────────────────────
  A.send({ v: 1, t: "join", g: G });
  const ja = await A.next((m) => m.t === "joined" && m.g === G);
  B.send({ v: 1, t: "join", g: G });
  const jb = await B.next((m) => m.t === "joined" && m.g === G);
  ok("A seated white, B seated black", ja.d.seat === "white" && jb.d.seat === "black", `${ja.d.seat}/${jb.d.seat}`);

  // ── single-writer placement (machinery, as in M0) ─────────────────────────
  const owner = await redis.get(`game:owner:${G}`);
  ok("game owned by exactly one engine node", owner === "e1" || owner === "e2", `owner=${owner}`);
  const intrude = await redis.set(`game:owner:${G}`, "intruder", "PX", 15000, "NX");
  ok("concurrent SET NX loses (single activation)", intrude === null);

  // ── rule enforcement at ply 0 (white to move) ─────────────────────────────
  B.send({ v: 1, t: "move", g: G, d: { uci: "e7e5", ply: 0 } }); // black out of turn
  ok("out-of-turn move → not-your-turn", (await B.next(err("not-your-turn"))).d.code === "not-your-turn");
  A.send({ v: 1, t: "move", g: G, d: { uci: "e2e5", ply: 0 } }); // illegal
  ok("illegal move → illegal-move", (await A.next(err("illegal-move"))).d.code === "illegal-move");
  A.send({ v: 1, t: "move", g: G, d: { uci: "f2f3", ply: 9 } }); // wrong ply
  ok("stale ply → stale-ply", (await A.next(err("stale-ply"))).d.code === "stale-ply");

  // ── play Fool's mate, crashing the owner mid-game ─────────────────────────
  A.send({ v: 1, t: "move", g: G, d: { uci: "f2f3", ply: 0 } });
  await A.next(moved("f2f3"));
  await B.next(moved("f2f3"));
  B.send({ v: 1, t: "move", g: G, d: { uci: "e7e5", ply: 1 } });
  await B.next(moved("e7e5"));
  await A.next(moved("e7e5"));
  ok("first two moves applied + broadcast to both", true);

  const ownerPid = Number(await redis.get(`engine:pid:${owner}`));
  console.log(`\n  [crash] SIGKILL owner ${owner} (pid ${ownerPid}); waiting for lease+node expiry...`);
  process.kill(ownerPid, "SIGKILL");
  await sleep(16000);

  A.send({ v: 1, t: "move", g: G, d: { uci: "g2g4", ply: 2 } }); // requires rehydrated position
  const g4 = await A.next(moved("g2g4"), 8000);
  ok("move after crash applied (position rehydrated)", g4.d.ply === 2, `ply=${g4.d.ply}`);
  const newOwner = await redis.get(`game:owner:${G}`);
  ok("game re-placed on surviving node", newOwner && newOwner !== owner, `newOwner=${newOwner}`);

  B.send({ v: 1, t: "move", g: G, d: { uci: "d8h4", ply: 3 } }); // checkmate
  await B.next(moved("d8h4"));
  const end = await B.next((m) => m.t === "game-end" && m.g === G);
  ok("checkmate → game-end 0-1 / checkmate", end.d.result === "0-1" && end.d.reason === "checkmate", JSON.stringify(end.d));

  // ── persistence ───────────────────────────────────────────────────────────
  await sleep(400);
  const mc = new MongoClient(MONGO);
  await mc.connect();
  const doc = await mc.db().collection("live_games").findOne({ _id: G });
  ok("finished game persisted to Mongo", !!doc, "no doc");
  if (doc)
    ok(
      "persisted doc correct (0-1, checkmate, 4 moves, both players)",
      doc.result === "0-1" && doc.status === "checkmate" && doc.moves.length === 4 && doc.players.white === "u:alice" && doc.players.black === "u:bob",
      JSON.stringify({ r: doc.result, s: doc.status, n: doc.moves.length }),
    );
  await mc.close();

  // ── spectator joins after the fact, sees full rehydrated game ─────────────
  const D = new Client("D");
  await D.hello();
  D.send({ v: 1, t: "sub", g: G });
  const st = await D.next((m) => m.t === "game-state" && m.g === G);
  ok("late spectator sees final state (4 moves, checkmate)", st.d.moves.length === 4 && st.d.status === "checkmate" && st.d.result === "0-1", JSON.stringify({ n: st.d.moves.length, s: st.d.status }));

  // ── gateway health ─────────────────────────────────────────────────────────
  const health = await fetch(`${HTTP}/healthz`).then((r) => r.text()).catch(() => "");
  ok("gateway /healthz responds", health.trim() === "ok");

  A.close();
  B.close();
  D.close();
  await redis.quit();
  console.log(`\n== result: ${pass} passed, ${fail} failed ==\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("verifier crashed:", e);
  process.exit(2);
});
