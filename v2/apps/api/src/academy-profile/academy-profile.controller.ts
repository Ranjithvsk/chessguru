// Academy public-profile routes.
//
// Public read:  GET /api/academy-page/:slug
//               GET /api/academy-page/by-domain/:host
// Self admin :  GET  /api/me/academy-profile
//               POST /api/me/academy-profile
//               POST /api/me/academy-profile/upload/:kind[/:subId]
//               POST /api/me/academy-profile/gen-image
//               POST /api/me/academy-profile/domain/{set,verify,remove}
//               GET  /api/me/academy-profile/domain/status

import {
  BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Req,
} from "@nestjs/common";
import { AcademyProfileService } from "./academy-profile.service";
import { AcademyDomainService } from "./academy-domain.service";

@Controller("academy-page")
export class AcademyPublicController {
  constructor(
    private readonly svc: AcademyProfileService,
    private readonly domainSvc: AcademyDomainService,
  ) {}

  @Get("by-domain/:domain")
  async byDomain(@Param("domain") domain: string) {
    const hit = await this.domainSvc.lookupByDomain(domain);
    if (!hit) throw new NotFoundException("no academy with that domain");
    return hit;
  }

  @Get(":slug")
  get(@Param("slug") slug: string) {
    return this.svc.getBySlug(slug);
  }
}

@Controller("me/academy-profile")
export class MyAcademyProfileController {
  constructor(
    private readonly svc: AcademyProfileService,
    private readonly domainSvc: AcademyDomainService,
  ) {}

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

  /** Nested image (achievement / testimonial) — /upload/:kind/:subId */
  @Post("upload/:kind/:subId")
  async uploadNested(
    @Param("kind") kind: string,
    @Param("subId") subId: string,
    @Body() body: Buffer,
    @Req() req: any,
  ) {
    if (kind !== "achievement" && kind !== "testimonial") {
      throw new BadRequestException("bad nested kind");
    }
    const ct = String(req?.headers?.["content-type"] || "");
    return this.svc.uploadImage(req.session, `${kind}:${subId}`, subId, body, ct);
  }

  /** Top-level image (logo | cover) — /upload/:kind */
  @Post("upload/:kind")
  async uploadTop(
    @Param("kind") kind: string,
    @Body() body: Buffer,
    @Req() req: any,
  ) {
    if (kind !== "logo" && kind !== "cover") throw new BadRequestException("bad kind");
    const ct = String(req?.headers?.["content-type"] || "");
    return this.svc.uploadImage(req.session, kind, null, body, ct);
  }

  /** Gemini text→image generation for logo/cover/achievement/testimonial. */
  @Post("gen-image")
  gen(@Req() req: any, @Body() body: any) {
    return this.svc.genImage(req.session, body || {});
  }
}
