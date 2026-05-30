// M5 acceptance: hardening.
// T1 premove auto-applies on your turn
// T2 per-connection rate limiting rejects floods
// T3 per-move think-time captured + persisted (anti-cheat)
// T4 Prometheus /metrics on engine + gateway
// T5 bot-fleet load across TWO gateways + SIGKILL an engine mid-game → zero lost games
import WebSocket from "ws";
import Redis from "ioredis";
import { MongoClient } from "mongodb";
import { setTimeout as sleep } from "node:timers/promises";

const GW1 = process.env.GW1 ?? "ws://127.0.0.1:18080/ws";
const GW2 = process.env.GW2 ?? "ws://127.0.0.1:18081/ws";
const ENGINE_METRICS = process.env.ENGINE_METRICS ?? "http://127.0.0.1:9101/metrics";
const GW1_METRICS = process.env.GW1_METRICS ?? "http://127.0.0.1:18080/metrics";
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
  constructor(name, url) {
    this.name = name;
    this.url = url;
    this.msgs = [];
    this.waiters = [];
  }
  connect() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(this.url);
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
  next(pred, ms = 8000) {
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
const moved = (g, uci) => (m) => m.t === "moved" && m.g === g && m.d.uci === uci;

async function createGame(g, white, black, clock) {
  white.send({ v: 1, t: "create", g, d: { clock, rated: true } });
  await white.next((m) => m.t === "game-state" && m.g === g);
  white.send({ v: 1, t: "join", g });
  await white.next((m) => m.t === "joined" && m.g === g);
  black.send({ v: 1, t: "join", g });
  await black.next((m) => m.t === "joined" && m.g === g);
}

async function main() {
  console.log(`\n== M5 acceptance (hardening) ==\n`);
  const mc = new MongoClient(MONGO);
  await mc.connect();

  // ── T1 premove ────────────────────────────────────────────────────────────
  {
    const g = "m5pre-" + rid();
    const A = new Client("W", GW1);
    const B = new Client("B", GW1);
    await A.hello("alice");
    await B.hello("bob");
    await createGame(g, A, B, { initial: 600000, increment: 0 });
    B.send({ v: 1, t: "premove", g, d: { uci: "e7e5" } }); // black queues a reply
    await sleep(150);
    A.send({ v: 1, t: "move", g, d: { uci: "e2e4", ply: 0 } });
    await A.next(moved(g, "e2e4"));
    const auto = await A.next(moved(g, "e7e5")); // premove fires automatically
    ok("T1 premove auto-applies on the player's turn", auto.d.by === "u:bob" && auto.d.ply === 1, JSON.stringify(auto.d));
    A.close();
    B.close();
  }

  // ── T2 rate limiting ────────────────────────────────────────────────────────
  {
    const A = new Client("R", GW1);
    await A.hello("rl");
    for (let i = 0; i < 80; i++) A.send({ v: 1, t: "ping", d: { ts: i } });
    const err = await A.next((m) => m.t === "error" && m.d.code === "rate-limited", 4000).catch(() => null);
    ok("T2 message flood is rate-limited", !!err);
    A.close();
  }

  // ── T3 move-time capture (persisted) ──────────────────────────────────────
  {
    const g = "m5mt-" + rid();
    const A = new Client("W", GW1);
    const B = new Client("B", GW1);
    await A.hello("alice");
    await B.hello("bob");
    await createGame(g, A, B, { initial: 600000, increment: 0 });
    for (const [uci, ply, cl] of [["f2f3", 0, A], ["e7e5", 1, B], ["g2g4", 2, A], ["d8h4", 3, B]]) {
      await sleep(60);
      cl.send({ v: 1, t: "move", g, d: { uci, ply } });
      await cl.next(moved(g, uci));
    }
    await B.next((m) => m.t === "game-end" && m.g === g);
    await sleep(300);
    const doc = await mc.db().collection("live_games").findOne({ _id: g });
    ok("T3 think-times captured + persisted", doc && Array.isArray(doc.moveTimes) && doc.moveTimes.length === 4 && doc.moveTimes.every((x) => x >= 0), JSON.stringify(doc?.moveTimes));
    A.close();
    B.close();
  }

  // ── T4 metrics ────────────────────────────────────────────────────────────
  {
    const em = await fetch(ENGINE_METRICS).then((r) => r.text()).catch(() => "");
    const gm = await fetch(GW1_METRICS).then((r) => r.text()).catch(() => "");
    ok("T4 engine /metrics exposes counters", em.includes("cg_moves_total") && em.includes("cg_games_finished_total"), em.slice(0, 60));
    ok("T4 gateway /metrics exposes counters", gm.includes("cg_ws_connections") && gm.includes("cg_ws_messages_total"), gm.slice(0, 60));
  }

  // ── T5 load + chaos across two gateways ───────────────────────────────────
  {
    const N = 8;
    const games = [];
    for (let i = 0; i < N; i++) {
      const w = new Client(`w${i}`, GW1); // white on gateway 1
      const b = new Client(`b${i}`, GW2); // black on gateway 2 (cross-gateway play)
      await w.hello(`w${i}`);
      await b.hello(`b${i}`);
      const g = `m5load-${rid()}-${i}`;
      await createGame(g, w, b, { initial: 600000, increment: 0 }); // 10min so the 16s outage can't flag
      games.push({ g, w, b });
    }
    // two plies each (fool's mate opening)
    for (const { g, w, b } of games) {
      w.send({ v: 1, t: "move", g, d: { uci: "f2f3", ply: 0 } });
      await w.next(moved(g, "f2f3"));
      b.send({ v: 1, t: "move", g, d: { uci: "e7e5", ply: 1 } });
      await b.next(moved(g, "e7e5"));
    }
    ok("T5 cross-gateway play works (white@gw1, black@gw2)", true);

    // CHAOS: kill engine node e1 mid-load
    const pid = Number(await redis.get("engine:pid:e1"));
    console.log(`\n  [chaos] SIGKILL engine e1 (pid ${pid}); ${N} games in flight; waiting for re-placement...`);
    process.kill(pid, "SIGKILL");
    await sleep(16000);

    // finish every game to checkmate; games that were on e1 must have re-placed + rehydrated
    let finished = 0;
    for (const { g, w, b } of games) {
      w.send({ v: 1, t: "move", g, d: { uci: "g2g4", ply: 2 } });
      await w.next(moved(g, "g2g4"), 10000);
      b.send({ v: 1, t: "move", g, d: { uci: "d8h4", ply: 3 } });
      const end = await b.next((m) => m.t === "game-end" && m.g === g, 10000);
      if (end.d.result === "0-1" && end.d.reason === "checkmate") finished++;
    }
    ok(`T5 all ${N} games survived the node-kill and finished correctly`, finished === N, `finished=${finished}/${N}`);
    for (const { w, b } of games) {
      w.close();
      b.close();
    }
  }

  await mc.close();
  await redis.quit();
  console.log(`\n== result: ${pass} passed, ${fail} failed ==\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("verifier crashed:", e);
  process.exit(2);
});
