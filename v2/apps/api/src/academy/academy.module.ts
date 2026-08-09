import { Module } from "@nestjs/common";
import { AcademyController } from "./academy.controller";
import { AcademyService } from "./academy.service";
import { ClassAutoSummaryService } from "../class/class-auto-summary.service";

@Module({
  controllers: [AcademyController],
  providers: [AcademyService, ClassAutoSummaryService],
  exports: [AcademyService],
})
export class AcademyModule {}
