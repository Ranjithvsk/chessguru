// M2 acceptance: server-truth clocks — win on time, flag + insufficient-material
// draw, lag compensation, and periodic clock ticks.
import WebSocket from "ws";
import Redis from "ioredis";
import { setTimeout as sleep } from "node:timers/promises";

const WS_URL = process.env.WS_URL ?? "ws://127.0.0.1:18080/ws";
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
  next(pred, ms = 6000) {
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
  async hello(token) {
    await this.connect();
    this.send({ v: 1, t: "hello", d: token ? { token } : {} });
    await this.next((m) => m.t === "hello-ok");
  }
  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

const rid = () => Math.random().toString(36).slice(2, 8);

async function seatGame(g, clock, initialFen) {
  const A = new Client("W");
  const B = new Client("B");
  await A.hello("alice");
  await B.hello("bob");
  A.send({ v: 1, t: "create", g, d: { clock, initialFen } });
  await A.next((m) => m.t === "game-state" && m.g === g);
  A.send({ v: 1, t: "join", g });
  await A.next((m) => m.t === "joined" && m.g === g);
  B.send({ v: 1, t: "join", g });
  await B.next((m) => m.t === "joined" && m.g === g);
  return { A, B };
}

async function main() {
  console.log(`\n== M2 acceptance (clocks) ==\n`);

  // ── G1: win on time ───────────────────────────────────────────────────────
  {
    const g = "m2win-" + rid();
    const { A, B } = await seatGame(g, { initial: 1200, increment: 0 });
    A.send({ v: 1, t: "move", g, d: { uci: "e2e4", ply: 0 } });
    const mv = await A.next((m) => m.t === "moved" && m.g === g);
    ok("G1 moved carries both clocks", typeof mv.d.clock.white === "number" && typeof mv.d.clock.black === "number", JSON.stringify(mv.d.clock));
    // black never moves → flags after ~1.2s
    const end = await B.next((m) => m.t === "game-end" && m.g === g, 4000);
    ok("G1 black flags → white wins on time (1-0 / flag)", end.d.result === "1-0" && end.d.reason === "flag", JSON.stringify(end.d));
    ok("G1 flagged side clock is 0", end.d.clock.black === 0, JSON.stringify(end.d.clock));
    A.close();
    B.close();
  }

  // ── G2: flag with opponent lone king → draw (insufficient material) ───────
  {
    const g = "m2draw-" + rid();
    // white K+N to move, black lone king; white never moves → white flags,
    // black can't mate → draw.
    const { A, B } = await seatGame(g, { initial: 700, increment: 0 }, "7k/8/8/8/8/8/8/KN6 w - - 0 1");
    const end = await B.next((m) => m.t === "game-end" && m.g === g, 4000);
    ok("G2 flag vs lone king → draw (1/2-1/2 / flag)", end.d.result === "1/2-1/2" && end.d.reason === "flag", JSON.stringify(end.d));
    A.close();
    B.close();
  }

  // ── G3: lag compensation + periodic clock tick ────────────────────────────
  {
    const g = "m2lag-" + rid();
    const { A, B } = await seatGame(g, { initial: 60000, increment: 0 });

    // White: think ~600ms, claim 500ms lag → most of the think time is refunded.
    await sleep(600);
    const t0 = Date.now();
    A.send({ v: 1, t: "move", g, d: { uci: "e2e4", ply: 0, lag: 500 } });
    const wMove = await A.next((m) => m.t === "moved" && m.g === g && m.d.uci === "e2e4");
    const wElapsed = Date.now() - t0 + 600;
    const wDebit = 60000 - wMove.d.clock.white;
    ok("G3 lag-comp refunds (white debit << elapsed)", wDebit < wElapsed - 300, `debit=${wDebit} elapsed≈${wElapsed}`);

    // Black: think ~600ms, no lag claimed → debit ≈ elapsed (no refund).
    await sleep(600);
    const t1 = Date.now();
    B.send({ v: 1, t: "move", g, d: { uci: "e7e5", ply: 1, lag: 0 } });
    const bMove = await B.next((m) => m.t === "moved" && m.g === g && m.d.uci === "e7e5");
    const bElapsed = Date.now() - t1 + 600;
    const bDebit = 60000 - bMove.d.clock.black;
    ok("G3 no-lag debit ≈ elapsed (no refund)", bDebit > bElapsed - 250, `debit=${bDebit} elapsed≈${bElapsed}`);
    ok("G3 lag-comp gave white more time than black for equal think", wMove.d.clock.white - bMove.d.clock.black > 250, `w=${wMove.d.clock.white} b=${bMove.d.clock.black}`);

    // periodic clock tick (server broadcasts every ~2s while running)
    const tickBefore = A.count((m) => m.t === "clock" && m.g === g);
    await sleep(2300);
    ok("G3 periodic clock tick received", A.count((m) => m.t === "clock" && m.g === g) > tickBefore);
    A.close();
    B.close();
  }

  await redis.quit();
  console.log(`\n== result: ${pass} passed, ${fail} failed ==\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("verifier crashed:", e);
  process.exit(2);
});
