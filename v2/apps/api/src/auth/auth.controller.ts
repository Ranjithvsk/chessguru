import { Controller, Get } from "@nestjs/common";

// v1: guest only — register/signin/sessions land in a later milestone.
@Controller("auth")
export class AuthController {
  @Get("me")
  me() {
    return { loggedIn: false };
  }
}
