import "reflect-metadata";
// Load .env FIRST — before any AppModule import kicks off env-reading providers
// (WeeklyDigestService reads PUBLIC_ORIGIN at import time, PushService reads
// VAPID_* at construction). Falls through silently in dev where the file
// doesn't exist; pm2 env still wins for anything set both places.
// eslint-disable-next-line @typescript-eslint/no-var-requires
try { require("dotenv").config(); } catch { /* dotenv optional in dev */ }
import { NestFactory } from "@nestjs/core";
import { RequestMethod } from "@nestjs/common";
import session from "express-session";
import MongoStore from "connect-mongo";
// express is loaded via require so we don't need @types/express in the api's deps —
// we only reach for one static helper (.raw middleware) here.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const expressLib = require("express");
import { getConnectionToken } from "@nestjs/mongoose";
import type { Connection } from "mongoose";
import { AppModule } from "./app.module";
import { attachClassWs } from "./class/class-ws";
import { attachVideoSignalWs } from "./video/video-signal";

const MONGO_URI = process.env.MONGO_URI ?? "mongodb://localhost:27017/chessguru";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  (app as any).set("trust proxy", 1);
  // API responses are per-user / dynamic — never let the browser cache them.
  // (Stale-cached GETs made me/rating show a logged-out 1500, and puzzles/random
  //  repeat the same puzzle on "next".)
  app.use((_req: any, res: any, next: any) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  // Class-recording upload is an application/octet-stream body up to 500MB (~2h of
  // browser MediaRecorder at typical bitrates). Scoped to that ONE endpoint so the
  // default JSON body-parser limits still protect every other route.
  app.use("/api/class/:id/recording", expressLib.raw({ type: "application/octet-stream", limit: "500mb" }));
  // Snap audio clip is a short (<=30s) coach mic recording uploaded alongside
  // the snap FEN. 5MB cap comfortably covers webm/opus at 128kbps for 30s.
  app.use("/api/class/:id/snap/:snapId/audio", expressLib.raw({ type: "application/octet-stream", limit: "5mb" }));
  // Vision endpoints carry base64-encoded PNG board/silhouette payloads
  // that easily exceed express-json's 100KB default (a 480x480 board PNG
  // is ~300-600KB base64). Cap at 4MB so a coach can't OOM us.
  app.use("/api/vision", expressLib.json({ limit: "4mb" }));
  app.use(
    session({
      // Unique name so it can't collide with the v1 app's connect.sid on this domain
      // (that collision made /api/* requests miss the session -> rating showed 1500).
      name: "cgsid",
      secret: process.env.SESSION_SECRET || "cg_v2_dev_secret_change_me",
      resave: false,
      saveUninitialized: false,
      rolling: true,   // slide the cookie's lifetime forward on every response so an active user never gets logged out mid-use
      store: MongoStore.create({ mongoUrl: MONGO_URI, ttl: 30 * 24 * 60 * 60 }),
      // domain=.harinitharanjith.com => one login shared across harinitharanjith.com + admin.harinitharanjith.com (SSO).
      // Unset (host-only) when COOKIE_DOMAIN is absent, so localhost/dev still works.
      cookie: { path: "/", httpOnly: true, sameSite: "lax", secure: false, maxAge: 30 * 24 * 60 * 60 * 1000, domain: process.env.COOKIE_DOMAIN || undefined },
    }),
  );
  // /api/* everywhere except the /auth/* routes (kept at root to match the client)
  app.setGlobalPrefix("api", {
    exclude: [
      { path: "auth/register", method: RequestMethod.POST },
      { path: "auth/signin", method: RequestMethod.POST },
      { path: "auth/me", method: RequestMethod.GET },
      { path: "auth/logout", method: RequestMethod.POST },
      { path: "auth/request-reset", method: RequestMethod.POST },
      { path: "auth/reset-password", method: RequestMethod.POST },
      { path: "auth/request-otp", method: RequestMethod.POST },
      { path: "auth/otp-signin", method: RequestMethod.POST },
      { path: "auth/signup-academy", method: RequestMethod.POST },
      { path: "auth/invite/:token", method: RequestMethod.GET },
      { path: "auth/accept-invite", method: RequestMethod.POST },
    ],
  });
  app.enableCors({ origin: true, credentials: true });
  const port = process.env.PORT ?? 4000;
  await app.listen(port);
  // Attach the class-ws message bus to the same http.Server Nest is listening on.
  // Nest's http server is created lazily inside listen(), so this must run AFTER.
  // Pass the mongoose connection so the ws handler can persist attendance writes.
  const dbConn = app.get<Connection>(getConnectionToken());
  attachClassWs(app.getHttpServer(), dbConn as any);
  // From-scratch video (CHESSGURU-VIDEO-FROM-SCRATCH.md P0/P1): relays WebRTC
  // signaling between exactly 2 peers per room. No SFU. P1 adds session-cookie
  // auth via mongo lookup + writes to classAttendance on join/leave, so the
  // handler needs the mongoose connection.
  attachVideoSignalWs(app.getHttpServer(), dbConn as any);
  // eslint-disable-next-line no-console
  console.log(`ChessGuru v2 API on :${port}`);
}
bootstrap();
