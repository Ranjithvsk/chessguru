import { Controller, Get, Query } from "@nestjs/common";
import { StudyService } from "./study.service";

@Controller("study")
export class StudyController {
  constructor(private readonly study: StudyService) {}

  @Get("levels")
  levels() { return this.study.levels(); }

  @Get("puzzle")
  puzzle(@Query("type") type: string, @Query("level") level?: string) {
    return this.study.puzzle(type, Number(level) || 1000);
  }
}
