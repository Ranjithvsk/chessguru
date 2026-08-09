import { Body, Controller, Get, Post, Req, Res } from "@nestjs/common";
import { AuthService } from "./auth.service";

// See auth.service.ts for context on the hostonly-cookie twin — this helper
// clears any stale host-only cgsid cookie so returning browsers self-heal.
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

  // Multi-tenant SaaS: create a new academy + its owner user in one call
  @Post("signup-academy")
  signupAcademy(@Body() body: any, @Req() req: any, @Res({ passthrough: true }) res: any) {
    clearHostOnlyTwin(req, res);
    return this.auth.signupAcademy(body, req.session);
  }

  // Password reset via emailed link
  @Post("request-reset")
  requestReset(@Body() body: any) { return this.auth.requestReset(body); }
  @Post("reset-password")
  resetPassword(@Body() body: any) { return this.auth.resetPassword(body); }

  // OTP sign-in via email
  @Post("request-otp")
  requestOtp(@Body() body: any) { return this.auth.requestOtp(body); }
  @Post("otp-signin")
  otpSignin(@Body() body: any, @Req() req: any, @Res({ passthrough: true }) res: any) {
    clearHostOnlyTwin(req, res);
    return this.auth.otpSignin(body, req.session);
  }
}
