import { Body, Controller, Get, Post, Req, UnauthorizedException } from "@nestjs/common";
import { EngineService } from "./engine.service";

@Controller("admin")
export class EngineController {
  constructor(private readonly engine: EngineService) {}

  private requireAuth(req: any) {
    if (!req.session?.userId) throw new UnauthorizedException("login required");
  }

  @Get("queue")
  stats() { return this.engine.stats(); }

  @Post("extract")
  enqueue(@Body() body: any, @Req() req: any) {
    this.requireAuth(req);
    return this.engine.enqueue(Number(body?.limit) || 3);
  }
}
