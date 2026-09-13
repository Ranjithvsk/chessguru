import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req } from "@nestjs/common";
import { FinanceService } from "./finance.service";

/** /api/academy/finance/* — academy owner only (guard inside FinanceService, tenant-scoped). */
@Controller("academy/finance")
export class FinanceController {
  constructor(private readonly svc: FinanceService) {}

  @Get("entries")
  list(@Req() req: any, @Query("month") month?: string) { return this.svc.list(req.session, month); }

  @Get("summary")
  summary(@Req() req: any, @Query("month") month?: string) { return this.svc.summary(req.session, month); }

  @Get("coaches")
  coaches(@Req() req: any) { return this.svc.coaches(req.session); }

  @Post("entries")
  create(@Req() req: any, @Body() body: any) { return this.svc.create(req.session, body ?? {}); }

  @Put("entries/:id")
  update(@Req() req: any, @Param("id") id: string, @Body() body: any) { return this.svc.update(req.session, id, body ?? {}); }

  @Delete("entries/:id")
  remove(@Req() req: any, @Param("id") id: string) { return this.svc.remove(req.session, id); }
}
