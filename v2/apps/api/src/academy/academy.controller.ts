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

  /** Attendance sheet for a date (default today). Returns every eligible
   *  student pre-filled to "present"; overlay of prior marks flips them to
   *  late/absent. Owner sees all coaches; coach pinned to their roster. */
  @Get("attendance")
  attendanceSheet(@Req() req: any, @Query("date") date: string, @Query("coachId") coachId: string, @Query("batchId") batchId: string) {
    return this.svc.getAttendanceSheet(req.session, date, coachId || null, batchId || null);
  }

  /** Bulk mark attendance for a date. Body: { date, entries: [{ studentId,
   *  status: "present"|"late"|"absent", lateMinutes?, reason? }] }. */
  @Post("attendance/mark")
  markAttendance(@Req() req: any, @Body() body: any) {
    return this.svc.markAttendanceBulk(req.session, body);
  }

  /** Copy attendance marks from one date to another for the same scope.
   *  Body: { fromDate, toDate, coachId?, batchId? }. */
  @Post("attendance/copy")
  copyAttendance(@Req() req: any, @Body() body: any) {
    return this.svc.copyAttendance(req.session, body);
  }

  /** Create a QR check-in session — coach displays this at class start,
   *  students scan with phone → auto-marked present. Body: { date?, coachId?,
   *  batchId? }. Returns { token, expiresAt, checkinUrl } for QR encoding. */
  @Post("attendance/qr/create")
  createQrCheckin(@Req() req: any, @Body() body: any) {
    return this.svc.createQrCheckinSession(req.session, body);
  }

  /** Student scans QR → this endpoint runs. Auth: must be signed in and be a
   *  student in the session's scope. Body: { token }. */
  @Post("attendance/qr/checkin")
  redeemQrCheckin(@Req() req: any, @Body() body: any) {
    return this.svc.redeemQrCheckin(req.session, String(body?.token || ""));
  }

  /** Coach polls this to show live "N checked in" counter in the QR modal. */
  @Get("attendance/qr/:token/status")
  qrCheckinStatus(@Req() req: any, @Param("token") token: string) {
    return this.svc.getQrCheckinStatus(req.session, token);
  }

  /** Fetch parent WhatsApp contact for a student — used by the "📱 WhatsApp
   *  Parent" button on absent cards. Returns wa.me click-to-chat links
   *  pre-filled with a friendly absent-notification message. */
  @Get("attendance/parent-contact/:studentId")
  parentContact(@Req() req: any, @Param("studentId") studentId: string, @Query("date") date: string) {
    return this.svc.getParentContact(req.session, studentId, date);
  }

  /** Auto-send absent notifications via Meta WhatsApp Cloud API. Body:
   *  { studentIds: string[], date?, force? }. Requires template
   *  WA_TPL_ABSENT_NOTICE approved by Meta. Returns per-recipient status. */
  @Post("attendance/notify-absent")
  notifyAbsent(@Req() req: any, @Body() body: any) {
    return this.svc.autoSendAbsentNotifications(req.session, body);
  }

  /** Per-student notify-send status for a date. Used to show green ✓
   *  next to already-notified parents. */
  @Get("attendance/notify-status/:studentId")
  notifyStatus(@Req() req: any, @Param("studentId") studentId: string, @Query("date") date: string) {
    return this.svc.getAbsentNotifyStatus(req.session, studentId, date);
  }

  /** Face check-in — student self-enrolls a 128-dim descriptor (computed
   *  client-side via face-api.js from 3+ selfies). Body: { descriptor,
   *  consent }. NEVER stores original photos. */
  @Post("attendance/face/enroll")
  enrollFace(@Req() req: any, @Body() body: any) {
    return this.svc.enrollFace(req.session, body);
  }

  /** Delete a face enrollment. ?studentId= for coach/owner to delete
   *  on someone's behalf; omit to delete your own. */
  @Post("attendance/face/delete")
  deleteFace(@Req() req: any, @Body() body: any) {
    return this.svc.deleteFaceEnrollment(req.session, body?.studentId);
  }

  /** Coach's face-check-in fires this per detected face. Body: { descriptor,
   *  date?, coachId?, batchId?, threshold? }. Returns best match under
   *  threshold + auto-marks present. */
  @Post("attendance/face/match")
  matchFace(@Req() req: any, @Body() body: any) {
    return this.svc.matchFaceCheckin(req.session, body);
  }

  /** Roster with enrollment status — for the enrollment panel + the
   *  face check-in "N of M enrolled" indicator. */
  @Get("attendance/face/roster")
  faceRoster(@Req() req: any) {
    return this.svc.listFaceEnrollment(req.session);
  }

  /** Per-student attendance history for the calendar heatmap on the
   *  performance page. ?days=N (default 90, max 365). Auth: coach for own
   *  students, owner for any academy student, student for self, parent for
   *  their children. */
  @Get("attendance/history/:studentId")
  attendanceHistory(@Req() req: any, @Param("studentId") studentId: string, @Query("days") days: string) {
    return this.svc.getAttendanceHistory(req.session, studentId, Number(days) || 90);
  }

  /** Coach + owner dashboard: fleet metrics, per-batch table, watchlist of
   *  students needing attention. ?days=N (default 30). */
  @Get("attendance/dashboard")
  attendanceDashboard(@Req() req: any, @Query("days") days: string) {
    return this.svc.getAttendanceDashboard(req.session, Number(days) || 30);
  }

  /** Presence heartbeat — any signed-in user pings this every ~60s (and on
   *  route change). Body: { path }. Updates users.lastSeen + currentPath so
   *  coaches see who is online right now on the /academy dashboard. */
  @Post("heartbeat")
  heartbeat(@Req() req: any, @Body() body: any) {
    const userId: string | null = req?.session?.userId ?? null;
    if (!userId) throw new UnauthorizedException();
    return this.svc.heartbeat(userId, String(body?.path || "/"));
  }

  /** Owner/coach only: live presence roster — who's online right now and
   *  where they are. Called by the /academy dashboard on a short poll. */
  @Get("presence")
  livePresence(@Req() req: any) {
    return this.svc.listLivePresence(req.session);
  }

  /** Owner/coach only: per-student activity (puzzles + revisions) in a
   *  rolling window. `days` picks the window — 7 / 30 / 90 / 180 / 365 are
   *  the presets the /academy/performance page offers. */
  @Get("students/activity")
  studentActivity(@Req() req: any, @Query("days") days: string) {
    return this.svc.listStudentActivity(req.session, Number(days) || 7);
  }

  /** Academy-wide leaderboard — visible to any academy member (student too,
   *  so they can see themselves ranked). Period: today | 7d | 30d | 180d |
   *  365d | lifetime. Returns rows with ChessGuru Score + rank + micro-
   *  champion callouts. */
  @Get("leaderboard")
  leaderboard(@Req() req: any, @Query("period") period: string, @Query("bucket") bucket: string, @Query("sortBy") sortBy: string) {
    const sb = sortBy === "consistency" ? "consistency" : "score";
    return this.svc.buildLeaderboard(req.session, String(period || "7d"), { bucket: bucket || undefined, sortBy: sb });
  }

  /** Achievement gallery for a student — any academy member can read.
   *  Auto-awards new unlocks on read so the persistence stays fresh. */
  @Get("achievements/:studentId")
  achievements(@Req() req: any, @Param("studentId") studentId: string) {
    return this.svc.listAchievementsFor(req.session, studentId);
  }

  /** Coach/owner: start (or replace) an academy-wide "boost" — 1.5× score
   *  weight on puzzles matching the given theme for N days. Body:
   *  { theme, multiplier?, days?, note? } */
  @Post("boost")
  createBoost(@Req() req: any, @Body() body: any) {
    return this.svc.createBoost(req.session, body);
  }
  @Post("boost/end")
  endBoost(@Req() req: any) {
    return this.svc.endActiveBoost(req.session);
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

  /** Link a parent to a student (creates the parent account if needed).
   *  Body: { displayName, email }. Returns credentials when new. */
  @Post("students/:id/link-parent")
  linkParent(@Req() req: any, @Param("id") id: string, @Body() body: any) {
    return this.svc.linkParentToStudent(req.session, id, body);
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
