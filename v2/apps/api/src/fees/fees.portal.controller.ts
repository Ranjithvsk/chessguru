// Public parent portal — no session auth. The URL carries a HMAC-signed token
// bound to (academyId, guardianUserId); every method re-verifies it. Anyone
// with the URL can act on this guardian's students — that's the whole point
// of the magic-link model.

import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Req, Res } from "@nestjs/common";
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

  @Post("razorpay")
  async razorpay(@Req() req: any, @Res() res: any) {
    const sig = String(req.headers["x-razorpay-signature"] ?? "").trim();
    // rawBody is populated by the raw-body middleware wired up in main.ts (see
    // that file for the express.raw() route matcher). Falls back to
    // JSON.stringify of body only if the middleware missed us — that path
    // will fail signature verification, but the error is clean.
    const raw: string = (req.rawBody as Buffer | string | undefined)
      ? (typeof req.rawBody === "string" ? req.rawBody : (req.rawBody as Buffer).toString("utf8"))
      : JSON.stringify(req.body ?? {});
    try {
      const r = await this.svc.handleWebhook(raw, sig);
      res.status(200).json(r);
    } catch (e) {
      // RZP will retry on 5xx. Return 4xx for bad signatures + bad payloads so
      // we don't get retried forever on garbage. Log for the ops dashboard.
      const status = (e as { status?: number })?.status ?? 400;
      console.warn("[fees-webhook] rejected:", (e as Error).message);
      res.status(status).json({ ok: false, error: (e as Error).message });
    }
  }
}
