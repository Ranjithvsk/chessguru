import { UwsSocketServer } from "./socket-server";
import { newRedis } from "./redis";
import { Router } from "./router";

const PORT = Number(process.env.WS_PORT ?? 8080);

const server = new UwsSocketServer();
const router = new Router(server, newRedis(), newRedis());

void router.start(PORT).catch((e) => {
  console.error("[ws] fatal", e);
  process.exit(1);
});
