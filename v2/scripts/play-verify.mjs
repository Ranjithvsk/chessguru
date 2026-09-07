// Play acceptance: identity, abort, presence/claim, reconnect, second tab.
// Run via scripts/run-play-test.sh (private redis + mongo db; see there).
import WebSocket from "ws";
import Redis from "ioredis";
import { MongoClient } from "mongodb";
import { setTimeout as sleep } from "node:timers/promises";

const GW = process.env.GW ?? "ws://127.0.0.1:18090/ws";
const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6390";
const MONGO = process.env.MONGO_URI ?? "mongodb://127.0.0.1:27017/chessguru_playtest";
const TC = { initial: 60000, increment: 0 }; // 1+0 → 15s grace

let pass = 0;
let fail = 0;
function check(name, ok, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

class Client {
  constructor(name, opts = {}) {
    this.name = name;
    this.opts = opts;
    this.msgs = [];
    this.waiters = [];
  }
  connect() {
    return new Promise((res, rej) => {
      const headers = this.opts.cookie ? { cookie: this.opts.cookie } : {};
      this.ws = new WebSocket(GW, { headers });
      this.ws.on("open", res);
      this.ws.on("error", rej);
      this.ws.on("message", (raw) => {
        const m = JSON.parse(raw.toString());
        this.msgs.push(m);
        this.waiters = this.waiters.filter((w) => !w(m));
      });
    });
  }
  send(m) {
    this.ws.send(JSON.stringify(m));
  }
  next(pred, ms = 8000) {
    const hit = this.msgs.find(pred);
    if (hit) return Promise.resolve(hit);
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`${this.name}: timeout waiting`)), ms);
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
  async hello(d = {}) {
    await this.connect();
    this.send({ v: 1, t: "hello", d });
    const ok = await this.next((m) => m.t === "hello-ok");
    this.id = ok.d.userId;
    return ok.d.userId;
  }
  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

const rid = () => Math.random().toString(36).slice(2, 8);

/** Two guests seek the same 1+0 pool and get paired with each other. */
async function pairGuests() {
  const a = new Client("A");
  const b = new Client("B");
  await a.hello({ guest: `va_${rid()}` });
  await b.hello({ guest: `vb_${rid()}` });
  a.send({ v: 1, t: "seek", d: { clock: TC, rated: false } });
  await a.next((m) => m.t === "seek-ack");
  b.send({ v: 1, t: "seek", d: { clock: TC, rated: false } });
  const ma = await a.next((m) => m.t === "matched");
  const mb = await b.next((m) => m.t === "matched");
  const g = ma.d.game;
  a.send({ v: 1, t: "sub", g });
  b.send({ v: 1, t: "sub", g });
  await a.next((m) => m.t === "game-state" && m.g === g);
  await b.next((m) => m.t === "game-state" && m.g === g);
  const white = ma.d.color === "white" ? a : b;
  const black = white === a ? b : a;
  return { a, b, g, white, black, colorOf: (c) => (c === a ? ma.d.color : mb.d.color) };
}

async function playTwo(g, white, black) {
  white.send({ v: 1, t: "move", g, d: { uci: "e2e4", ply: 0 } });
  await black.next((m) => m.t === "moved" && m.g === g && m.d.uci === "e2e4");
  black.send({ v: 1, t: "move", g, d: { uci: "e7e5", ply: 1 } });
  await white.next((m) => m.t === "moved" && m.g === g && m.d.uci === "e7e5");
}

