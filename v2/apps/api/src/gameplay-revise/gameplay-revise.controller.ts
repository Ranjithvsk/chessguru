/**
 * Gameplay-Revise API.
 *
 * COACH:
 *   POST   /api/gameplay-revise                       - create assignment
 *   GET    /api/gameplay-revise/mine                  - list my (coach) assignments
 *   PATCH  /api/gameplay-revise/:id                   - edit (bumps version → students see "updated")
 *   DELETE /api/gameplay-revise/:id                   - remove
 *
 * STUDENT:
 *   GET    /api/gameplay-revise/for-me                - list assignments sent to me
 *   GET    /api/gameplay-revise/for-me/:id            - fetch one + my progress + updated? flag
 *   POST   /api/gameplay-revise/for-me/:id/progress   - record ply-level score
 */
import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Req, UnauthorizedException } from "@nestjs/common";
import { GameplayReviseService } from "./gameplay-revise.service";

@Controller("gameplay-revise")
export class GameplayReviseController {
  constructor(private readonly svc: GameplayReviseService) {}

  private uid(req: any): string {
    const uid = req?.session?.userId;
    if (!uid) throw new UnauthorizedException("login required");
    return uid;
  }

  // -------- coach --------

  @Post()
  create(@Req() req: any, @Body() body: { title?: string; studentIds?: string[]; sourceGameId?: string | null; pgn?: string; coachNotes?: string }) {
    const coachId = this.uid(req);
    if (!body?.title) throw new BadRequestException("title required");
    return this.svc.create(coachId, {
      title: body.title,
      studentIds: body.studentIds || [],
      sourceGameId: body.sourceGameId || null,
      pgn: body.pgn || "",
      coachNotes: body.coachNotes || "",
    });
  }

  @Get("mine")
  mine(@Req() req: any) {
    return this.svc.listByCoach(this.uid(req));
  }

  @Patch(":id")
  update(@Req() req: any, @Param("id") id: string, @Body() body: Partial<{ title: string; studentIds: string[]; pgn: string; coachNotes: string }>) {
    return this.svc.update(id, this.uid(req), body);
  }

  @Delete(":id")
  del(@Req() req: any, @Param("id") id: string) {
    return this.svc.delete(id, this.uid(req));
  }

  // -------- student --------

  @Get("for-me")
  forMe(@Req() req: any) {
    return this.svc.listByStudent(this.uid(req));
  }

  @Get("for-me/:id")
  forMeOne(@Req() req: any, @Param("id") id: string) {
    return this.svc.getForStudent(id, this.uid(req));
  }

  @Post("for-me/:id/progress")
  progress(@Req() req: any, @Param("id") id: string, @Body() body: { ply: number; correct: boolean; tries: number; version: number; completed?: boolean }) {
    return this.svc.recordProgress(id, this.uid(req), body);
  }
}
