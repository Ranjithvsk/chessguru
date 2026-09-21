import { Controller, Get } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";

@Controller("health")
export class HealthController {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  @Get()
  health() {
    return {
      status: "ok",
      service: "chessguru-v2-api",
      db: this.conn.readyState === 1 ? "connected" : "disconnected",
    };
  }
}
