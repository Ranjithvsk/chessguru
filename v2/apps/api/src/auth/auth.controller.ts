import { Body, Controller, Get, Post, Req, Res } from "@nestjs/common";
import { AuthService } from "./auth.service";

// Kill any HOST-ONLY "cgsid" twin (no Domain attribute). Sessions are issued with
// Domain=.harinitharanjith.com; browsers that still carry an older host-only cgsid
// send BOTH cookies and the stale one shadows the fresh session — sign-in succeeded
// server-side but the user stayed logged out (owner-hit 2026-07-08). Clearing the
// host-only variant on every auth touchpoint lets affected browsers self-heal.
function clearHostOnlyTwin(req: any, res: any) {
  const raw: string = req.headers?.cookie || "";
  const twins = (raw.match(/(?:^|;\s*)cgsid=/g) || []).length;
  if (twins > 1) res.cookie("cgsid", "", { path: "/", expires: new Date(0), httpOnly: true });
}

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("register")
  register(@Body() body: any, @Req() req: any, @Res({ passthrough: true }) res: any) {
    clearHostOnlyTwin(req, res);
    return this.auth.register(body, req.session);
  }

  @Post("signin")
  signin(@Body() body: any, @Req() req: any, @Res({ passthrough: true }) res: any) {
    clearHostOnlyTwin(req, res);
    return this.auth.signin(body, req.session);
  }

  @Get("me")
  me(@Req() req: any, @Res({ passthrough: true }) res: any) {
    clearHostOnlyTwin(req, res);
    return this.auth.me(req.session);
  }

  @Post("logout")
  logout(@Req() req: any) { return this.auth.logout(req.session); }
}
