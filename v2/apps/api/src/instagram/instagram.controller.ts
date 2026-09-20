// Owner-only Instagram Studio. Every route re-checks the caller against the
// owner address inside the service — the page's own check is a convenience for
// rendering, never the gate.
import { Controller, Get, Req } from "@nestjs/common";
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
}
