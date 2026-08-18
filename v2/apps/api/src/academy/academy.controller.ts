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

  // GET /api/academy/snap-shares/stats — { total, thisWeek } for the
  // current user's coachSnapSends audit log. Used by the today ribbon.
  @Get("snap-shares/stats")
  async snapShareStats(@Req() req: any) {
    const userId: string | null = req?.session?.userId ?? null;
    if (!userId) throw new UnauthorizedException();
    return this.svc.snapShareStatsFor(userId);
  }

  // GET /api/academy/snap-shares/tally — { snapId: count } for CSV enrichment.
  @Get("snap-shares/tally")
  async snapShareTally(@Req() req: any) {
    const userId: string | null = req?.session?.userId ?? null;
    if (!userId) throw new UnauthorizedException();
    return this.svc.snapShareTallyFor(userId);
  }

  // GET /api/academy/snap-shares — flat list of the coach's outbound shares
  // (up to 500 rows, newest first) for CSV export.
  @Get("snap-shares")
  async snapShareList(@Req() req: any) {
    const userId: string | null = req?.session?.userId ?? null;
    if (!userId) throw new UnauthorizedException();
    return this.svc.snapShareListFor(userId);
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

  /** Owner+coach: metadata about their academy — name, plan, trial dates. */
  @Get("meta")
  meta(@Req() req: any) { return this.svc.getMeta(req.session); }

  @Get("students")
  listStudents(@Req() req: any) {
    return this.svc.listStudents(req.session);
  }

  /** Direct-add a student — no email round-trip. Returns the credentials the
   *  coach hands to the student in person / paper. */
  @Post("students/quick-add")
  quickAddStudent(@Req() req: any, @Body() body: any) {
    return this.svc.quickAddStudent(req.session, body);
  }

  /** Attach an EXISTING platform user as a student — preserves their
   *  puzzle history + rating. Body: { usernameOrEmail, coachId? }. */
  @Post("students/attach-existing")
  attachExistingStudent(@Req() req: any, @Body() body: any) {
    return this.svc.attachExistingStudent(req.session, body);
  }

  /** Merge an empty quick-added duplicate student into an existing
   *  platform account. Body: { targetUsernameOrEmail }. */
  @Post("students/:id/merge")
  mergeStudent(@Req() req: any, @Param("id") id: string, @Body() body: any) {
    return this.svc.mergeStudent(req.session, id, body);
  }

  /** Owner-only: quick-add a coach (mirrors student quick-add). */
  @Post("coaches/quick-add")
  quickAddCoach(@Req() req: any, @Body() body: any) {
    return this.svc.quickAddCoach(req.session, body);
  }

  /** Owner-only: reassign a student to a different coach. Body: { coachId } */
  @Post("students/:id/assign-coach")
  assignStudentCoach(@Req() req: any, @Param("id") id: string, @Body() body: any) {
    return this.svc.assignStudentCoach(req.session, id, String(body?.coachId || ""));
  }

  /** Coach/owner sets or resets a student's password. Body: {newPassword?:string}
   *  If newPassword is omitted, backend generates <firstname>@123. Returns the
   *  new plain-text credentials once (owner-request UX). */
  @Post("students/:id/set-password")
  setStudentPassword(@Req() req: any, @Param("id") id: string, @Body() body: any) {
    return this.svc.setStudentPassword(req.session, id, body);
  }

  /** Manually mark a student as attended. Body: { date?: "YYYY-MM-DD" } — defaults today. */
  @Post("students/:id/mark-attended")
  markStudentAttended(@Req() req: any, @Param("id") id: string, @Body() body: any) {
    return this.svc.markStudentAttended(req.session, id, body);
  }

  @Post("students/:id/remove")
  removeStudent(@Req() req: any, @Param("id") id: string) {
    return this.svc.removeStudent(req.session, id);
  }

  // ── Batches ──────────────────────────────────────────────
  @Get("batches")
  listBatches(@Req() req: any) { return this.svc.listBatches(req.session); }

  @Post("batches")
  createBatch(@Req() req: any, @Body() body: any) { return this.svc.createBatch(req.session, body); }

  @Post("batches/:id")
  updateBatch(@Req() req: any, @Param("id") id: string, @Body() body: any) { return this.svc.updateBatch(req.session, id, body); }

  @Post("batches/:id/delete")
  deleteBatch(@Req() req: any, @Param("id") id: string) { return this.svc.deleteBatch(req.session, id); }

  @Post("batches/:id/schedule")
  scheduleBatchClasses(@Req() req: any, @Param("id") id: string, @Body() body: any) {
    return this.svc.scheduleBatchClasses(req.session, id, body);
  }

  // ── Master Coach Directives ──────────────────────────────────
  @Get("directives")
  listDirectives(@Req() req: any) { return this.svc.listDirectives(req.session); }

  @Post("directives")
  createDirective(@Req() req: any, @Body() body: any) { return this.svc.createDirective(req.session, body); }

  @Post("directives/:id")
  updateDirective(@Req() req: any, @Param("id") id: string, @Body() body: any) {
    return this.svc.updateDirective(req.session, id, body);
  }

  @Post("directives/:id/ack")
  ackDirective(@Req() req: any, @Param("id") id: string) { return this.svc.ackDirective(req.session, id); }

  @Post("directives/:id/done")
  markDirectiveDone(@Req() req: any, @Param("id") id: string, @Body() body: any) {
    return this.svc.markDirectiveDone(req.session, id, body);
  }

  @Post("directives/:id/delete")
  deleteDirective(@Req() req: any, @Param("id") id: string) { return this.svc.deleteDirective(req.session, id); }

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