async function main() {
  console.log(`\n== Play acceptance: identity / abort / claim / reconnect ==\n`);
  const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  const mc = new MongoClient(MONGO);
  await mc.connect();
  const db = mc.db();

  // ── T1 identity ──────────────────────────────────────────────────────────
  console.log("T1 identity is the session cookie, never the client's word");
  {
    const forged = new Client("forged");
    const id = await forged.hello({ token: "ranjith_vsk" });
    check("hello.token is ignored in production mode", id.startsWith("g:") && !id.includes("ranjith"), id);
    forged.close();

    const guest = new Client("guest");
    const gid = await guest.hello({ guest: "visitor_1" });
    check("signed-out guest gets the g: namespace", gid === "g:visitor_1", gid);
    guest.close();

    const nasty = new Client("nasty");
    const nid = await nasty.hello({ guest: "u:ranjith_vsk" });
    check("a guest cannot smuggle a u: prefix", nid === "g:uranjith_vsk", nid);
    nasty.close();

    const sid = `e2e${rid()}${rid()}${rid()}${rid()}`;
    await db.collection("sessions").insertOne({ _id: sid, expires: new Date(Date.now() + 3600_000), session: JSON.stringify({ cookie: {}, userId: "e2e_ident", username: "E2E" }) });
    const signed = new Client("signed", { cookie: `cgsid=s%3A${sid}.notchecked; other=1` });
    const uid = await signed.hello({ token: "someone_else", guest: "someone_else" });
    check("a live cgsid session seats the real account", uid === "u:e2e_ident", uid);
    signed.close();

    const dead = new Client("dead", { cookie: `cgsid=s%3Anope${rid()}${rid()}${rid()}.x` });
    const did = await dead.hello({});
    check("an unknown sid falls back to guest", did.startsWith("g:"), did);
    dead.close();

    const key = await redis.get("play:bot:key");
    check("gateway minted play:bot:key in redis", !!key && key.length > 20);
    const bot = new Client("bot");
    const bid = await bot.hello({ bot: { name: "manoj_raman", key } });
    check("bot with the shared key is seated as u:<name>", bid === "u:manoj_raman", bid);
    bot.close();
    const fake = new Client("fakebot");
    const fid = await fake.hello({ bot: { name: "manoj_raman", key: "wrong" } });
    check("bot with a wrong key is a guest", fid.startsWith("g:"), fid);
    fake.close();
  }

  // ── T2 abort ─────────────────────────────────────────────────────────────
  console.log("T2 abort before both have moved");
  {
    const { a, b, g, white, black } = await pairGuests();
    white.send({ v: 1, t: "move", g, d: { uci: "d2d4", ply: 0 } });
    await black.next((m) => m.t === "moved" && m.g === g);
    black.send({ v: 1, t: "abort", g });
    const ea = await a.next((m) => m.t === "game-end" && m.g === g);
    const eb = await b.next((m) => m.t === "game-end" && m.g === g);
    check("both sides get game-end aborted after one move", ea.d.reason === "aborted" && eb.d.reason === "aborted" && ea.d.result === "*");
    await sleep(300);
    const row = await db.collection("live_games").findOne({ _id: g });
    check("an aborted game is not archived", !row);
    a.close();
    b.close();

    const s2 = await pairGuests();
    await playTwo(s2.g, s2.white, s2.black);
    s2.a.send({ v: 1, t: "abort", g: s2.g });
    const err = await s2.a.next((m) => m.t === "error" && m.g === s2.g);
    check("abort after two moves is refused", err.d.code === "too-late", err.d.code);
    s2.a.close();
    s2.b.close();
  }

  // ── T3 presence + claim ──────────────────────────────────────────────────
  console.log("T3 opponent vanishes → presence → claim after grace");
  {
    const { a, b, g, white, black, colorOf } = await pairGuests();
    await playTwo(g, white, black);
    const t0 = Date.now();
    a.close();
    const pres = await b.next((m) => m.t === "presence" && m.g === g && !m.d.online);
    check("B is told A went offline", pres.d.color === colorOf(a));
    check("claimableAt ≈ now + 15s for 1+0", pres.d.claimableAt - t0 > 13000 && pres.d.claimableAt - t0 < 17000, `${pres.d.claimableAt - t0}ms`);
    b.send({ v: 1, t: "claim", g });
    const early = await b.next((m) => m.t === "error" && m.g === g);
    check("claim inside the grace period is refused", early.d.code === "not-claimable", early.d.code);
    await sleep(pres.d.claimableAt - Date.now() + 300);
    b.send({ v: 1, t: "claim", g });
    const end = await b.next((m) => m.t === "game-end" && m.g === g);
    const bWins = colorOf(b) === "white" ? "1-0" : "0-1";
    check("claim after grace ends the game as abandoned, B wins", end.d.reason === "abandoned" && end.d.result === bWins, `${end.d.reason} ${end.d.result}`);
    await sleep(300);
    const row = await db.collection("live_games").findOne({ _id: g });
    check("abandoned game is archived with status abandoned", row?.status === "abandoned" && row?.result === bWins);
    b.close();
  }

  // ── T4 reconnect inside grace clears presence ─────────────────────────────
  console.log("T4 the player comes back before the grace runs out");
  {
    const { a, b, g, white, black, colorOf } = await pairGuests();
    await playTwo(g, white, black);
    const guestName = a.id.slice(2);
    a.close();
    await b.next((m) => m.t === "presence" && m.g === g && !m.d.online);
    const a2 = new Client("A2");
    const id2 = await a2.hello({ guest: guestName });
    check("same guest id after reconnect", id2 === a.id, id2);
    a2.send({ v: 1, t: "resync", g, d: { havePly: 2 } });
    const st = await a2.next((m) => m.t === "game-state" && m.g === g);
    check("resync returns the live position with both moves", st.d.ply === 2 && st.d.status === "playing" && st.d.players[colorOf(a)] === a.id);
    const back = await b.next((m) => m.t === "presence" && m.g === g && m.d.online);
    check("B is told A is back", back.d.color === colorOf(a) && back.d.claimableAt === null);
    b.send({ v: 1, t: "claim", g });
    const err = await b.next((m) => m.t === "error" && m.g === g);
    check("claim against a present opponent is refused", err.d.code === "not-claimable", err.d.code);
    // A moves on after coming back (ply 2 = white's move)
    const mover = colorOf(a) === "white" ? a2 : null;
    if (mover) {
      mover.send({ v: 1, t: "move", g, d: { uci: "g1f3", ply: 2 } });
      const mv = await b.next((m) => m.t === "moved" && m.g === g && m.d.ply === 2);
      check("the returning player can keep playing", mv.d.uci === "g1f3");
    } else {
      check("the returning player can keep playing (skipped: not on move)", true);
    }
    a2.close();
    b.close();
  }

  // ── T5 second tab keeps the player present ────────────────────────────────
  console.log("T5 closing one of two tabs is not leaving");
  {
    const { a, b, g, white, black } = await pairGuests();
    await playTwo(g, white, black);
    const tab2 = new Client("A-tab2");
    await tab2.hello({ guest: a.id.slice(2) });
    tab2.send({ v: 1, t: "sub", g });
    await tab2.next((m) => m.t === "game-state" && m.g === g);
    const before = b.msgs.filter((m) => m.t === "presence").length;
    tab2.close();
    await sleep(800);
    const after = b.msgs.filter((m) => m.t === "presence").length;
    check("no offline presence while the first tab is still open", after === before, `${after - before} presence msgs`);
    a.close();
    const gone = await b.next((m) => m.t === "presence" && m.g === g && !m.d.online);
    check("offline presence once the last tab closes", !!gone);
    b.close();
  }

  // ── T6 cancel seek ────────────────────────────────────────────────────────
  console.log("T6 unseek removes the seek");
  {
    const a = new Client("A");
    await a.hello({ guest: `vc_${rid()}` });
    a.send({ v: 1, t: "seek", d: { clock: TC, rated: false } });
    await a.next((m) => m.t === "seek-ack");
    a.send({ v: 1, t: "unseek" });
    await sleep(300);
    const pool = await redis.zcard("seek:pool:60000-0:0");
    check("pool is empty after unseek", pool === 0, `${pool} seeks`);
    a.close();
  }

  await db.dropDatabase();
  await mc.close();
  redis.disconnect();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("verifier crashed:", e);
  process.exit(2);
});
