import { Body, Controller, Get, Param, Post, Req, Res } from "@nestjs/common";
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
    // Real client IP behind CF + nginx. Priority: CF-Connecting-IP (unspoofable
    // inbound — CF strips client copies), then x-forwarded-for's first hop,
    // then socket.
    const cfip = String(req.headers?.["cf-connecting-ip"] ?? "").trim();
    const xff = String(req.headers?.["x-forwarded-for"] ?? "").split(",")[0]?.trim();
    const ip = cfip || xff || req.ip || req.socket?.remoteAddress || "unknown";
    return this.auth.signupAcademy(body, req.session, ip);
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

  // Coach/student invite acceptance — public. Peek shows the invite's academy
  // + inviter so the accept page can greet the invitee before they set a password.
  @Get("invite/:token")
  peekInvite(@Param("token") token: string) {
    return this.auth.peekInvite(token);
  }
  @Post("accept-invite")
  acceptInvite(@Body() body: any, @Req() req: any, @Res({ passthrough: true }) res: any) {
    clearHostOnlyTwin(req, res);
    return this.auth.acceptInvite(body, req.session);
  }
}
