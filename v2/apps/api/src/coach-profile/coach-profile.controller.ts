// Coach public profile routes.
//
// Public read:  GET /api/coach/:username
// Self admin :  GET  /api/me/coach-profile
//               POST /api/me/coach-profile
//               POST /api/me/coach-profile/upload/:kind[/:subId]
//               POST /api/me/coach-profile/gen-image

import {
  BadRequestException, Body, Controller, Get, Param, Post, Req,
} from "@nestjs/common";
import { CoachProfileService } from "./coach-profile.service";

@Controller("coach")
export class CoachPublicController {
  constructor(private readonly svc: CoachProfileService) {}

  @Get(":username")
  get(@Param("username") username: string) {
    return this.svc.getByUsername(username);
  }
}

@Controller("me/coach-profile")
export class MyCoachProfileController {
  constructor(private readonly svc: CoachProfileService) {}

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
