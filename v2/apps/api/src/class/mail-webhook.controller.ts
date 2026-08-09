// Phase 6o: Resend delivery-status webhook.
//
// Resend posts events like { type: "email.delivered", data: { email_id, ... } }
// as JSON to a URL configured in the Resend dashboard. We match against
// classMailLog by resendId and stamp a status field the UI can render.
//
// Auth: header shared-secret (RESEND_WEBHOOK_SECRET) — Resend supports Svix-
// signed webhooks, but a shared secret is enough for us (this endpoint only
// writes a status field on rows we already own, and the secret gates writes).
// If the env var is unset we accept every POST — fine for dev, do NOT ship to
// prod without setting the secret.

import { Body, Controller, Headers, HttpCode, HttpException, HttpStatus, Post } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";

const KNOWN = new Set([
  "email.delivered", "email.bounced", "email.complained",
  "email.delivery_delayed", "email.opened", "email.clicked",
]);

// UI-friendly buckets — the raw Resend event names are noisy for humans.
function bucket(kind: string): "delivered" | "bounced" | "complained" | "delayed" | "opened" | "clicked" | null {
  switch (kind) {
    case "email.delivered":        return "delivered";
    case "email.bounced":          return "bounced";
    case "email.complained":       return "complained";
    case "email.delivery_delayed": return "delayed";
    case "email.opened":           return "opened";
    case "email.clicked":          return "clicked";
    default:                       return null;
  }
}

@Controller("mail")
export class MailWebhookController {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  @Post("resend-webhook")
  @HttpCode(200) // Resend retries anything that isn't 2xx — we always claim success once auth passes
  async webhook(@Body() body: any, @Headers("x-webhook-secret") sharedSecret?: string) {
    const expected = process.env.RESEND_WEBHOOK_SECRET;
    if (expected && sharedSecret !== expected) {
      throw new HttpException("bad secret", HttpStatus.UNAUTHORIZED);
    }
    const kind = String(body?.type ?? "");
    if (!KNOWN.has(kind)) return { ok: true, skipped: "unknown-type" };
    const emailId = String(body?.data?.email_id ?? body?.data?.id ?? "");
    if (!emailId) return { ok: true, skipped: "no-email-id" };
    const status = bucket(kind);
    if (!status) return { ok: true, skipped: "no-bucket" };
    // Once a message is bounced/complained we don't let a later "opened" downgrade
    // that — hard failures are the story the coach cares about.
    const isTerminal = status === "bounced" || status === "complained";
    await this.conn.db!.collection("classMailLog").updateMany(
      { resendId: emailId, ...(isTerminal ? {} : { status: { $nin: ["bounced", "complained"] } }) },
      { $set: { status, statusAt: new Date() } },
    );
    return { ok: true };
  }
}
