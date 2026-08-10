import { Body, Controller, Delete, Get, Param, Post, Req } from "@nestjs/common";
import { HomeworkService } from "./homework.service";

@Controller()
export class HomeworkController {
  constructor(private readonly svc: HomeworkService) {}

  @Post("academy/homework")
  assign(@Req() req: any, @Body() body: any) { return this.svc.assign(req.session, body); }

  @Post("academy/homework/one-click")
  oneClick(@Req() req: any) { return this.svc.oneClickAssign(req.session); }

  @Get("academy/homework")
  listCoach(@Req() req: any) { return this.svc.listForCoach(req.session); }

  @Delete("academy/homework/:id")
  remove(@Req() req: any, @Param("id") id: string) { return this.svc.remove(req.session, id); }

  @Get("me/homework")
  listStudent(@Req() req: any) { return this.svc.listForStudent(req.session); }

  @Post("me/homework/:id/advance")
  advance(@Req() req: any, @Param("id") id: string, @Body() body: any) {
    const taskIndex = Number(body?.taskIndex ?? 0);
    return this.svc.advance(req.session, id, taskIndex);
  }
}
