import { Module } from "@nestjs/common";
import { AcademyController } from "./academy.controller";
import { AcademyService } from "./academy.service";
import { ClassAutoSummaryService } from "../class/class-auto-summary.service";
import { CoachStarredDigestService } from "./coach-starred-digest.service";

@Module({
  controllers: [AcademyController],
  providers: [AcademyService, ClassAutoSummaryService, CoachStarredDigestService],
  exports: [AcademyService],
})
export class AcademyModule {}
