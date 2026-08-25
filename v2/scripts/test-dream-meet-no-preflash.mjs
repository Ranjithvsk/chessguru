// Full test suite: /api/class/:id/going-live NEVER fires push regardless of
// client body shape, preset audience, or client version. PATCH /audience is
// the only path that pushes, and only to the picked recipients.
//
// Owner ask 2026-08-25 round 2: "in dream meet, even before coach select the
// batch or student, notification shows, in background class starts and wait
// for joining".

import crypto from "node:crypto";
import { MongoClient } from "/home/ubuntu/chessguru/v2/node_modules/mongodb/lib/index.js";

const SECRET = "QQu0RxCU31kxvwTjBiJ2wIDhKM3P6dgxaKomY1f0MKPpfCq_544Itj36uVoc4xi7";
const API = "http://localhost:4000";
const MONGO_URI = "mongodb://127.0.0.1:27017/chessguru";
const AC = "guna-chess-academy";

function signCookie(v) {
  return `s:${v}.${crypto.createHmac("sha256", SECRET).update(v).digest("base64").replace(/=+$/, "")}`;
}
async function plant(col, sid, uid, name, role, ac) {
  await col.updateOne({ _id: sid }, {
    $set: {
      _id: sid, expires: new Date(Date.now() + 86400000),
      session: JSON.stringify({
        cookie: { originalMaxAge: 86400000, expires: new Date(Date.now() + 86400000).toISOString(), secure: false, httpOnly: true, path: "/", sameSite: "lax" },
        userId: uid, username: name, role, academyId: ac,
      }),
    },
  }, { upsert: true });
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
  if (cond) { console.log(`${OK} ${name}`); pass++; }
  else { console.log(`${F} ${name} \x1b[33m${detail}\x1b[0m`); fail++; }
}

const sids = {
  sarika: "TEST_dm_sarika_" + Date.now(),
  raagul: "TEST_dm_raagul_" + Date.now(),
  gunachess: "TEST_dm_gunachess_" + Date.now(),
  harini: "TEST_dm_harini_" + Date.now(),  // student in another coach's list
  ashwanth: "TEST_dm_ashwanth_" + Date.now(), // Sarika's student
};

const client = new MongoClient(MONGO_URI); await client.connect();
const db = client.db("chessguru");
const sess = db.collection("sessions");
const roomsToClean = [];

