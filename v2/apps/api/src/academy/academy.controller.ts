// Owner-only endpoints for coach management (P0). All routes require
// session.role === 'academy_owner' — the guard lives inside AcademyService
// so no controller code needs to duplicate it.

import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req } from "@nestjs/common";
import { AcademyService } from "./academy.service";

@Controller("academy")
export class AcademyController {
  constructor(private readonly svc: AcademyService) {}

  @Post("invites")
  createInvite(@Body() body: any, @Req() req: any) {
    return this.svc.createInvite(req.session, body);
  }

  @Get("invites")
  listInvites(@Req() req: any) {
    return this.svc.listInvites(req.session);
  }

  @Delete("invites/:token")
  revokeInvite(@Req() req: any, @Param("token") token: string) {
    return this.svc.revokeInvite(req.session, token);
  }

  @Get("coaches")
  listCoaches(@Req() req: any) {
    return this.svc.listCoaches(req.session);
  }

  @Get("students")
  listStudents(@Req() req: any) {
    return this.svc.listStudents(req.session);
  }

  // ── Fees + billing ──────────────────────────────────────────────
  @Get("fees/config")
  getFeesConfig(@Req() req: any) { return this.svc.getFeesConfig(req.session); }

  @Put("fees/config")
  setFeesConfig(@Body() body: any, @Req() req: any) { return this.svc.setFeesConfig(req.session, body); }

  @Post("fees/generate")
  generateInvoices(@Req() req: any) { return this.svc.generateInvoices(req.session); }

  @Get("fees")
  listInvoices(@Req() req: any, @Query("status") status?: string, @Query("period") period?: string) {
    return this.svc.listInvoices(req.session, {
      status: (status === "pending" || status === "paid" || status === "waived") ? status : undefined,
      period,
    });
  }

  @Post("fees/:id/mark-paid")
  markPaid(@Req() req: any, @Param("id") id: string, @Body() body: any) { return this.svc.markPaid(req.session, id, body); }

  @Post("fees/:id/waive")
  waiveInvoice(@Req() req: any, @Param("id") id: string, @Body() body: any) { return this.svc.waiveInvoice(req.session, id, body); }

  // Post-class summary — emails per-student recap. Rule-based today; upgrade
  // path is Claude-polished once ANTHROPIC_API_KEY lands in env.
  @Post("classes/:classId/summary")
  sendClassSummary(@Req() req: any, @Param("classId") classId: string, @Body() body: any) {
    return this.svc.sendClassSummary(req.session, classId, body);
  }
}
