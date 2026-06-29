import { Body, Controller, Get, Post, Req, ForbiddenException } from "@nestjs/common";
import { EngineService } from "./engine.service";
import { isAdmin } from "../admin/admins";

@Controller("admin")
export class EngineController {
  constructor(private readonly engine: EngineService) {}

  private requireAdmin(req: any) {
    if (!isAdmin(req.session?.userId)) throw new ForbiddenException("admin only");
  }

  @Get("queue")
  stats(@Req() req: any) { this.requireAdmin(req); return this.engine.stats(); }

  @Post("extract")
  enqueue(@Body() body: any, @Req() req: any) {
    this.requireAdmin(req);
    return this.engine.enqueue(Number(body?.limit) || 3);
  }
}
