// User-created studies API.
//
//   GET    /api/studies                              — list studies I can see
//   POST   /api/studies                              — create study (+ first chapter)
//   GET    /api/studies/:sid                         — study meta + chapter list
//   PATCH  /api/studies/:sid                         — update study meta (title, visibility, shares)
//   DELETE /api/studies/:sid                         — delete study + all chapters
//   POST   /api/studies/:sid/chapters                — add chapter to study
//   GET    /api/studies/:sid/chapters/:cid           — get chapter (moves + startingFen)
//   PATCH  /api/studies/:sid/chapters/:cid           — save chapter (title, startingFen, moves, headers)
//   DELETE /api/studies/:sid/chapters/:cid           — delete chapter

import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { StudiesService } from "./studies.service";

@Controller("studies")
export class StudiesController {
  constructor(private readonly svc: StudiesService) {}

  @Get()
  list(@Req() req: any) { return this.svc.listMine(req?.session); }

  // Trash — owner-only list of soft-deleted studies (owner ask 2026-09-03).
  // Kept BEFORE the :sid routes so "/studies/trash" isn't caught by the
  // dynamic :sid handler.
  @Get("trash")
  listTrash(@Req() req: any) { return this.svc.listTrash(req?.session); }

  @Post()
  create(@Body() body: any, @Req() req: any) { return this.svc.create(req?.session, body); }

  @Get(":sid")
  get(@Param("sid") sid: string, @Req() req: any) { return this.svc.get(req?.session, sid); }

  @Patch(":sid")
  updateMeta(@Param("sid") sid: string, @Body() body: any, @Req() req: any) {
    return this.svc.updateMeta(req?.session, sid, body);
  }

  @Delete(":sid")
  remove(@Param("sid") sid: string, @Req() req: any) { return this.svc.remove(req?.session, sid); }

  // Restore a soft-deleted study (owner-only). Pairs with @Delete above.
  @Post(":sid/restore")
  restore(@Param("sid") sid: string, @Req() req: any) { return this.svc.restore(req?.session, sid); }

  @Post(":sid/chapters")
  addChapter(@Param("sid") sid: string, @Body() body: any, @Req() req: any) {
    return this.svc.addChapter(req?.session, sid, body);
  }

  @Get(":sid/chapters/:cid")
  getChapter(@Param("sid") sid: string, @Param("cid") cid: string, @Req() req: any) {
    return this.svc.getChapter(req?.session, sid, cid);
  }

  @Patch(":sid/chapters/:cid")
  saveChapter(@Param("sid") sid: string, @Param("cid") cid: string, @Body() body: any, @Req() req: any) {
    return this.svc.saveChapter(req?.session, sid, cid, body);
  }

  @Delete(":sid/chapters/:cid")
  deleteChapter(@Param("sid") sid: string, @Param("cid") cid: string, @Req() req: any) {
    return this.svc.deleteChapter(req?.session, sid, cid);
  }
}
