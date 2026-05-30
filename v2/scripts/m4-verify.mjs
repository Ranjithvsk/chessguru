// M4 acceptance: lobby — quick pairing (two strangers seek -> matched, opposite
// colours, can play) and challenge-by-link (create -> accept -> game).
import WebSocket from "ws";
import Redis from "ioredis";

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
  next(pred, ms = 7000) {
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
    this.send({ v: 1, t: "hello", d: token ? { token } : {} });
    await this.next((m) => m.t === "hello-ok");
  }
  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

const clock = { initial: 300000, increment: 3000 }; // 5+3 → blitz

async function main() {
  console.log(`\n== M4 acceptance (lobby) ==\n`);

  // ── quick pairing: two strangers seek → matched ───────────────────────────
  {
    const A = new Client("A");
    const B = new Client("B");
    await A.hello("anna");
    await B.hello("ben");

    A.send({ v: 1, t: "seek", d: { clock, rated: true } });
    const ack = await A.next((m) => m.t === "seek-ack");
    ok("first seeker gets seek-ack (queued)", !!ack.d.seekId);

    B.send({ v: 1, t: "seek", d: { clock, rated: true } });
    const ma = await A.next((m) => m.t === "matched");
    const mb = await B.next((m) => m.t === "matched");
    ok("both seekers matched into the same game", ma.d.game === mb.d.game, `${ma.d.game} vs ${mb.d.game}`);
    ok("opposite colours assigned (waiter white)", ma.d.color === "white" && mb.d.color === "black", `${ma.d.color}/${mb.d.color}`);
    ok("matched carries opponent + clock", ma.d.opponent === "u:ben" && ma.d.clock.initial === 300000, JSON.stringify(ma.d));

    // play through the lobby-created game: both sub, white opens
    const g = ma.d.game;
    A.send({ v: 1, t: "sub", g });
    B.send({ v: 1, t: "sub", g });
    await A.next((m) => m.t === "game-state" && m.g === g && m.d.players.white === "u:anna");
    A.send({ v: 1, t: "move", g, d: { uci: "e2e4", ply: 0 } });
    const mv = await B.next((m) => m.t === "moved" && m.g === g && m.d.uci === "e2e4");
    ok("lobby game is live (white move applied, seated by setup)", mv.d.by === "u:anna" && mv.d.ply === 0, JSON.stringify(mv.d));
    A.close();
    B.close();
  }

  // ── challenge by link: create → accept → game ─────────────────────────────
  {
    const A = new Client("C");
    const B = new Client("D");
    await A.hello("carl");
    await B.hello("dora");

    A.send({ v: 1, t: "challenge", d: { clock, rated: false } });
    const created = await A.next((m) => m.t === "challenge-created");
    ok("challenge created with an id", !!created.d.id);

    B.send({ v: 1, t: "challenge-accept", d: { id: created.d.id } });
    const ma = await A.next((m) => m.t === "matched");
    const mb = await B.next((m) => m.t === "matched");
    ok("challenger + acceptor matched into one game", ma.d.game === mb.d.game);
    ok("challenger is white, acceptor black", ma.d.color === "white" && mb.d.color === "black", `${ma.d.color}/${mb.d.color}`);
    ok("challenge game is casual (rated=false)", ma.d.rated === false, JSON.stringify(ma.d));
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
