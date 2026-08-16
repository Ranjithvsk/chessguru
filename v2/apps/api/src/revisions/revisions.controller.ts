// Revision queue API.
//
//   GET  /api/revisions/queue?limit=30  — positions due right now
//   GET  /api/revisions/stats           — { dueNow, dueNext24h, total, longestStreak }
//   POST /api/revisions/review          — { chapterId, nodeId, grade } → reschedule
//   POST /api/revisions/study/:sid/add  — add all flagged positions in a shared
//                                          study to MY queue (non-owner opt-in)

import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { RevisionsService } from "./revisions.service";

@Controller("revisions")
export class RevisionsController {
  constructor(private readonly svc: RevisionsService) {}

  @Get("queue")
  queue(@Query("limit") limit: string | undefined, @Req() req: any) {
    return this.svc.queue(req?.session, Number(limit) || 30);
  }

  @Get("stats")
  stats(@Req() req: any) { return this.svc.stats(req?.session); }

  @Post("review")
  review(@Body() body: any, @Req() req: any) { return this.svc.review(req?.session, body); }

  @Post("study/:sid/add")
  addStudy(@Param("sid") sid: string, @Req() req: any) {
    return this.svc.addStudyToMyQueue(req?.session, sid);
  }
}
