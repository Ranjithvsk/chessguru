// Book-diagram annotations API.
//
//   POST   /api/book-diagrams/annotate      — { imageBase64 } → returns FEN preview (no persist)
//   POST   /api/book-diagrams               — save a diagram (bookSlug, page, bbox, fen, side, label?)
//   GET    /api/book-diagrams?bookSlug=X    — list diagrams for a book
//   PATCH  /api/book-diagrams/:id           — edit (creator only)
//   DELETE /api/book-diagrams/:id           — remove (creator only)

import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { BookDiagramsService } from "./book-diagrams.service";

@Controller("book-diagrams")
export class BookDiagramsController {
  constructor(private readonly svc: BookDiagramsService) {}

  @Post("annotate")
  annotate(@Body() body: any, @Req() req: any) { return this.svc.annotate(req?.session, body); }

  @Get()
  list(@Query("bookSlug") bookSlug: string, @Req() req: any) {
    return this.svc.list(req?.session, bookSlug);
  }

  @Post()
  create(@Body() body: any, @Req() req: any) { return this.svc.create(req?.session, body); }

  @Patch(":id")
  update(@Param("id") id: string, @Body() body: any, @Req() req: any) {
    return this.svc.update(req?.session, id, body);
  }

  @Delete(":id")
  remove(@Param("id") id: string, @Req() req: any) { return this.svc.remove(req?.session, id); }
}
