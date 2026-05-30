import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { RequestMethod } from "@nestjs/common";
import session from "express-session";
import MongoStore from "connect-mongo";
import { AppModule } from "./app.module";

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
  app.use(
    session({
      // Unique name so it can't collide with the v1 app's connect.sid on this domain
      // (that collision made /api/* requests miss the session -> rating showed 1500).
      name: "cgsid",
      secret: process.env.SESSION_SECRET || "cg_v2_dev_secret_change_me",
      resave: false,
      saveUninitialized: false,
      store: MongoStore.create({ mongoUrl: MONGO_URI, ttl: 30 * 24 * 60 * 60 }),
      cookie: { path: "/", httpOnly: true, sameSite: "lax", secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 },
    }),
  );
  // /api/* everywhere except the /auth/* routes (kept at root to match the client)
  app.setGlobalPrefix("api", {
    exclude: [
      { path: "auth/register", method: RequestMethod.POST },
      { path: "auth/signin", method: RequestMethod.POST },
      { path: "auth/me", method: RequestMethod.GET },
      { path: "auth/logout", method: RequestMethod.POST },
    ],
  });
  app.enableCors({ origin: true, credentials: true });
  const port = process.env.PORT ?? 4000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`ChessGuru v2 API on :${port}`);
}
bootstrap();
