import { Module } from "@nestjs/common";
import { AcademyController } from "./academy.controller";
import { AcademyService } from "./academy.service";
import { ClassAutoSummaryService } from "../class/class-auto-summary.service";
import { CoachStarredDigestService } from "./coach-starred-digest.service";
import { StreakNudgeService } from "./streak-nudge.service";

@Module({
  controllers: [AcademyController],
  providers: [AcademyService, ClassAutoSummaryService, CoachStarredDigestService, StreakNudgeService],
  exports: [AcademyService],
})
export class AcademyModule {}
