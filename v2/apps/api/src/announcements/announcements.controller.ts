import { Body, Controller, ForbiddenException, Get, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import { AnnouncementsService, AnnouncementInput } from "./announcements.service";
import { isAdmin } from "../admin/admins";

@Controller()
export class AnnouncementsController {
  constructor(private readonly svc: AnnouncementsService) {}

  /** Public: powers the "What's new" strip on /signup-academy and later
   *  the in-app tray. No auth needed — nothing sensitive in an announcement. */
  @Get("announcements")
  async list(@Query("limit") limitRaw = "5") {
    const limit = Math.min(20, Math.max(1, parseInt(String(limitRaw), 10) || 5));
    const rows = await this.svc.list(limit);
    return rows.map((r) => ({
      id: String(r._id), title: r.title, body: r.body,
      ctaLabel: r.ctaLabel ?? null, ctaUrl: r.ctaUrl ?? null,
      category: r.category ?? null, emoji: r.emoji ?? null,
      publishedAt: r.publishedAt,
    }));
  }

  /** Admin-only: create + email-fanout. Body:
   *  { title, body, ctaLabel?, ctaUrl?, category?, emoji? } */
  @Post("admin/announcements")
  async publish(@Req() req: any, @Body() body: AnnouncementInput) {
    if (!req.session?.userId) throw new UnauthorizedException("login required");
    if (!isAdmin(req.session.userId)) throw new ForbiddenException("admin only");
    if (!body?.title || !body?.body) throw new ForbiddenException("title + body required");
    return this.svc.publish(body);
  }
}
