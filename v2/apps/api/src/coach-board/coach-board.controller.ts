// Coach Class Board API.
//
//   GET /api/coach-board                — class board (students + class-wide weaknesses)
//   GET /api/coach-board/plan/:tag      — generate a class-plan draft for one weakness

import { Controller, Get, Param, Req } from "@nestjs/common";
import { CoachBoardService, type ClassBoard, type ClassPlan } from "./coach-board.service";

@Controller("coach-board")
export class CoachBoardController {
  constructor(private readonly svc: CoachBoardService) {}

  @Get()
  board(@Req() req: any): Promise<ClassBoard> { return this.svc.classBoard(req?.session); }

  @Get("plan/:tag")
  plan(@Param("tag") tag: string, @Req() req: any): Promise<ClassPlan> { return this.svc.generatePlan(req?.session, tag); }
}
