import { Controller, Get, Param, Post, Query, Req, UnauthorizedException, ForbiddenException } from "@nestjs/common";
import { isAdmin } from "./admins";
import { AdminService } from "./admin.service";

@Controller()
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  private requireAuth(req: any) {
    if (!req.session?.userId) throw new UnauthorizedException("login required");
  }

  private requireAdmin(req: any) {
    if (!isAdmin(req.session?.userId)) throw new ForbiddenException("admin only");
  }

  @Get("admin/users")
  users(@Req() req: any) { this.requireAdmin(req); return this.admin.listUsers(); }

  @Get("admin/users/:username")
  userDetail(@Param("username") username: string, @Req() req: any) { this.requireAdmin(req); return this.admin.userDetail(username); }

  @Get("status/overview")
  overview(@Req() req: any) { this.requireAdmin(req); return this.admin.overview(); }

  @Get("status/distribution")
  distribution(@Req() req: any) { this.requireAdmin(req); return this.admin.distribution(); }

  @Get("generated/puzzles")
  generated(@Query("limit") limit = "24", @Req() req: any) { this.requireAdmin(req); return this.admin.generated(Math.min(Number(limit) || 24, 100)); }

  @Get("generated/stats")
  generatedStats(@Req() req: any) { this.requireAdmin(req); return this.admin.generatedStats(); }

  @Post("generated/puzzles/:id/approve")
  approve(@Param("id") id: string, @Req() req: any) { this.requireAdmin(req); return this.admin.approve(id); }

  @Post("generated/puzzles/:id/reject")
  reject(@Param("id") id: string, @Req() req: any) { this.requireAdmin(req); return this.admin.reject(id); }
}
