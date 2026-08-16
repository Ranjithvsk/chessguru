// Exams API.
//
//   GET    /api/exams                              — { owned, assigned } lists w/ my status
//   POST   /api/exams                              — create draft exam
//   GET    /api/exams/pickable-students            — same-academy list for the assign picker
//   GET    /api/exams/:id                          — full exam (student view strips answers)
//   PATCH  /api/exams/:id                          — edit meta (draft only)
//   POST   /api/exams/:id/positions/from-study/:sid — bulk-add ⭐ from a study
//   DELETE /api/exams/:id/positions/:pid           — remove a position
//   POST   /api/exams/:id/publish                  — draft → published (+ dueAt)
//   POST   /api/exams/:id/close                    — published → closed
//   DELETE /api/exams/:id                          — delete (draft/closed only)
//   POST   /api/exams/:id/attempts/start           — student starts / resumes attempt
//   POST   /api/exams/:id/attempts/:aid/answer     — submit one answer
//   POST   /api/exams/:id/attempts/:aid/finish     — grade + close attempt
//   GET    /api/exams/:id/results                  — coach: all attempts + per-pos miss counts; student: mine

import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { ExamsService } from "./exams.service";

@Controller("exams")
export class ExamsController {
  constructor(private readonly svc: ExamsService) {}

  @Get()
  list(@Req() req: any) { return this.svc.listMine(req?.session); }

  @Get("pickable-students")
  pickable(@Req() req: any) { return this.svc.pickableStudents(req?.session); }

  @Post()
  create(@Body() body: any, @Req() req: any) { return this.svc.create(req?.session, body); }

  @Get(":id")
  get(@Param("id") id: string, @Req() req: any) { return this.svc.get(req?.session, id); }

  @Patch(":id")
  updateMeta(@Param("id") id: string, @Body() body: any, @Req() req: any) {
    return this.svc.updateMeta(req?.session, id, body);
  }

  @Post(":id/positions/from-study/:sid")
  addFromStudy(@Param("id") id: string, @Param("sid") sid: string, @Req() req: any) {
    return this.svc.addFromStudy(req?.session, id, sid);
  }

  @Delete(":id/positions/:pid")
  removePosition(@Param("id") id: string, @Param("pid") pid: string, @Req() req: any) {
    return this.svc.removePosition(req?.session, id, pid);
  }

  @Post(":id/publish")
  publish(@Param("id") id: string, @Body() body: any, @Req() req: any) {
    return this.svc.publish(req?.session, id, body);
  }

  @Post(":id/close")
  close(@Param("id") id: string, @Req() req: any) { return this.svc.close(req?.session, id); }

  @Delete(":id")
  remove(@Param("id") id: string, @Req() req: any) { return this.svc.remove(req?.session, id); }

  @Post(":id/attempts/start")
  startAttempt(@Param("id") id: string, @Req() req: any) { return this.svc.startAttempt(req?.session, id); }

  @Post(":id/attempts/:aid/answer")
  answer(@Param("id") id: string, @Param("aid") aid: string, @Body() body: any, @Req() req: any) {
    return this.svc.submitAnswer(req?.session, id, aid, body);
  }

  @Post(":id/attempts/:aid/finish")
  finish(@Param("id") id: string, @Param("aid") aid: string, @Req() req: any) {
    return this.svc.finishAttempt(req?.session, id, aid);
  }

  @Get(":id/results")
  results(@Param("id") id: string, @Req() req: any) { return this.svc.results(req?.session, id); }
}
