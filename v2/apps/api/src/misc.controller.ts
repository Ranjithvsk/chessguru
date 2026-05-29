import { Controller, Get } from "@nestjs/common";
import { THEMES } from "./themes";

@Controller()
export class MiscController {
  @Get("themes")
  themes() {
    return { themes: THEMES };
  }

  // v1: guest only (full auth/sessions come in a later milestone)
  @Get("me/rating")
  myRating() {
    return { rating: 1500, loggedIn: false };
  }
}
