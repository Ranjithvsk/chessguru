// M0 acceptance: drives real WebSocket clients against a running gateway + 2
// engine nodes and asserts the 6 exit criteria from
// PROJECT_MASTER/plans/online-play-m0-walking-skeleton.md §5.
import WebSocket from "ws";
import Redis from "ioredis";
import { setTimeout as sleep } from "node:timers/promises";

const WS_URL = process.env.WS_URL ?? "ws://127.0.0.1:8080/ws";
const HTTP = process.env.WS_HTTP ?? "http://127.0.0.1:8080";
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
  next(pred, ms = 4000) {
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
  count(pred) {
    return this.msgs.filter(pred).length;
  }
  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

const G = "G-" + Math.random().toString(36).slice(2, 8);
const isAppended = (text) => (m) => m.t === "appended" && m.g === G && m.d.text === text;

async function main() {
  console.log(`\n== M0 acceptance ==  game=${G}\n`);

  // ── connect A + B, subscribe ────────────────────────────────────────────
  const A = new Client("A");
  const B = new Client("B");
  await A.connect();
  await B.connect();
  A.send({ v: 1, t: "hello", d: { token: "alice" } });
  B.send({ v: 1, t: "hello", d: { token: "bob" } });
  await A.next((m) => m.t === "hello-ok");
  await B.next((m) => m.t === "hello-ok");
  A.send({ v: 1, t: "sub", g: G });
  B.send({ v: 1, t: "sub", g: G });
  const stA = await A.next((m) => m.t === "state" && m.g === G);
  await B.next((m) => m.t === "state" && m.g === G);
  ok("sub returns empty state (seq 0)", stA.d.seq === 0 && stA.d.log.length === 0, JSON.stringify(stA.d));

  // ── C1: ordered echo through the authority, to both clients ──────────────
  A.send({ v: 1, t: "append", g: G, d: { text: "m0", seq: 0 } });
  const a0 = await A.next(isAppended("m0"));
  const b0 = await B.next(isAppended("m0"));
  A.send({ v: 1, t: "append", g: G, d: { text: "m1", seq: 1 } });
  const a1 = await A.next(isAppended("m1"));
  await B.next(isAppended("m1"));
  ok("C1 both clients receive appends", true);
  ok("C1 monotonic seq (0 then 1)", a0.d.seq === 0 && a1.d.seq === 1, `${a0.d.seq},${a1.d.seq}`);
  ok("C1 broadcast reaches second client", b0.d.text === "m0" && b0.d.by === "u:alice");

  // ── C2: single-writer placement ──────────────────────────────────────────
  const owner = await redis.get(`game:owner:${G}`);
  ok("C2 game owned by exactly one engine node", owner === "e1" || owner === "e2", `owner=${owner}`);
  const intrude = await redis.set(`game:owner:${G}`, "intruder", "PX", 15000, "NX");
  ok("C2 concurrent SET NX loses (single activation)", intrude === null, `got ${intrude}`);

  // ── C3: stale / out-of-order append rejected + recoverable ───────────────
  const bBefore = B.count(isAppended("dup"));
  A.send({ v: 1, t: "append", g: G, d: { text: "dup", seq: 0 } }); // stale: current seq is 2
  const err = await A.next((m) => m.t === "error" && m.d.code === "stale-seq");
  await A.next((m) => m.t === "state" && m.g === G); // recovery state follows the error
  await sleep(300);
  ok("C3 stale append → error stale-seq", err.d.code === "stale-seq");
  ok("C3 stale append not broadcast", B.count(isAppended("dup")) === bBefore);

  // ── C5: reconnect to (any) gateway + resync the exact missed tail ────────
  A.close();
  const A2 = new Client("A2");
  await A2.connect();
  A2.send({ v: 1, t: "hello", d: { token: "alice" } });
  await A2.next((m) => m.t === "hello-ok");
  A2.send({ v: 1, t: "resync", g: G, d: { haveSeq: 1 } }); // have entry 0, want the rest
  const tail = await A2.next((m) => m.t === "state" && m.g === G);
  ok("C5 resync returns exact tail", tail.d.from === 1 && tail.d.seq === 2 && JSON.stringify(tail.d.log) === JSON.stringify(["m1"]), JSON.stringify(tail.d));

  // ── C6: gateway health ────────────────────────────────────────────────────
  const health = await fetch(`${HTTP}/healthz`).then((r) => r.text()).catch(() => "");
  ok("C6 gateway /healthz responds", health.trim() === "ok", `got "${health}"`);

  // ── C4: crash the owner → re-place on survivor → rehydrate ───────────────
  const ownerPid = Number(await redis.get(`engine:pid:${owner}`));
  console.log(`\n  [crash] SIGKILL owner ${owner} (pid ${ownerPid}); waiting for lease+node expiry...`);
  process.kill(ownerPid, "SIGKILL");
  await sleep(16000); // lease (15s) + node heartbeat (15s) must lapse

  B.send({ v: 1, t: "append", g: G, d: { text: "after", seq: 2 } }); // B still knows seq==2
  const after = await B.next(isAppended("after"), 8000);
  ok("C4 game survives crash; seq continues at 2 (rehydrated)", after.d.seq === 2, `seq=${after.d.seq}`);
  const newOwner = await redis.get(`game:owner:${G}`);
  ok("C4 re-placed on the surviving node", newOwner && newOwner !== owner && (newOwner === "e1" || newOwner === "e2"), `newOwner=${newOwner}`);

  const D = new Client("D");
  await D.connect();
  D.send({ v: 1, t: "hello" });
  await D.next((m) => m.t === "hello-ok");
  D.send({ v: 1, t: "sub", g: G });
  const full = await D.next((m) => m.t === "state" && m.g === G);
  ok("C4 full log rehydrated (m0,m1,after)", JSON.stringify(full.d.log) === JSON.stringify(["m0", "m1", "after"]), JSON.stringify(full.d.log));

  A2.close();
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
