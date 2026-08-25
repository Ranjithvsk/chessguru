// Verify: /api/class/live-now HIDES rooms from students until the coach
// picks audience. Coach + owner see everything (supervision).

import crypto from "node:crypto";
import { MongoClient } from "/home/ubuntu/chessguru/v2/node_modules/mongodb/lib/index.js";

const SECRET = "QQu0RxCU31kxvwTjBiJ2wIDhKM3P6dgxaKomY1f0MKPpfCq_544Itj36uVoc4xi7";
const API = "http://localhost:4000";
const MONGO_URI = "mongodb://127.0.0.1:27017/chessguru";
const AC = "guna-chess-academy";

function signCookie(v) { return `s:${v}.${crypto.createHmac("sha256", SECRET).update(v).digest("base64").replace(/=+$/, "")}`; }
async function plant(col, sid, uid, name, role, ac) {
  await col.updateOne({ _id: sid }, { $set: {
    _id: sid, expires: new Date(Date.now() + 86400000),
    session: JSON.stringify({
      cookie: { originalMaxAge: 86400000, expires: new Date(Date.now() + 86400000).toISOString(), secure: false, httpOnly: true, path: "/", sameSite: "lax" },
      userId: uid, username: name, role, academyId: ac,
    }),
  } }, { upsert: true });
}
async function req(path, opts = {}) {
  const h = new Headers(opts.headers || {});
  if (opts.cookie) h.set("cookie", `cgsid=${encodeURIComponent(signCookie(opts.cookie))}`);
  if (opts.body) h.set("content-type", "application/json");
  const r = await fetch(`${API}${path}`, { method: opts.method || "GET", headers: h, body: opts.body ? JSON.stringify(opts.body) : undefined });
  let j = null; try { j = await r.json(); } catch { /* not json */ }
  return { status: r.status, body: j };
}

const OK = "\x1b[32m✓\x1b[0m", F = "\x1b[31m✗\x1b[0m";
let pass = 0, fail = 0;
function A(name, cond, detail = "") {
  if (cond) { console.log(`${OK} ${name}`); pass++; } else { console.log(`${F} ${name} \x1b[33m${detail}\x1b[0m`); fail++; }
}

const sids = {
  sarika: "TEST_ln_sarika_" + Date.now(),
  gunachess: "TEST_ln_gunachess_" + Date.now(),
  ashwanth: "TEST_ln_ash_" + Date.now(),
  harini: "TEST_ln_har_" + Date.now(),
};
const client = new MongoClient(MONGO_URI); await client.connect();
const db = client.db("chessguru");
const sess = db.collection("sessions");
const rooms = [];

try {
  await plant(sess, sids.sarika, "sarika", "Sarika", "coach", AC);
  await plant(sess, sids.gunachess, "gunachess", "Guna Chess", "academy_owner", AC);
  await plant(sess, sids.ashwanth, "ashwanth", "Ashwanth", "student", AC);
  await plant(sess, sids.harini, "harinitharanjith", "Harinitharanjith", "student", AC);

  const room = "lnhide" + Math.random().toString(36).slice(2, 6);
  rooms.push(room);
  await db.collection("classSchedules").deleteOne({ _id: room });
  await db.collection("classLiveAnnouncements").deleteOne({ _id: room });

  // ── STAGE 1: coach clicks Dream Meet — going-live fires with deferNotify:true
  await req(`/api/class/${room}/going-live`, {
    method: "POST", cookie: sids.sarika,
    body: { joinPath: `/class-v2/${room}?role=student`, deferNotify: true },
  });

  console.log("\n\x1b[1m═══ STAGE 1: coach opened, audience NOT picked yet ═══\x1b[0m");
  const s1Ash = await req("/api/class/live-now", { cookie: sids.ashwanth });
  const s1Har = await req("/api/class/live-now", { cookie: sids.harini });
  const s1Owner = await req("/api/class/live-now", { cookie: sids.gunachess });
  const s1Sarika = await req("/api/class/live-now", { cookie: sids.sarika });

  const ashSees1 = (s1Ash.body?.live || []).some((c) => c._id === room);
  const harSees1 = (s1Har.body?.live || []).some((c) => c._id === room);
  const ownerSees1 = (s1Owner.body?.live || []).some((c) => c._id === room);
  const sarikaSees1 = (s1Sarika.body?.live || []).some((c) => c._id === room);

  A("Student (Sarika's own) does NOT see room before audience picked", !ashSees1, `ashwanth got: ${JSON.stringify(s1Ash.body).slice(0, 200)}`);
  A("Student (other coach's) does NOT see room before audience picked", !harSees1, `harini got: ${JSON.stringify(s1Har.body).slice(0, 200)}`);
  A("Owner DOES see room (supervision)", ownerSees1, `gunachess got: ${JSON.stringify(s1Owner.body).slice(0, 200)}`);
  A("Sarika (hosting coach) DOES see her own room", sarikaSees1, `sarika got: ${JSON.stringify(s1Sarika.body).slice(0, 200)}`);

  // ── STAGE 2: coach picks audience — only ashwanth
  console.log("\n\x1b[1m═══ STAGE 2: coach picks audience → [ashwanth] ═══\x1b[0m");
  await req(`/api/class/${room}/audience`, {
    method: "PATCH", cookie: sids.sarika,
    body: { kind: "individuals", studentIds: ["ashwanth"], notify: false },
  });

  const s2Ash = await req("/api/class/live-now", { cookie: sids.ashwanth });
  const s2Har = await req("/api/class/live-now", { cookie: sids.harini });
  const ashSees2 = (s2Ash.body?.live || []).some((c) => c._id === room);
  const harSees2 = (s2Har.body?.live || []).some((c) => c._id === room);

  A("Ashwanth (in audience) now SEES the room", ashSees2, `ashwanth: ${JSON.stringify(s2Ash.body).slice(0, 200)}`);
  A("Harini (NOT in audience) still does NOT see it", !harSees2, `harini: ${JSON.stringify(s2Har.body).slice(0, 200)}`);

  // ── STAGE 3: coach changes audience to coach_students → 2 students
  console.log("\n\x1b[1m═══ STAGE 3: coach expands audience to all their students ═══\x1b[0m");
  await req(`/api/class/${room}/audience`, {
    method: "PATCH", cookie: sids.sarika,
    body: { kind: "coach_students", notify: false },
  });
  const s3Ash = await req("/api/class/live-now", { cookie: sids.ashwanth });
  A("Ashwanth still sees room (still in coach_students)", (s3Ash.body?.live || []).some((c) => c._id === room), JSON.stringify(s3Ash.body).slice(0, 200));

} finally {
  for (const s of Object.values(sids)) await sess.deleteOne({ _id: s });
  for (const r of rooms) {
    await db.collection("classSchedules").deleteOne({ _id: r });
    await db.collection("classLiveAnnouncements").deleteOne({ _id: r });
  }
  await client.close();
}
console.log(`\n\x1b[1m${pass} passed · ${fail} failed\x1b[0m`);
process.exit(fail ? 1 : 0);
