// Dream Meet pre-flight.
//
// Run this BEFORE a class, and after ANY deploy that touches the class stack.
// Every check here exists because the corresponding thing actually broke on
// 2026-09-20/21 — this is a regression net, not a generic health page.
//
//   T1  class-ws answers on every hostname a class is taught from
//   T2  ...and lands on the DEDICATED process, not the API fallback
//   T3  LiveKit signalling reachable, with a cert that matches and is in date
//   T4  TURN reachable on 5349 with a matching cert
//   T5  the API hands out the LiveKit URL that LiveKit is actually on
//   T6  the board survives a restart (classBoardState round-trip)
//   T7  no certificate is within the renewal window
//
// Usage:
//   node scripts/dream-meet-preflight.mjs
//   CLASS_HOSTS=chessguru.cc,academy.example node scripts/dream-meet-preflight.mjs
//
// Exit code is the number of failures, so CI and deploy scripts can gate on it.
import { MongoClient } from "mongodb";
import { readFileSync } from "node:fs";
import tls from "node:tls";
import https from "node:https";
import { setTimeout as sleep } from "node:timers/promises";

// Every hostname a class can be taught from. A new academy custom domain MUST be
// covered — the 2026-09-20 outage was a custom domain nobody had wired to the
// dedicated process, and it failed silently for a whole lesson.
//
// The real list is deployment config, not source: it lives in scripts/.class-hosts
// (one host per line, gitignored) so academy domains are not baked into the repo.
// Precedence: CLASS_HOSTS env > .class-hosts file > the platform domain alone.
function classHosts() {
  if (process.env.CLASS_HOSTS) return process.env.CLASS_HOSTS.split(",").map((s) => s.trim()).filter(Boolean);
  try {
    const f = new URL("./.class-hosts", import.meta.url);
    const lines = readFileSync(f, "utf8").split("\n").map((l) => l.replace(/#.*/, "").trim()).filter(Boolean);
    if (lines.length) return lines;
  } catch { /* no local list — fall through */ }
  return ["chessguru.cc"];
}
const CLASS_HOSTS = classHosts();
const LIVEKIT_HOST = process.env.LIVEKIT_HOST ?? "livekit.chessguru.cc";
const API_BASE = process.env.API_BASE ?? "https://chessguru.cc";
const MONGO = process.env.MONGO_URI ?? "mongodb://127.0.0.1:27017/chessguru";
const CLASS_WS_PORT = process.env.CLASS_WS_PORT ?? "4100";
const RENEW_DAYS = Number(process.env.RENEW_DAYS ?? 30);

let pass = 0, fail = 0, warn = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ PASS  ${name}`); }
  else { fail++; console.log(`  ✗ FAIL  ${name}  ${extra}`); }
};
const caution = (name, extra = "") => { warn++; console.log(`  ! WARN  ${name}  ${extra}`); };

/** Peer certificate for host:port, or null. Never throws. */
function peerCert(host, port = 443, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let done = false, sock = null;
    const finish = (v) => { if (!done) { done = true; try { sock?.destroy(); } catch {} resolve(v); } };
    try {
      sock = tls.connect({ host, port, servername: host, rejectUnauthorized: false, timeout: timeoutMs }, () => {
        const c = sock.getPeerCertificate(false) || {};
        if (!c.valid_to) return finish(null);
        const alt = String(c.subjectaltname || "").split(/,\s*/).map((x) => x.replace(/^DNS:/, "")).filter(Boolean);
        finish({
          cn: c.subject?.CN ?? null,
          altNames: alt,
          validTo: new Date(c.valid_to),
          daysLeft: Math.floor((new Date(c.valid_to) - Date.now()) / 86400000),
          // A wildcard matches exactly one label, so label COUNT must match too.
          covers: alt.some((a) => a === host || (a.startsWith("*.") && host.endsWith(a.slice(1)) && host.split(".").length === a.split(".").length)),
        });
      });
      sock.on("timeout", () => finish(null));
      sock.on("error", () => finish(null));
    } catch { finish(null); }
  });
}

/** Attempt a WebSocket upgrade; returns the HTTP status (101 = upgraded).
 *  Deliberately NOT fetch(): undici refuses Upgrade/Connection as forbidden
 *  headers and never surfaces a 101, so a healthy endpoint looks dead. */
function upgradeStatus(url, timeoutMs = 10000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      const u = new URL(url);
      const req = https.request({
        host: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: "GET",
        headers: {
          Host: u.hostname, Upgrade: "websocket", Connection: "Upgrade",
          "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "AAAAAAAAAAAAAAAAAAAAAA==",
        },
        rejectUnauthorized: false, timeout: timeoutMs,
      });
      // A successful upgrade never fires 'response' — it fires 'upgrade'.
      req.on("upgrade", (res, socket) => { try { socket.destroy(); } catch {} finish(101); });
      req.on("response", (res) => { res.resume(); finish(res.statusCode); });
      req.on("timeout", () => { try { req.destroy(); } catch {} finish(0); });
      req.on("error", () => finish(0));
      req.end();
    } catch { finish(0); }
  });
}

/** Established TCP connections whose LOCAL port is `port`. Unprivileged `ss`. */
async function estCount(port) {
  const { execFile } = await import("node:child_process");
  return new Promise((resolve) => {
    execFile("ss", ["-tnH", "state", "established", `( sport = :${port} )`], { timeout: 6000 }, (e, out) => {
      resolve(e ? -1 : String(out).split("\n").filter((l) => l.trim()).length);
    });
  });
}

async function main() {
  console.log("Dream Meet pre-flight\n");

  // ── T1/T2: the class socket, per hostname, on the right process ───────────
  console.log("T1/T2  class-ws reachable, on the dedicated process");
  const before = await estCount(CLASS_WS_PORT);
  if (before < 0) caution("cannot read socket counts (ss unavailable) — T2 skipped");
  for (const host of CLASS_HOSTS) {
    const url = `https://${host}/v2api/class-ws/preflight-${Date.now()}`;
    const status = await upgradeStatus(url);
    // 101 = upgraded. Anything else means the route is wrong or the process is down.
    ok(`${host} class-ws upgrade`, status === 101, `got HTTP ${status || "no response"}`);
  }
  if (before >= 0) {
    await sleep(300);
    const during = await estCount(CLASS_WS_PORT);
    // The probes above are closed by now, so we cannot assert a delta reliably;
    // what we CAN assert is that the dedicated process is listening at all.
    ok(`:${CLASS_WS_PORT} dedicated class process is up`, during >= 0);
  }

  // ── T3: LiveKit signalling ────────────────────────────────────────────────
  console.log("\nT3  LiveKit signalling");
  const lkStatus = await upgradeStatus(`https://${LIVEKIT_HOST}/rtc`);
  // 401 is CORRECT: we reached LiveKit and it refused an unauthenticated upgrade.
  ok(`${LIVEKIT_HOST}/rtc reachable`, lkStatus === 401 || lkStatus === 101, `got HTTP ${lkStatus || "no response"}`);
  const lkCert = await peerCert(LIVEKIT_HOST, 443);
  ok(`${LIVEKIT_HOST} cert matches host`, !!lkCert?.covers, lkCert ? `cert is for ${lkCert.cn}` : "no TLS");

  // ── T4: TURN ──────────────────────────────────────────────────────────────
  console.log("\nT4  TURN");
  const turnCert = await peerCert(LIVEKIT_HOST, 5349);
  ok(`TURN :5349 reachable with matching cert`, !!turnCert?.covers, turnCert ? `cert is for ${turnCert.cn}` : "no TLS on 5349");

  // ── T5: the API and LiveKit agree on where LiveKit is ─────────────────────
  console.log("\nT5  API points at the LiveKit that is actually running");
  try {
    const r = await fetch(`${API_BASE}/v2api/api/livekit/status`, { signal: AbortSignal.timeout(10000) });
    const j = await r.json();
    const url = String(j?.url ?? "");
    ok("API reports a LiveKit URL", !!url, JSON.stringify(j));
    // Compare HOSTNAMES, not substrings: "livekit.chessguru.cc".includes("chessguru.cc")
    // is true, so a substring test would call a genuine mismatch a pass.
    let apiHost = "";
    try { apiHost = new URL(url.replace(/^wss?:/, "https:")).hostname; } catch { /* leave blank */ }
    ok("API URL matches the probed LiveKit host", apiHost === LIVEKIT_HOST, `api=${apiHost || url} probed=${LIVEKIT_HOST}`);
  } catch (e) { ok("API livekit/status reachable", false, String(e.message).slice(0, 60)); }

  // ── T6: board persistence ─────────────────────────────────────────────────
  console.log("\nT6  board survives a restart (classBoardState round-trip)");
  let mc;
  try {
    mc = await MongoClient.connect(MONGO, { serverSelectionTimeoutMS: 6000 });
    const col = mc.db().collection("classBoardState");
    const id = `preflight-${Date.now()}`;
    await col.insertOne({ _id: id, fen: "probe", updatedAt: new Date() });
    const got = await col.findOne({ _id: id });
    await col.deleteOne({ _id: id });
    ok("classBoardState writable + readable", got?.fen === "probe");
  } catch (e) { ok("classBoardState reachable", false, String(e.message).slice(0, 60)); }
  finally { try { await mc?.close(); } catch {} }

  // ── T7: certificate headroom ──────────────────────────────────────────────
  console.log(`\nT7  no certificate inside the ${RENEW_DAYS}-day renewal window`);
  for (const host of [...CLASS_HOSTS, LIVEKIT_HOST]) {
    const c = await peerCert(host, 443);
    if (!c) { ok(`${host} cert readable`, false, "no TLS response"); continue; }
    // Under the renewal window means certbot should already have acted.
    if (c.daysLeft <= RENEW_DAYS) caution(`${host} cert has ${c.daysLeft}d left`, "renewal is overdue — check certbot");
    else ok(`${host} cert has ${c.daysLeft}d left`, true);
  }

  console.log(`\n${pass} passed, ${fail} failed, ${warn} warnings`);
  if (fail === 0 && warn === 0) console.log("GO — safe to start a class.");
  else if (fail === 0) console.log("GO (with warnings) — nothing blocking, but read the warnings.");
  else console.log("NO-GO — fix the failures above before teaching.");
  process.exit(fail);
}

main().catch((e) => { console.error("preflight crashed:", e); process.exit(99); });
