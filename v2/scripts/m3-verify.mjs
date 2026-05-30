// M3 acceptance: game flow + rating + reconnect.
// 1) rated game adjusts both players' Glicko ratings (persisted)
// 2) draw offer/accept ends the game by agreement
// 3) a player can disconnect mid-game and reconnect (resume their seat + move)
// 4) rematch spawns a new game with colours swapped
import WebSocket from "ws";
import Redis from "ioredis";
import { MongoClient } from "mongodb";

const WS_URL = process.env.WS_URL ?? "ws://127.0.0.1:18080/ws";
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

async function seat(g, clock, rated = true) {
  const A = new Client("W");
  const B = new Client("B");
  await A.hello("alice");
  await B.hello("bob");
  A.send({ v: 1, t: "create", g, d: { clock, rated } });
  await A.next((m) => m.t === "game-state" && m.g === g);
  A.send({ v: 1, t: "join", g });
  await A.next((m) => m.t === "joined" && m.g === g);
  B.send({ v: 1, t: "join", g });
  await B.next((m) => m.t === "joined" && m.g === g);
  return { A, B };
}

async function main() {
  console.log(`\n== M3 acceptance (flow + rating + reconnect) ==\n`);
  const mc = new MongoClient(MONGO);
  await mc.connect();
  const perfs = mc.db().collection("live_perfs");

  // ── G1: rated game → Glicko adjusts both ratings ──────────────────────────
  {
    const g = "m3rate-" + rid();
    const { A, B } = await seat(g, { initial: 300000, increment: 0 }, true); // 5+0 → blitz
    A.send({ v: 1, t: "move", g, d: { uci: "f2f3", ply: 0 } });
    await A.next(moved(g, "f2f3"));
    B.send({ v: 1, t: "move", g, d: { uci: "e7e5", ply: 1 } });
    await B.next(moved(g, "e7e5"));
    A.send({ v: 1, t: "move", g, d: { uci: "g2g4", ply: 2 } });
    await A.next(moved(g, "g2g4"));
    B.send({ v: 1, t: "move", g, d: { uci: "d8h4", ply: 3 } }); // mate, black wins
    const end = await B.next((m) => m.t === "game-end" && m.g === g);
    ok("G1 rated mate carries ratingDiff", !!end.d.ratingDiff, JSON.stringify(end.d));
    ok("G1 loser (white) loses rating, winner (black) gains", end.d.ratingDiff && end.d.ratingDiff.white < 0 && end.d.ratingDiff.black > 0, JSON.stringify(end.d.ratingDiff));
    const pa = await perfs.findOne({ _id: "u:alice" });
    const pb = await perfs.findOne({ _id: "u:bob" });
    ok("G1 both ratings persisted (live_perfs.blitz, nb≥1)", pa?.blitz?.nb >= 1 && pb?.blitz?.nb >= 1 && pa.blitz.gl.r < 1500 && pb.blitz.gl.r > 1500, JSON.stringify({ a: pa?.blitz?.gl?.r, b: pb?.blitz?.gl?.r }));
    A.close();
    B.close();
  }

  // ── G2: draw offer / accept ───────────────────────────────────────────────
  {
    const g = "m3draw-" + rid();
    const { A, B } = await seat(g, { initial: 300000, increment: 0 }, true);
    A.send({ v: 1, t: "move", g, d: { uci: "e2e4", ply: 0 } });
    await A.next(moved(g, "e2e4"));
    A.send({ v: 1, t: "draw-offer", g });
    const offer = await B.next((m) => m.t === "offer" && m.g === g);
    ok("G2 opponent sees draw offer (by white)", offer.d.kind === "draw" && offer.d.by === "white", JSON.stringify(offer.d));
    B.send({ v: 1, t: "draw-accept", g });
    const end = await B.next((m) => m.t === "game-end" && m.g === g);
    ok("G2 draw-accept ends game (1/2-1/2 / agreement)", end.d.result === "1/2-1/2" && end.d.reason === "agreement", JSON.stringify(end.d));
    A.close();
    B.close();
  }

  // ── G3: disconnect mid-game, reconnect, resume the seat + move ────────────
  {
    const g = "m3recon-" + rid();
    const { A, B } = await seat(g, { initial: 300000, increment: 0 }, true);
    A.send({ v: 1, t: "move", g, d: { uci: "e2e4", ply: 0 } });
    await B.next(moved(g, "e2e4"));
    B.send({ v: 1, t: "move", g, d: { uci: "e7e5", ply: 1 } });
    await B.next(moved(g, "e7e5"));
    A.close(); // white drops

    const A2 = new Client("W2");
    await A2.hello("alice"); // same user
    A2.send({ v: 1, t: "join", g });
    const j = await A2.next((m) => m.t === "joined" && m.g === g);
    ok("G3 reconnecting user resumes white seat", j.d.seat === "white", JSON.stringify(j.d));
    const st = await A2.next((m) => m.t === "game-state" && m.g === g);
    ok("G3 resync shows live position (2 moves played)", st.d.ply === 2 && st.d.moves.length === 2, JSON.stringify({ ply: st.d.ply }));
    A2.send({ v: 1, t: "move", g, d: { uci: "g1f3", ply: 2 } });
    const mv = await A2.next(moved(g, "g1f3"));
    ok("G3 reconnected client can move (game continued)", mv.d.ply === 2, JSON.stringify(mv.d));
    A2.close();
    B.close();
  }

  // ── G4: rematch spawns a colour-swapped game ──────────────────────────────
  {
    const g = "m3rem-" + rid();
    const { A, B } = await seat(g, { initial: 300000, increment: 0 }, true);
    A.send({ v: 1, t: "resign", g }); // white resigns → game over
    await A.next((m) => m.t === "game-end" && m.g === g);
    A.send({ v: 1, t: "rematch", g });
    B.send({ v: 1, t: "rematch", g });
    const ready = await B.next((m) => m.t === "rematch-ready" && m.g === g);
    ok("G4 rematch-ready with swapped colours", ready.d.white === "u:bob" && ready.d.black === "u:alice", JSON.stringify(ready.d));
    const ng = ready.d.game;
    A.send({ v: 1, t: "join", g: ng });
    const ja = await A.next((m) => m.t === "joined" && m.g === ng);
    B.send({ v: 1, t: "join", g: ng });
    await B.next((m) => m.t === "joined" && m.g === ng);
    ok("G4 alice is black in the rematch", ja.d.seat === "black", JSON.stringify(ja.d));
    B.send({ v: 1, t: "move", g: ng, d: { uci: "e2e4", ply: 0 } }); // bob (now white) opens
    const mv = await B.next(moved(ng, "e2e4"));
    ok("G4 rematch game is live (move applied)", mv.d.ply === 0, JSON.stringify(mv.d));
    A.close();
    B.close();
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
