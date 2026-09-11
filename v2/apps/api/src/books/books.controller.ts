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

  // BOTH of these must stay above @Get(":id") or "library" is read as a book id.
  /** Search the owner's real library on the Vinayaka host (3,032 books). */
  @Get("library/search")
  searchLibrary(@Req() req: any, @Query("q") q: string, @Query("limit") limit: string) {
    return this.svc.searchLibrary(req?.session, q || "", Math.min(50, Math.max(1, Number(limit) || 25)));
  }

  /** Attach a library book so a study can point at it. Idempotent. */
  @Post("library/adopt")
  adoptLibrary(@Body() body: any, @Req() req: any) {
    return this.svc.adoptLibraryBook(req?.session, body?.hostId);
  }

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
