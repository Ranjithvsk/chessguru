// Coach public profile routes.
//
// Public read:  GET /api/coach/:username
// Self admin :  GET  /api/me/coach-profile
//               POST /api/me/coach-profile
//               POST /api/me/coach-profile/upload/:kind[/:subId]
//               POST /api/me/coach-profile/gen-image

import {
  BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Req,
} from "@nestjs/common";
import { CoachProfileService } from "./coach-profile.service";
import { CoachDomainService } from "./coach-domain.service";

@Controller("coach")
export class CoachPublicController {
  constructor(
    private readonly svc: CoachProfileService,
    private readonly domainSvc: CoachDomainService,
  ) {}

  @Get("by-domain/:domain")
  async byDomain(@Param("domain") domain: string) {
    const hit = await this.domainSvc.lookupByDomain(domain);
    if (!hit) throw new NotFoundException("no coach with that domain");
    return hit;
  }

  @Get(":username")
  get(@Param("username") username: string) {
    return this.svc.getByUsername(username);
  }
}

@Controller("me/coach-profile")
export class MyCoachProfileController {
  constructor(
    private readonly svc: CoachProfileService,
    private readonly domainSvc: CoachDomainService,
  ) {}

  /* ----- custom-domain automation (Phase 2) ----- */

  @Post("domain/set")
  domainSet(@Req() req: any, @Body() body: any) {
    return this.domainSvc.setDomain(req.session, body || {});
  }

  @Post("domain/verify")
  domainVerify(@Req() req: any) {
    return this.domainSvc.verify(req.session);
  }

  @Get("domain/status")
  domainStatus(@Req() req: any) {
    return this.domainSvc.status(req.session);
  }

  @Post("domain/remove")
  domainRemove(@Req() req: any) {
    return this.domainSvc.remove(req.session);
  }

  @Get()
  getMine(@Req() req: any) {
    return this.svc.getMine(req.session);
  }

  @Post()
  upsert(@Req() req: any, @Body() body: any) {
    return this.svc.upsertMine(req.session, body || {});
  }

  /** Nested image (achievement / trophy / topStudent) — /upload/:kind/:subId */
  @Post("upload/:kind/:subId")
  async uploadNested(
    @Param("kind") kind: string,
    @Param("subId") subId: string,
    @Body() body: Buffer,
    @Req() req: any,
  ) {
    if (kind !== "achievement" && kind !== "trophy" && kind !== "topStudent") {
      throw new BadRequestException("bad nested kind");
    }
    const ct = String(req?.headers?.["content-type"] || "");
    return this.svc.uploadImage(req.session, `${kind}:${subId}`, subId, body, ct);
  }

  /** Top-level image (photo | cover) — /upload/:kind */
  @Post("upload/:kind")
  async uploadTop(
    @Param("kind") kind: string,
    @Body() body: Buffer,
    @Req() req: any,
  ) {
    if (kind !== "photo" && kind !== "cover") throw new BadRequestException("bad kind");
    const ct = String(req?.headers?.["content-type"] || "");
    return this.svc.uploadImage(req.session, kind, null, body, ct);
  }

  /** Gemini text→image generation for photo/cover/trophy/achievement/topStudent. */
  @Post("gen-image")
  gen(@Req() req: any, @Body() body: any) {
    return this.svc.genImage(req.session, body || {});
  }
}
