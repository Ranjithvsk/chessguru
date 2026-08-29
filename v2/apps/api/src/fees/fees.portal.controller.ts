// Public parent portal — no session auth. The URL carries a HMAC-signed token
// bound to (academyId, guardianUserId); every method re-verifies it. Anyone
// with the URL can act on this guardian's students — that's the whole point
// of the magic-link model.

import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Req, Res } from "@nestjs/common";
// Param is used by both controllers below; keep it in the top import.
import { FeesPortalService } from "./fees.portal.service";
import { CreateCheckoutOrderInput } from "./fees.types";

// Portal path scheme: /api/fees/portal/:token?g=<guardianUserId>&a=<academyId>
// (The token is deterministic HMAC of academyId+guardianUserId — we accept
// both from the query and verify.)
@Controller("fees/portal")
export class FeesPortalController {
  constructor(private readonly svc: FeesPortalService) {}

  @Get(":token")
  async portalView(@Param("token") token: string, @Query("g") g?: string, @Query("a") a?: string) {
    if (!g || !a) throw new ForbiddenException("Missing portal parameters.");
    return this.svc.portalView(token, a, g);
  }

  @Post(":token/checkout")
  async createCheckout(
    @Param("token") token: string,
    @Query("g") g: string,
    @Query("a") a: string,
    @Body() body: CreateCheckoutOrderInput,
  ) {
    if (!g || !a) throw new ForbiddenException("Missing portal parameters.");
    const invoiceIds = Array.isArray(body?.invoiceIds) ? body.invoiceIds : [];
    return this.svc.createCheckoutOrder(token, a, g, invoiceIds);
  }

  @Get(":token/payments")
  async recentPayments(@Param("token") token: string, @Query("g") g: string, @Query("a") a: string) {
    if (!g || !a) throw new ForbiddenException("Missing portal parameters.");
    return { payments: await this.svc.recentPaymentsForGuardian(token, a, g) };
  }
}

// Webhook — separate controller so the raw-body middleware only wraps this
// path. Signature verification needs the exact bytes RZP signed, not the
// JSON.stringify-again roundtrip Nest gives you by default.
@Controller("fees/webhook")
export class FeesWebhookController {
  constructor(private readonly svc: FeesPortalService) {}

  // Per-tenant webhook URL: each academy configures
  // https://chessguru.cc/v2api/api/fees/webhook/razorpay/<academyId> in their
  // own Razorpay dashboard, using their own webhook secret stored in
  // fees_settings. Multi-tenant safe.
  @Post("razorpay/:academyId")
  async razorpay(@Req() req: any, @Res() res: any, @Param("academyId") academyId: string) {
    const sig = String(req.headers["x-razorpay-signature"] ?? "").trim();
    const raw: string = (req.rawBody as Buffer | string | undefined)
      ? (typeof req.rawBody === "string" ? req.rawBody : (req.rawBody as Buffer).toString("utf8"))
      : JSON.stringify(req.body ?? {});
    try {
      const r = await this.svc.handleWebhook(raw, sig, academyId);
      res.status(200).json(r);
    } catch (e) {
      const status = (e as { status?: number })?.status ?? 400;
      console.warn("[fees-webhook] rejected:", (e as Error).message);
      res.status(status).json({ ok: false, error: (e as Error).message });
    }
  }
}
