// Parent Reports API.
//
//   POST   /api/parent-reports/preview       — { studentId, periodStart, periodEnd } → returns data only (no persist)
//   POST   /api/parent-reports               — persist a report (creates a new record)
//   GET    /api/parent-reports               — my saved reports (optionally ?studentId=)
//   GET    /api/parent-reports/:id           — one report
//   PATCH  /api/parent-reports/:id           — update coachNote / parentEmail
//   POST   /api/parent-reports/:id/send      — mark as sent (Slice 6 MVP: sets sentAt only)
//   DELETE /api/parent-reports/:id

import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { ParentReportsService } from "./parent-reports.service";

@Controller("parent-reports")
export class ParentReportsController {
  constructor(private readonly svc: ParentReportsService) {}

  @Post("preview")
  preview(@Body() body: any, @Req() req: any) { return this.svc.preview(req?.session, body); }

  // Self-scoped preview — the logged-in user's own metric bundle. Powers the
  // "My performance" period table without needing coach authority. Added
  // 2026-08-18 (owner ask: period-based ratings on My performance + Student
  // performance).
  @Post("preview-self")
  previewSelf(@Body() body: any, @Req() req: any) { return this.svc.previewSelf(req?.session, body); }

  // Coach-scoped list of puzzles a student missed in a period. Body:
  // { studentId, periodStart, periodEnd, limit? }. Returns rows with FEN +
  // solution so the coach can jump to the position and reteach the tactic.
  @Post("mistakes")
  mistakes(@Body() body: any, @Req() req: any) { return this.svc.studentMistakes(req?.session, body); }

  // Academy-wide reteach queue — recent misses across every student in
  // the caller's academy (owner: all, coach: assigned students).
  @Post("academy-mistakes")
  academyMistakes(@Body() body: any, @Req() req: any) { return this.svc.academyMistakes(req?.session, body); }

  @Post()
  save(@Body() body: any, @Req() req: any) { return this.svc.save(req?.session, body); }

  @Get()
  list(@Query("studentId") studentId: string | undefined, @Req() req: any) {
    return this.svc.list(req?.session, studentId);
  }

  @Get(":id")
  get(@Param("id") id: string, @Req() req: any) { return this.svc.get(req?.session, id); }

  @Patch(":id")
  updateMeta(@Param("id") id: string, @Body() body: any, @Req() req: any) {
    return this.svc.updateMeta(req?.session, id, body);
  }

  @Post(":id/send")
  markSent(@Param("id") id: string, @Req() req: any) { return this.svc.markSent(req?.session, id); }

  @Delete(":id")
  remove(@Param("id") id: string, @Req() req: any) { return this.svc.remove(req?.session, id); }
}
