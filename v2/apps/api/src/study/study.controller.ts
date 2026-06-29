import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { StudyService } from "./study.service";

@Controller("study")
export class StudyController {
  constructor(private readonly study: StudyService) {}

  @Get("levels")
  levels() { return this.study.levels(); }

  @Get("me")
  me(@Query("type") type: string, @Req() req: any) { return this.study.me(req?.session?.userId ?? null, type); }

  @Get("puzzle")
  puzzle(@Query("type") type: string, @Query("level") level?: string, @Query("pawns") pawns?: string) {
    return this.study.puzzle(type, Number(level) || 1200, pawns ? Number(pawns) : undefined);
  }

  @Post(":id/complete")
  complete(@Param("id") id: string, @Body() body: any, @Req() req: any) {
    return this.study.complete(id, { ...(body ?? {}), userId: req?.session?.userId ?? null });
  }
}
