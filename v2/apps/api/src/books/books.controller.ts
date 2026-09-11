// Books library API.
//
//   GET    /api/books                                — list visible books (seeded + own + academy)
//
// Super-admin cross-academy READ override (owner ask 2026-09-11): the two GETs
// below accept ?academy=<slug|__all__|__platform__>, admin-only and silently
// ignored for everyone else. The write routes deliberately do not accept it.
//   POST   /api/books                                — create a user-added book
//   GET    /api/books/:id                            — book detail + my progress
//   PATCH  /api/books/:id                            — edit (own books only)
//   DELETE /api/books/:id                            — remove (own books only)
//   POST   /api/books/:id/progress/:ch               — mark chapter done
//   DELETE /api/books/:id/progress/:ch               — unmark chapter

import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { BooksService } from "./books.service";

@Controller("books")
export class BooksController {
  constructor(private readonly svc: BooksService) {}

  @Get()
  list(@Req() req: any, @Query("academy") academy: string) {
    return this.svc.list(req?.session, { academy: academy || undefined });
  }

  @Post()
  create(@Body() body: any, @Req() req: any) { return this.svc.create(req?.session, body); }

  @Get(":id")
  get(@Param("id") id: string, @Req() req: any, @Query("academy") academy: string) {
    return this.svc.get(req?.session, id, { academy: academy || undefined });
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() body: any, @Req() req: any) {
    return this.svc.update(req?.session, id, body);
  }

  @Delete(":id")
  remove(@Param("id") id: string, @Req() req: any) { return this.svc.remove(req?.session, id); }

  @Post(":id/progress/:ch")
  markDone(@Param("id") id: string, @Param("ch") ch: string, @Req() req: any) {
    return this.svc.markChapterDone(req?.session, id, Number(ch), true);
  }

  @Delete(":id/progress/:ch")
  unmark(@Param("id") id: string, @Param("ch") ch: string, @Req() req: any) {
    return this.svc.markChapterDone(req?.session, id, Number(ch), false);
  }
}
