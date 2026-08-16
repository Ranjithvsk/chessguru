// Insights API — weakness dashboard + prescriptions.
//
//   GET /api/insights/me                       — my own insights
//   GET /api/insights/students/:userId         — a student's insights (coach view)

import { Controller, Get, Param, Req } from "@nestjs/common";
import { InsightsService } from "./insights.service";

@Controller("insights")
export class InsightsController {
  constructor(private readonly svc: InsightsService) {}

  @Get("me")
  mine(@Req() req: any) { return this.svc.mine(req?.session); }

  @Get("students/:userId")
  forStudent(@Param("userId") userId: string, @Req() req: any) {
    return this.svc.forStudent(req?.session, userId);
  }
}
