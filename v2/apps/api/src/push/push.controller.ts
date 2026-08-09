// Phase 7m: signed-in-user push subscription endpoints + a self-test button
// so we can prove the pipeline end-to-end without waiting for the evening
// streak-reminder cron.

import { Body, Controller, Delete, Get, HttpException, HttpStatus, Post, Req } from "@nestjs/common";
import { PushService } from "./push.service";

@Controller("me/push")
export class PushController {
  constructor(private readonly push: PushService) {}

  /** Public VAPID key + configured flag. The frontend needs the key to
   *  subscribe; the flag lets us hide the toggle when push isn't wired on
   *  the server (missing env vars in dev). */
  @Get("vapid-key")
  vapidKey() {
    return { key: this.push.publicKey(), configured: this.push.isConfigured() };
  }

  /** POST { endpoint, keys: { p256dh, auth } } — save this browser's
   *  subscription for the signed-in user. Idempotent (upsert by endpoint). */
  @Post("subscribe")
  async subscribe(@Req() req: any, @Body() body: any) {
    const userId: string | null = req?.session?.userId ?? null;
    if (!userId) throw new HttpException("sign in required", HttpStatus.UNAUTHORIZED);
    if (!body?.endpoint || !body?.keys?.p256dh || !body?.keys?.auth) {
      throw new HttpException("missing subscription fields", HttpStatus.BAD_REQUEST);
    }
    const ua = String(req?.headers?.["user-agent"] ?? "").slice(0, 240) || undefined;
    return this.push.subscribe(userId, { endpoint: body.endpoint, keys: body.keys }, ua);
  }

  /** DELETE with body { endpoint } — remove this one subscription for the
   *  signed-in user. Client calls this alongside the PushManager.unsubscribe(). */
  @Delete("subscribe")
  async unsubscribe(@Req() req: any, @Body() body: any) {
    const userId: string | null = req?.session?.userId ?? null;
    if (!userId) throw new HttpException("sign in required", HttpStatus.UNAUTHORIZED);
    if (!body?.endpoint) throw new HttpException("missing endpoint", HttpStatus.BAD_REQUEST);
    return this.push.unsubscribe(userId, body.endpoint);
  }

  /** Self-test: sends a notification to every subscription the caller owns.
   *  Used by the Dashboard "Send test" button so users can confirm push works
   *  before relying on it for streak reminders. */
  @Post("test")
  async test(@Req() req: any) {
    const userId: string | null = req?.session?.userId ?? null;
    if (!userId) throw new HttpException("sign in required", HttpStatus.UNAUTHORIZED);
    const result = await this.push.sendToUser(userId, {
      title: "ChessGuru — push works! ✅",
      body: "You'll get streak reminders and other nudges here.",
      url: "/dashboard",
      tag: "cg-test",
    });
    return { ok: true, ...result };
  }
}
