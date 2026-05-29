import { Controller, Get, Req } from "@nestjs/common";
import { THEMES } from "./themes";
import { AuthService } from "./auth/auth.service";

@Controller()
export class MiscController {
  constructor(private readonly auth: AuthService) {}

  @Get("themes")
  themes() { return { themes: THEMES }; }

  @Get("me/rating")
  myRating(@Req() req: any) { return this.auth.myRating(req.session); }
}
