/**
 * chessguru-class-ws — the live-class message bus, in its OWN process.
 *
 * WHY THIS EXISTS
 * The class WebSocket bus used to be attached to the same http.Server Nest
 * listens on (main.ts), with room state in a plain in-memory Map. So restarting
 * the API to ship ANYTHING — a book endpoint, a puzzle fix — tore down every
 * class socket in progress. Owner, 2026-09-10: "ANY CHANGES SHOULD NOT DISTURB
 * LIVE CLASS FOR STUDENTS OR COACH."
 *
 * Video signalling moves with it deliberately. Leaving it on the API would mean
 * an API restart still killed the video half of a live class.
 *
 * WHAT THIS FILE MUST NEVER DO: import AppModule.
 * Eight services in it carry @Cron / setInterval — fee reminders, streak
 * nudges, weekly digests, the abandoned-class sweep. A second copy running here
 * would DOUBLE-SEND to real students and parents. So this wires up by hand
 * instead: one mongoose connection, PushService constructed directly (its only
 * dependency is that connection), a bare http.Server, and the two attach calls.
 *
 * Deliberately has no HTTP routes beyond /health. It is a socket server.
 */
import { createServer } from "http";
import mongoose from "mongoose";
// The API reads apps/api/.env the same way; without this the class process
// would silently fall back to localhost mongo and push-disabled.
// eslint-disable-next-line @typescript-eslint/no-var-requires
// override:true — dotenv does NOT replace a variable pm2 already has, so a
// value in pm2's saved dump silently wins over .env forever. PUBLIC_URL sat
// at https://harinitharanjith.com in the dump while .env said chessguru.cc,
// and every invite and reset link went to the legacy host (found 2026-09-17,
// same trap as DREAMCY_INTERNAL_TOKEN that morning). .env is the source of
// truth; it still only reads at STARTUP, so editing it needs a restart.
try { require("dotenv").config({ override: true }); } catch { /* dotenv optional in dev */ }

import { attachClassWs } from "./class/class-ws";
import { attachVideoSignalWs } from "./video/video-signal";
import { PushService } from "./push/push.service";
import { ErrorReporter } from "./errors/error-reporter";

const MONGO_URI = process.env.MONGO_URI ?? "mongodb://localhost:27017/chessguru";
const PORT = Number(process.env.CLASS_WS_PORT ?? 4100);

async function main() {
  // createConnection, not connect: an explicit handle we pass to the handlers,
  // matching what Nest's getConnectionToken() hands them today.
  const conn = mongoose.createConnection(MONGO_URI);
  await conn.asPromise();
  // eslint-disable-next-line no-console
  console.log("[class-ws] mongo connected");

  // PushService takes exactly one constructor arg — the connection — so it needs
  // no DI container. It reads VAPID keys from env and disables itself if absent.
  const push = new PushService(conn as any);

  // Record + mail realtime failures (board-sync + video-signal). This process
  // runs OFF the API, so without this its errors were swallowed — the owner
  // never learned a live class broke. Reuses the API's errorEvents collection +
  // throttled mailer verbatim via the DI-free ErrorReporter. (Needs
  // DWOTP_INTERNAL_TOKEN in this process's env for the mail leg.)
  const reporter = new ErrorReporter(conn as any);
  await reporter.ensureIndexes();
  process.on("unhandledRejection", (reason: any) => {
    try { reporter.report({ kind: "realtime", route: "class-ws:unhandledRejection", message: reason?.message || String(reason), stack: reason?.stack }); } catch { /* */ }
  });
  process.on("uncaughtException", (err: any) => {
    // Do NOT exit — dropping every live class over one stray throw is worse than
    // continuing. The per-message wraps already contain frame throws with
    // context; this is the last-resort net for async escapes.
    try { reporter.report({ kind: "realtime", route: "class-ws:uncaughtException", message: err?.message || String(err), stack: err?.stack }); } catch { /* */ }
  });

  const server = createServer((req, res) => {
    // A health endpoint so pm2/nginx/a human can tell the process is alive
    // without opening a WebSocket. Everything else here is an upgrade.
    if (req.url === "/health" || req.url === "/") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "class-ws", port: PORT }));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false }));
  });

  attachClassWs(server, conn as any, push, reporter);
  attachVideoSignalWs(server, conn as any, reporter);

  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`ChessGuru class-ws on :${PORT}`);
  });

  // Let in-flight sockets close cleanly on a deliberate restart rather than
  // being severed mid-frame. The client reconnects either way, but a clean
  // close means it reconnects immediately instead of after a timeout.
  const bye = (sig: string) => {
    // eslint-disable-next-line no-console
    console.log(`[class-ws] ${sig} — closing`);
    server.close(() => { void conn.close().finally(() => process.exit(0)); });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGTERM", () => bye("SIGTERM"));
  process.on("SIGINT", () => bye("SIGINT"));
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("[class-ws] failed to start:", e);
  process.exit(1);
});
