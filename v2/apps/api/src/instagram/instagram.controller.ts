// Owner-only Instagram Studio. Every route re-checks the caller against the
// owner address inside the service — the page's own check is a convenience for
// rendering, never the gate.
import { Body, Controller, Delete, Get, Param, Post, Req } from "@nestjs/common";
import { InstagramService } from "./instagram.service";

@Controller("instagram")
export class InstagramController {
  constructor(private readonly svc: InstagramService) {}

  /** Is this session the owner? Drives sign-in form vs studio. */
  @Get("whoami")
  whoami(@Req() req: any) { return this.svc.whoami(req.session); }

  /** Post candidates built from real moments, rating moves and puzzles. */
  @Get("sources")
  sources(@Req() req: any) { return this.svc.sources(req.session); }

  /** The saved photo/video library. */
  @Get("media")
  listMedia(@Req() req: any) { return this.svc.listMedia(req.session); }

  /** Raw-body upload; Content-Type decides the extension. See main.ts for the
   *  raw parser registration and the size cap. */
  @Post("media/:name")
  uploadMedia(@Param("name") name: string, @Body() body: Buffer, @Req() req: any) {
    return this.svc.uploadMedia(req.session, name, body, String(req?.headers?.["content-type"] || ""));
  }

  @Delete("media/:id")
  deleteMedia(@Param("id") id: string, @Req() req: any) { return this.svc.deleteMedia(req.session, id); }
}
