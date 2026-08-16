// Books library API.
//
//   GET    /api/books                                — list visible books (seeded + own + academy)
//   POST   /api/books                                — create a user-added book
//   GET    /api/books/:id                            — book detail + my progress
//   PATCH  /api/books/:id                            — edit (own books only)
//   DELETE /api/books/:id                            — remove (own books only)
//   POST   /api/books/:id/progress/:ch               — mark chapter done
//   DELETE /api/books/:id/progress/:ch               — unmark chapter

import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { BooksService } from "./books.service";

@Controller("books")
export class BooksController {
  constructor(private readonly svc: BooksService) {}

  @Get()
  list(@Req() req: any) { return this.svc.list(req?.session); }

  @Post()
  create(@Body() body: any, @Req() req: any) { return this.svc.create(req?.session, body); }

  @Get(":id")
  get(@Param("id") id: string, @Req() req: any) { return this.svc.get(req?.session, id); }

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
