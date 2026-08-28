// Fees HTTP surface — W1.
//   POST   /api/fees/programs         create (optionally with heads)
//   GET    /api/fees/programs         list, filterable by status + q
//   GET    /api/fees/programs/:id     single program with heads
//   POST   /api/fees/programs/:id/archive   soft-delete
//
// Auth: same session-cookie model every ChessGuru controller uses.
// Every write goes through FeesService which enforces academyId scoping.

import { Body, Controller, Get, Param, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import { FeesService } from "./fees.service";
import { CreateProgramInput } from "./fees.types";

@Controller("fees")
export class FeesController {
  constructor(private readonly svc: FeesService) {}

  @Post("programs")
  async createProgram(@Req() req: any, @Body() body: CreateProgramInput) {
    if (!req?.session?.userId) throw new UnauthorizedException();
    return this.svc.createProgram(req.session, body);
  }

  @Get("programs")
  async listPrograms(@Req() req: any, @Query("status") status?: string, @Query("q") q?: string) {
    if (!req?.session?.userId) throw new UnauthorizedException();
    return { programs: await this.svc.listPrograms(req.session, { status, q }) };
  }

  @Get("programs/:id")
  async getProgram(@Req() req: any, @Param("id") id: string) {
    if (!req?.session?.userId) throw new UnauthorizedException();
    return this.svc.getProgram(req.session, id);
  }

  @Post("programs/:id/archive")
  async archiveProgram(@Req() req: any, @Param("id") id: string) {
    if (!req?.session?.userId) throw new UnauthorizedException();
    return this.svc.archiveProgram(req.session, id);
  }
}