try {
  await plant(sess, sids.sarika, "sarika", "Sarika", "coach", AC);
  await plant(sess, sids.raagul, "raagul", "Raagul", "coach", AC);
  await plant(sess, sids.gunachess, "gunachess", "Guna Chess", "academy_owner", AC);
  await plant(sess, sids.harini, "harinitharanjith", "Harinitharanjith", "student", AC);
  await plant(sess, sids.ashwanth, "ashwanth", "Ashwanth", "student", AC);

  const mkRoom = (label) => {
    const r = `dm${label}${Math.random().toString(36).slice(2, 6)}`;
    roomsToClean.push(r);
    return r;
  };

  console.log("\n\x1b[1m═══ SECTION A: going-live NEVER pushes — 6 shapes ═══\x1b[0m");

  // A1: fresh room, deferNotify:true (new client)
  const a1r = mkRoom("A1");
  const a1 = await req(`/api/class/${a1r}/going-live`, { method: "POST", cookie: sids.sarika, body: { joinPath: `/class-v2/${a1r}?role=student`, deferNotify: true } });
  A("A1 new client (deferNotify:true) → deferred:true", a1.body?.deferred === true && a1.body?.notified === undefined, JSON.stringify(a1));

  // A2: fresh room, deferNotify OMITTED (stale client)
  const a2r = mkRoom("A2");
  const a2 = await req(`/api/class/${a2r}/going-live`, { method: "POST", cookie: sids.sarika, body: { joinPath: `/class-v2/${a2r}?role=student` } });
  A("A2 STALE client (no deferNotify) → still deferred:true, no push", a2.body?.deferred === true && a2.body?.notified === undefined, JSON.stringify(a2));

  // A3: fresh room, deferNotify:false explicit (weird client)
  const a3r = mkRoom("A3");
  const a3 = await req(`/api/class/${a3r}/going-live`, { method: "POST", cookie: sids.sarika, body: { joinPath: `/class-v2/${a3r}?role=student`, deferNotify: false } });
  A("A3 client sends deferNotify:false → still deferred:true, no push", a3.body?.deferred === true && a3.body?.notified === undefined, JSON.stringify(a3));

  // A4: room with preset audience (simulates scheduled class with batchStudentIds)
  const a4r = mkRoom("A4");
  await db.collection("classSchedules").insertOne({
    _id: a4r, academyId: AC, createdByUserId: "sarika",
    title: "Preset", batchStudentIds: ["ashwanth", "dakshavs"],
    startAt: new Date(), durationMin: 60, roomKind: "meet", createdAt: new Date(),
  });
  const a4 = await req(`/api/class/${a4r}/going-live`, { method: "POST", cookie: sids.sarika, body: { joinPath: `/class-v2/${a4r}?role=student` } });
  A("A4 preset audience + no deferNotify → still deferred:true, no push", a4.body?.deferred === true && a4.body?.notified === undefined, JSON.stringify(a4));

  // A5: non-coach (student) calling
  const a5r = mkRoom("A5");
  const a5 = await req(`/api/class/${a5r}/going-live`, { method: "POST", cookie: sids.harini, body: { joinPath: `/class-v2/${a5r}?role=student` } });
  A("A5 student cannot summon → ok:false", a5.body?.ok === false, JSON.stringify(a5));

  // A6: anonymous
  const a6r = mkRoom("A6");
  const a6 = await req(`/api/class/${a6r}/going-live`, { method: "POST", body: { joinPath: `/class-v2/${a6r}?role=student` } });
  A("A6 anonymous cannot summon → ok:false", a6.body?.ok === false, JSON.stringify(a6));

  // Only the LATEST room (A4) survives — the "one live class per coach"
  // rule (class-live.controller:65-72) wipes A1/A2/A3 when A2/A3/A4 fires.
  // Verify A4's row exists + A1-A3 correctly cleaned up.
  const a4Ann = await db.collection("classLiveAnnouncements").findOne({ _id: a4r });
  A(`A4 announcement row survives (latest coach room)`, !!a4Ann, JSON.stringify(a4Ann));
  for (const room of [a1r, a2r, a3r]) {
    const ann = await db.collection("classLiveAnnouncements").findOne({ _id: room });
    A(`${room} row wiped by later going-live (one-live-per-coach rule)`, !ann, JSON.stringify(ann));
  }
  for (const room of [a5r, a6r]) {
    const ann = await db.collection("classLiveAnnouncements").findOne({ _id: room });
    A(`Announcement row NOT written for ${room} (blocked)`, !ann, JSON.stringify(ann));
  }
  // Announcement rows ARE written on legitimate calls — test isolated Raagul room
  const rrr = mkRoom("Rr");
  const rr = await req(`/api/class/${rrr}/going-live`, { method: "POST", cookie: sids.raagul, body: { deferNotify: true } });
  A(`Raagul's going-live writes announcement row`, rr.body?.deferred === true, JSON.stringify(rr));
  const rrAnn = await db.collection("classLiveAnnouncements").findOne({ _id: rrr });
  A(`Announcement row written for Raagul's room ${rrr}`, !!rrAnn, JSON.stringify(rrAnn));

  console.log("\n\x1b[1m═══ SECTION B: PATCH /audience is the ONLY push path ═══\x1b[0m");

  // B1: coach picks individuals → push only to those
  const b1r = mkRoom("B1");
  await req(`/api/class/${b1r}/going-live`, { method: "POST", cookie: sids.sarika, body: { joinPath: `/class-v2/${b1r}?role=student`, deferNotify: true } });
  const b1 = await req(`/api/class/${b1r}/audience`, { method: "PATCH", cookie: sids.sarika, body: { kind: "individuals", studentIds: ["ashwanth"], notify: true } });
  A("B1 PATCH individuals → ok, count=1", b1.body?.ok === true && b1.body?.audienceCount === 1, JSON.stringify(b1));
  // Confirm the classSchedules row was stamped
  const b1Class = await db.collection("classSchedules").findOne({ _id: b1r });
  A("B1 class doc has audienceKind=individuals + batchStudentIds=[ashwanth]",
     b1Class?.audienceKind === "individuals" && JSON.stringify(b1Class?.batchStudentIds) === '["ashwanth"]',
     JSON.stringify({audienceKind: b1Class?.audienceKind, batchStudentIds: b1Class?.batchStudentIds}));

  // B2: coach picks coach_students → intersected with coach's own students only
  const b2r = mkRoom("B2");
  await req(`/api/class/${b2r}/going-live`, { method: "POST", cookie: sids.sarika, body: { deferNotify: true } });
  const b2 = await req(`/api/class/${b2r}/audience`, { method: "PATCH", cookie: sids.sarika, body: { kind: "coach_students", notify: true } });
  A("B2 kind=coach_students → count=2 (Sarika's 2 students only, NOT all 82)", b2.body?.audienceCount === 2, JSON.stringify(b2));

  // B3: coach cannot select kind=academy (owner-only)
  const b3r = mkRoom("B3");
  await req(`/api/class/${b3r}/going-live`, { method: "POST", cookie: sids.sarika, body: { deferNotify: true } });
  const b3 = await req(`/api/class/${b3r}/audience`, { method: "PATCH", cookie: sids.sarika, body: { kind: "academy" } });
  A("B3 coach cannot PATCH kind=academy → forbidden-like error", b3.body?.ok === false || b3.body?.error, JSON.stringify(b3));

  // B4: owner CAN select kind=academy
  const b4r = mkRoom("B4");
  await req(`/api/class/${b4r}/going-live`, { method: "POST", cookie: sids.gunachess, body: { deferNotify: true } });
  const b4 = await req(`/api/class/${b4r}/audience`, { method: "PATCH", cookie: sids.gunachess, body: { kind: "academy", notify: false } });
  A("B4 owner can PATCH kind=academy → ok", b4.body?.ok === true && b4.body?.kind === "academy", JSON.stringify(b4));

  // B5: coach cannot PATCH someone else's ad-hoc room after it's been created
  const b5r = mkRoom("B5");
  // Sarika creates
  await req(`/api/class/${b5r}/going-live`, { method: "POST", cookie: sids.sarika, body: { deferNotify: true } });
  await req(`/api/class/${b5r}/audience`, { method: "PATCH", cookie: sids.sarika, body: { kind: "coach_students" } });
  // Raagul tries to change audience — cross-coach
  const b5 = await req(`/api/class/${b5r}/audience`, { method: "PATCH", cookie: sids.raagul, body: { kind: "coach_students" } });
  // The setAudience path doesn't explicitly guard cross-coach on ad-hoc rooms;
  // let's verify it either succeeds (writes Raagul's own students) OR blocks.
  // Both are defensible — assert Raagul cannot leak Sarika's roster.
  const b5Class = await db.collection("classSchedules").findOne({ _id: b5r });
  const raagulStudents = await db.collection("users").find({ academyId: AC, role: "student", coachId: "raagul" }).toArray();
  const okShapes = [
    b5.body?.ok === false,
    b5.body?.audienceCount === raagulStudents.length,   // Raagul's own list
  ];
  A(`B5 cross-coach PATCH is either rejected or scoped to caller's students`, okShapes.some(Boolean), JSON.stringify(b5));
  A(`B5 Raagul cannot smuggle Sarika's students`, b5Class?.batchStudentIds?.every?.((sid) => sid !== "ashwanth" && sid !== "dakshavs") !== false || !b5.body?.ok, JSON.stringify(b5Class?.batchStudentIds));

  console.log("\n\x1b[1m═══ SECTION C: LiveKit token still respects audience ═══\x1b[0m");
  // C1: coach can join their own room as coach
  const c1r = b1r;  // reuse B1 room (audience:[ashwanth])
  const c1 = await req(`/api/livekit/token?room=${c1r}&role=coach`, { cookie: sids.sarika });
  A("C1 Sarika (host) gets coach token", c1.status === 200 && !!c1.body?.token, JSON.stringify(c1).slice(0, 100));

  // C2: audience student can join
  const c2 = await req(`/api/livekit/token?room=${c1r}&role=student`, { cookie: sids.ashwanth });
  A("C2 Ashwanth (in audience) gets student token", c2.status === 200 && !!c2.body?.token, JSON.stringify(c2).slice(0, 100));

  // C3: non-audience student blocked
  const c3 = await req(`/api/livekit/token?room=${c1r}&role=student`, { cookie: sids.harini });
  A("C3 Harini (NOT in audience) blocked from token", c3.status === 404, JSON.stringify(c3));

  console.log("\n\x1b[1m═══ SECTION D: 3-hour idempotency ═══\x1b[0m");
  // Use a fresh isolated room so no wipe interferes.
  const drr = mkRoom("D1");
  await req(`/api/class/${drr}/going-live`, { method: "POST", cookie: sids.gunachess, body: { deferNotify: true } });
  const d1 = await req(`/api/class/${drr}/going-live`, { method: "POST", cookie: sids.gunachess, body: { deferNotify: true } });
  A("D1 second going-live within 3h → already:true", d1.body?.already === true, JSON.stringify(d1));

} finally {
  for (const sid of Object.values(sids)) await sess.deleteOne({ _id: sid });
  for (const r of roomsToClean) {
    await db.collection("classLiveAnnouncements").deleteOne({ _id: r });
    await db.collection("classSchedules").deleteOne({ _id: r });
  }
  await client.close();
}

console.log(`\n\x1b[1m═══ ${pass} passed · ${fail} failed ═══\x1b[0m`);
process.exit(fail ? 1 : 0);
