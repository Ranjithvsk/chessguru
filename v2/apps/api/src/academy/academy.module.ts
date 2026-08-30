import { Module } from "@nestjs/common";
import { AcademyController } from "./academy.controller";
import { AcademyService } from "./academy.service";
import { ClassAutoSummaryService } from "../class/class-auto-summary.service";
import { CoachStarredDigestService } from "./coach-starred-digest.service";
import { StreakNudgeService } from "./streak-nudge.service";
import { FeesModule } from "../fees/fees.module";

@Module({
  // Import FeesModule (2026-08-30) so batch write handlers can call
  // FeesService.syncBatchEnrollments after mutating a batch's roster —
  // that keeps fee enrolments in sync with the batch without the owner
  // having to re-click "Enrol from batch" every time.
  imports: [FeesModule],
  controllers: [AcademyController],
  providers: [AcademyService, ClassAutoSummaryService, CoachStarredDigestService, StreakNudgeService],
  exports: [AcademyService],
})
export class AcademyModule {}
