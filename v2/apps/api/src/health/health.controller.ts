import { Controller, Get } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { BillingService } from "../billing/billing.service";

@Controller("health")
export class HealthController {
  constructor(@InjectConnection() private readonly conn: Connection, private readonly billing: BillingService) {}

  @Get()
  health() {
    return {
      status: "ok",
      service: "chessguru-v2-api",
      db: this.conn.readyState === 1 ? "connected" : "disconnected",
    };
  }

  /** GET /api/health/payments — for the fleet monitor (2026-09-13). Reports whether the
   *  subscription payment gateway works right now (read-only Razorpay call) and whether
   *  subscription payments have been failing in the last 24h. Public, no secrets in the body. */
  @Get("payments")
  async payments() {
    const gateway = await this.billing.gatewayProbe();
    const since = new Date(Date.now() - 24 * 3600_000);
    let failed24h = 0, captured24h = 0;
    try {
      const col = this.conn.db!.collection("billingPayments");
      [failed24h, captured24h] = await Promise.all([
        col.countDocuments({ at: { $gte: since }, status: { $in: ["failed", "FAILED", "error"] } }),
        col.countDocuments({ at: { $gte: since }, status: { $in: ["captured", "CAPTURED", "paid"] } }),
      ]);
    } catch { /* collection may not exist yet */ }
    const ok = gateway.configured && gateway.ok;
    return { status: ok ? "ok" : "degraded", gateway, subscriptions: { captured24h, failed24h }, at: new Date().toISOString() };
  }
}
