import { Controller, Get, Param, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import { AdminService } from "./admin.service";

@Controller()
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  private requireAuth(req: any) {
    if (!req.session?.userId) throw new UnauthorizedException("login required");
  }

  @Get("status/overview")
  overview() { return this.admin.overview(); }

  @Get("status/distribution")
  distribution() { return this.admin.distribution(); }

  @Get("generated/puzzles")
  generated(@Query("limit") limit = "24") { return this.admin.generated(Math.min(Number(limit) || 24, 100)); }

  @Get("generated/stats")
  generatedStats() { return this.admin.generatedStats(); }

  @Post("generated/puzzles/:id/approve")
  approve(@Param("id") id: string, @Req() req: any) { this.requireAuth(req); return this.admin.approve(id); }

  @Post("generated/puzzles/:id/reject")
  reject(@Param("id") id: string, @Req() req: any) { this.requireAuth(req); return this.admin.reject(id); }
}
