import { Body, Controller, Get, Headers, Post, Req } from "@nestjs/common";
import { BillingService } from "./billing.service";

// GET  /api/academy/billing                → status (owner + coach)
// POST /api/academy/billing/order {months} → Razorpay order for Checkout (owner)
// POST /api/academy/billing/confirm {orderId, paymentId, signature} → verify + extend (owner)
@Controller("academy/billing")
export class BillingController {
  constructor(private readonly svc: BillingService) {}
  @Get() status(@Req() req: any) { return this.svc.status(req.session); }
  @Post("order") order(@Req() req: any, @Body() body: { months?: number }) { return this.svc.createOrder(req.session, body?.months); }
  @Post("confirm") confirm(@Req() req: any, @Body() body: { orderId?: string; paymentId?: string; signature?: string }) { return this.svc.confirm(req.session, body ?? {}); }
  // auto-renew: POST subscribe → Checkout with subscription_id → POST subscribe/confirm; POST subscribe/cancel stops at cycle end
  @Post("subscribe") subscribe(@Req() req: any, @Body() body: { period?: "monthly" | "yearly" }) { return this.svc.createSubscription(req.session, body?.period); }
  @Post("subscribe/confirm") subscribeConfirm(@Req() req: any, @Body() body: { subscriptionId?: string; paymentId?: string; signature?: string }) { return this.svc.confirmSubscription(req.session, body ?? {}); }
  @Post("subscribe/cancel") subscribeCancel(@Req() req: any) { return this.svc.cancelSubscription(req.session); }
}

// POST /api/billing/webhook/razorpay — Razorpay → ChessGuru (raw body preserved in main.ts for the HMAC check)
@Controller("billing/webhook")
export class BillingWebhookController {
  constructor(private readonly svc: BillingService) {}
  @Post("razorpay") razorpay(@Req() req: any, @Headers("x-razorpay-signature") sig: string, @Body() body: any) { return this.svc.webhook(req.rawBody, sig ?? "", body); }
}
