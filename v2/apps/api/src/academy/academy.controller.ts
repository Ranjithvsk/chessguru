// Owner-only endpoints for coach management (P0). All routes require
// session.role === 'academy_owner' — the guard lives inside AcademyService
// so no controller code needs to duplicate it.

import { Body, Controller, Delete, Get, Param, Post, Req } from "@nestjs/common";
import { AcademyService } from "./academy.service";

@Controller("academy")
export class AcademyController {
  constructor(private readonly svc: AcademyService) {}

  @Post("invites")
  createInvite(@Body() body: any, @Req() req: any) {
    return this.svc.createInvite(req.session, body);
  }

  @Get("invites")
  listInvites(@Req() req: any) {
    return this.svc.listInvites(req.session);
  }

  @Delete("invites/:token")
  revokeInvite(@Req() req: any, @Param("token") token: string) {
    return this.svc.revokeInvite(req.session, token);
  }

  @Get("coaches")
  listCoaches(@Req() req: any) {
    return this.svc.listCoaches(req.session);
  }

  @Get("students")
  listStudents(@Req() req: any) {
    return this.svc.listStudents(req.session);
  }
}
