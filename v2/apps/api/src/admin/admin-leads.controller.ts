import { Body, Controller, ForbiddenException, Get, Header, Param, Patch, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import { isAdmin } from "./admins";
import { AdminLeadsService } from "./admin-leads.service";

/** /api/admin/leads — superadmin only (the vendor's sales list, never an academy's data). */
@Controller()
export class AdminLeadsController {
  constructor(private readonly leads: AdminLeadsService) {}

  private who(req: any): string {
    if (!req.session?.userId) throw new UnauthorizedException("login required");
    if (!isAdmin(req.session.userId)) throw new ForbiddenException("admin only");
    return String(req.session.userId);
  }

  @Get("admin/leads")
  list(@Req() req: any, @Query("status") status?: string, @Query("q") q?: string, @Query("city") city?: string) {
    this.who(req); return this.leads.list({ status, search: q, city });
  }
  @Get("admin/leads/summary")
  summary(@Req() req: any) { this.who(req); return this.leads.summary(); }

  @Get("admin/leads/export.csv")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="chessguru-leads.csv"')
  exportCsv(@Req() req: any) { this.who(req); return this.leads.exportCsv(); }

  @Post("admin/leads/import")
  importRows(@Req() req: any, @Body() body: { rows?: Array<Record<string, string>> }) {
    const by = this.who(req); return this.leads.importRows(Array.isArray(body?.rows) ? body.rows : [], by);
  }
  @Post("admin/leads")
  create(@Req() req: any, @Body() body: Record<string, unknown>) { const by = this.who(req); return this.leads.create(body ?? {}, by); }

  @Get("admin/leads/:id")
  one(@Req() req: any, @Param("id") id: string) { this.who(req); return this.leads.get(id); }
  @Patch("admin/leads/:id")
  update(@Req() req: any, @Param("id") id: string, @Body() body: Record<string, unknown>) { const by = this.who(req); return this.leads.update(id, body ?? {}, by); }
  @Post("admin/leads/:id/activity")
  activity(@Req() req: any, @Param("id") id: string, @Body() body: { kind?: string; text?: string }) { const by = this.who(req); return this.leads.addActivity(id, body ?? {}, by); }
}
