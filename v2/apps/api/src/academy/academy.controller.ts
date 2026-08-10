// Owner-only endpoints for coach management (P0). All routes require
// session.role === 'academy_owner' — the guard lives inside AcademyService
// so no controller code needs to duplicate it.

import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UnauthorizedException } from "@nestjs/common";
import { AcademyService } from "./academy.service";
import { CoachStarredDigestService } from "./coach-starred-digest.service";

@Controller("academy")
export class AcademyController {
  constructor(
    private readonly svc: AcademyService,
    private readonly digest: CoachStarredDigestService,
  ) {}

  // GET /api/academy/starred-digest/preview — what next Sunday's coach-starred
  // digest will contain for the current user (7d window). Signed-in-only.
  @Get("starred-digest/preview")
  async previewStarredDigest(@Req() req: any) {
    const userId: string | null = req?.session?.userId ?? null;
    if (!userId) throw new UnauthorizedException();
    return this.digest.previewFor(userId);
  }

  // POST /api/academy/starred-digest/send-now — one-off self-send. Bypasses
  // the Sunday-morning schedule; still fails-fast on opted-out / no-email /
  // empty-window. Coach uses it to QA the digest before Sunday.
  @Post("starred-digest/send-now")
  async sendNowStarredDigest(@Req() req: any) {
    const userId: string | null = req?.session?.userId ?? null;
    if (!userId) throw new UnauthorizedException();
    return this.digest.sendNowFor(userId);
  }

  // PUT /api/academy/starred-digest/cadence  { cadence: "weekly"|"biweekly"|"monthly" }
  @Put("starred-digest/cadence")
  async setStarredDigestCadence(@Req() req: any, @Body() body: any) {
    const userId: string | null = req?.session?.userId ?? null;
    if (!userId) throw new UnauthorizedException();
    return this.svc.setCoachStarredDigestCadence(userId, body?.cadence);
  }

  // POST /api/academy/snap-share { snapId, studentId, message }
  // Coach shares a specific snap with a specific student by email.
  @Post("snap-share")
  async shareSnap(@Req() req: any, @Body() body: any) {
    return this.svc.sendSnapToStudent(req.session, String(body?.snapId || ""), String(body?.studentId || ""), String(body?.message || ""));
  }

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

  // Recordings across the caller's scope. Owner sees every class in academy;
  // coach sees only their own scheduled classes' recordings.
  @Get("recordings")
  listRecordings(@Req() req: any) { return this.svc.listRecordings(req.session); }

  // Snaps across the caller's scope. Same authz as recordings.
  @Get("snaps")
  listSnaps(@Req() req: any) { return this.svc.listSnaps(req.session); }
}
