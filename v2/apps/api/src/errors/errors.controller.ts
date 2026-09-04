// POST /api/client-error  — public crash sink for the browser (ErrorBoundary,
//   window.onerror, unhandledrejection). Deliberately unauthenticated: the
//   crashes worth knowing about include the ones that happen on the login page.
//   Every field is truncated and a per-IP limiter caps the damage a hostile
//   caller can do — worst case it wastes rows in a TTL'd collection.
//
// GET /api/admin/errors — the owner-facing view of everything the alerting
//   layer has recorded. Same CHESSGURU_ADMINS allowlist as the mail log.
import { Body, Controller, ForbiddenException, Get, Post, Query, Req } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { isAdmin } from "../admin/admins";
import { ErrorAlertsService } from "./error-alerts.service";

const PER_IP_PER_MIN = 10;
const hits = new Map<string, { n: number; resetAt: number }>();

@Controller()
export class ErrorsController {
  constructor(
    private readonly alerts: ErrorAlertsService,
    @InjectConnection() private readonly conn: Connection,
  ) {}

  @Post("client-error")
  clientError(@Req() req: any, @Body() body: any) {
    const ip = String(req.ip || "unknown");
    const now = Date.now();
    const h = hits.get(ip);
    if (!h || now > h.resetAt) hits.set(ip, { n: 1, resetAt: now + 60_000 });
    else if (++h.n > PER_IP_PER_MIN) return { ok: true, throttled: true };
    if (hits.size > 5000) for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k);

    this.alerts.report({
      kind: "client",
      message: String(body?.message || "(browser error)"),
      stack: body?.stack ? String(body.stack) : undefined,
      url: body?.url ? String(body.url) : undefined,
      route: body?.route ? String(body.route) : undefined,
      userId: req.session?.userId,
      academyId: req.session?.academyId,
      userAgent: req.headers?.["user-agent"],
      ip,
    });
    return { ok: true };
  }

  @Get("admin/errors")
  async list(@Req() req: any, @Query("kind") kind?: string, @Query("limit") limitRaw?: string) {
    if (!isAdmin(req.session?.userId)) throw new ForbiddenException("admin only");
    const limit = Math.min(500, Math.max(1, parseInt(String(limitRaw ?? "200"), 10) || 200));
    const q: any = {};
    if (kind === "server" || kind === "client" || kind === "slow") q.kind = kind;

    const col = this.conn.db!.collection("errorEvents");
    const rows = await col.find(q).sort({ at: -1 }).limit(limit).toArray();

    // "What is breaking most" — grouped by signature over the last 24h, so the
    // page leads with the repeat offenders instead of the newest one-off.
    const since = new Date(Date.now() - 86_400_000);
    const top = await col.aggregate([
      { $match: { ...q, at: { $gte: since } } },
      { $group: { _id: "$sig", n: { $sum: 1 }, kind: { $last: "$kind" }, message: { $last: "$message" }, route: { $last: "$route" }, last: { $max: "$at" } } },
      { $sort: { n: -1 } },
      { $limit: 20 },
    ]).toArray();

    const counts = await col.aggregate([
      { $match: { at: { $gte: since } } },
      { $group: { _id: "$kind", n: { $sum: 1 } } },
    ]).toArray();

    return { rows, top, counts };
  }
}
