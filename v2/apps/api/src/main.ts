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
  // Path-scoped raw body parsers must be mounted BEFORE the global json parser so
  // they win the multi-content-type route match; the global json parser catches
  // everything else. (Prior to explicit mount, /auth/signin was seeing empty
  // bodies after the vision json middleware landed — every login failed with
  // "Please fill in all fields." Fixed 2026-08-10.)
  // Class-recording upload is an application/octet-stream body up to 500MB (~2h of
  // browser MediaRecorder at typical bitrates). Scoped to that ONE endpoint so the
  // default JSON body-parser limits still protect every other route.
  app.use("/api/class/:id/recording", expressLib.raw({ type: "application/octet-stream", limit: "500mb" }));
  // Snap audio clip is a short (<=30s) coach mic recording uploaded alongside
  // the snap FEN. 5MB cap comfortably covers webm/opus at 128kbps for 30s.
  app.use("/api/class/:id/snap/:snapId/audio", expressLib.raw({ type: "application/octet-stream", limit: "5mb" }));
  // Class notes: student's photo of paper reflection. 8 MB cap.
  app.use("/api/class/:id/notes/:noteId/image", expressLib.raw({ type: "application/octet-stream", limit: "8mb" }));
  // Study materials: coach shares PDF/PGN/image/text. 25 MB cap.
  app.use("/api/academy/materials/:id/file", expressLib.raw({ type: "application/octet-stream", limit: "25mb" }));
  // Coach profile image uploads (photo/cover/achievement/trophy/topStudent).
  // Body is raw image bytes (image/*). 8 MB cap. Handles both top-level
  // and :kind/:subId nested paths under the same mount.
  app.use("/api/me/coach-profile/upload", expressLib.raw({ type: "image/*", limit: "8mb" }));
  // Academy profile image uploads (logo/cover/achievement/testimonial). Same
  // shape as coach uploads — raw image bytes, 8 MB cap, both top-level and
  // nested :kind/:subId flow through the same mount.
  app.use("/api/me/academy-profile/upload", expressLib.raw({ type: "image/*", limit: "8mb" }));
  // Excuse doc uploads (parent uploads doctor's note for absent day). Accept
  // images OR PDF, 8 MB cap. Scoped path so global json parser doesn't
  // consume the body first. Owner ask 2026-08-23.
  app.use("/api/academy/attendance/excuse/:studentId/:date", expressLib.raw({
    type: (req: any) => {
      const ct = String(req?.headers?.["content-type"] || "").toLowerCase();
      return ct.startsWith("image/") || ct === "application/pdf";
    },
    limit: "8mb",
  }));
  // Vision endpoints carry base64-encoded PNG board/silhouette payloads.
  // Phone-captured book photos land at 3-6MB. Cap at 12MB so any modern
  // phone image fits.
  app.use("/api/vision", expressLib.json({ limit: "12mb" }));
  // Global JSON + urlencoded parsers for every other route. Explicit — do NOT
  // rely on Nest's built-in default alone; when the /api/vision json mount
  // above was added, Nest's default silently stopped parsing (Express only
  // runs one json parser per request, whichever registered first "wins" the
  // content-type match). Result was every /auth/* login returning "Please
  // fill in all fields." Regression 2026-08-10, fixed same day.
  app.use(expressLib.json({ limit: "1mb" }));
  app.use(expressLib.urlencoded({ extended: true, limit: "1mb" }));
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
  // Per-request cookie-domain override. COOKIE_DOMAIN env is a single value
  // (`.harinitharanjith.com` in prod), but we serve TWO platform hosts +
  // any number of tenant custom domains. Rewrite cookie.domain on every
  // request so Set-Cookie's Domain= actually matches the response's Host —
  // otherwise the browser silently drops the session cookie and the user
  // bounces back to login (owner report 2026-08-22 — gunachess signed in
  // on chessguru.cc, got 201 ok, but /auth/me came back loggedIn:false
  // because the Set-Cookie was scoped to .harinitharanjith.com).
  //
  //   chessguru.cc + subdomains        -> .chessguru.cc         (SSO across brand)
  //   harinitharanjith.com + subs      -> .harinitharanjith.com (legacy SSO)
  //   anything else (gunachess.com,
  //   coach vanity, tenant sub)        -> undefined (host-only)
  const HH_RX = /(^|\.)harinitharanjith\.com$/;
  const CC_RX = /(^|\.)chessguru\.cc$/;
  app.use((req: any, _res: any, next: any) => {
    if (!req?.session?.cookie) return next();
    const host = String(req.hostname || "").toLowerCase();
    if (CC_RX.test(host))      req.session.cookie.domain = ".chessguru.cc";
    else if (HH_RX.test(host)) req.session.cookie.domain = ".harinitharanjith.com";
    else                       req.session.cookie.domain = undefined;
    next();
  });
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
  // Also thread PushService into class-ws so the late-join alert can push
  // the coach's registered devices, not just fire an in-room WS frame.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pushSvc = app.get(require("./push/push.service").PushService, { strict: false });
  attachClassWs(app.getHttpServer(), dbConn as any, pushSvc);
  // From-scratch video (CHESSGURU-VIDEO-FROM-SCRATCH.md P0/P1): relays WebRTC
  // signaling between exactly 2 peers per room. No SFU. P1 adds session-cookie
  // auth via mongo lookup + writes to classAttendance on join/leave, so the
  // handler needs the mongoose connection.
  attachVideoSignalWs(app.getHttpServer(), dbConn as any);
  // eslint-disable-next-line no-console
  console.log(`ChessGuru v2 API on :${port}`);
}
bootstrap();
