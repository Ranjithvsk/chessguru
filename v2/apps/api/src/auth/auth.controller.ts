import { Body, Controller, Get, Post, Req } from "@nestjs/common";
import { AuthService } from "./auth.service";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("register")
  register(@Body() body: any, @Req() req: any) { return this.auth.register(body, req.session); }

  @Post("signin")
  signin(@Body() body: any, @Req() req: any) { return this.auth.signin(body, req.session); }

  @Get("me")
  me(@Req() req: any) { return this.auth.me(req.session); }

  @Post("logout")
  logout(@Req() req: any) { return this.auth.logout(req.session); }
}
