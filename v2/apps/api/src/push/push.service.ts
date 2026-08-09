// Phase 7m: Web Push (VAPID) delivery service.
//
// Wraps `web-push` so callers can `pushService.sendToUser(userId, payload)`
// and get every registered subscription hit in parallel. Dead subscriptions
// (410 Gone from the browser vendor) are pruned automatically so the store
// stays clean without a janitor job.
//
// Subscriptions live in `pushSubscriptions` (one row per browser/device):
//   { userId, endpoint (unique), keys: { p256dh, auth }, userAgent, createdAt, lastUsedAt }
// endpoint is the natural key — same device that resubscribes lands on the
// same row (upsert). We identify by (userId, endpoint) so a shared browser
// where two users sign in gets two separate rows.

import { Injectable } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const webpush = require("web-push");

export interface PushSubscriptionDoc {
  userId: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;                // where notificationclick should navigate
  tag?: string;                // group notifications (e.g. "streak" collapses previous)
  icon?: string;
  badge?: string;
}

@Injectable()
export class PushService {
  private readonly configured: boolean;
  constructor(@InjectConnection() private readonly conn: Connection) {
    const pub = process.env.VAPID_PUBLIC_KEY;
    const priv = process.env.VAPID_PRIVATE_KEY;
    const subj = process.env.VAPID_SUBJECT || "mailto:noreply@harinitharanjith.com";
    this.configured = !!(pub && priv);
    if (this.configured) {
      webpush.setVapidDetails(subj, pub, priv);
    } else {
      // eslint-disable-next-line no-console
      console.warn("[push] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY missing — push disabled");
    }
  }

  isConfigured(): boolean { return this.configured; }
  publicKey(): string | null { return process.env.VAPID_PUBLIC_KEY || null; }

  /** Upsert a subscription for a signed-in user. Returns { created: bool } so
   *  the client can toast "notifications on" the first time. */
  async subscribe(userId: string, sub: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent?: string): Promise<{ created: boolean }> {
    const now = new Date();
    const res = await this.conn.db!.collection("pushSubscriptions").updateOne(
      { userId, endpoint: sub.endpoint },
      { $set: { userId, endpoint: sub.endpoint, keys: sub.keys, userAgent: userAgent ?? null, lastUsedAt: now },
        $setOnInsert: { createdAt: now } },
      { upsert: true },
    );
    return { created: !!res.upsertedId };
  }

  async unsubscribe(userId: string, endpoint: string): Promise<{ removed: number }> {
    const res = await this.conn.db!.collection("pushSubscriptions").deleteOne({ userId, endpoint });
    return { removed: res.deletedCount ?? 0 };
  }

  async countFor(userId: string): Promise<number> {
    return this.conn.db!.collection("pushSubscriptions").countDocuments({ userId });
  }

  /** Fan-out to every subscription for a user. Returns { sent, failed, pruned }.
   *  A 410 Gone or 404 from the vendor is a permanent dead-sub signal — we
   *  delete that row so we don't keep retrying next time. Other errors get
   *  counted as failed but the row stays (transient network / server hiccup). */
  async sendToUser(userId: string, payload: PushPayload): Promise<{ sent: number; failed: number; pruned: number }> {
    if (!this.configured) return { sent: 0, failed: 0, pruned: 0 };
    const subs = await this.conn.db!.collection("pushSubscriptions")
      .find({ userId }, { projection: { endpoint: 1, keys: 1 } as any })
      .toArray();
    if (subs.length === 0) return { sent: 0, failed: 0, pruned: 0 };
    const body = JSON.stringify(payload);
    let sent = 0, failed = 0, pruned = 0;
    await Promise.all(subs.map(async (s: any) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, body);
        sent++;
      } catch (e: any) {
        const status = e?.statusCode ?? 0;
        if (status === 404 || status === 410) {
          await this.conn.db!.collection("pushSubscriptions").deleteOne({ endpoint: s.endpoint });
          pruned++;
        } else {
          failed++;
          // eslint-disable-next-line no-console
          console.warn("[push] send failed", { userId, endpoint: s.endpoint.slice(0, 60), status });
        }
      }
    }));
    if (sent > 0) {
      await this.conn.db!.collection("pushSubscriptions").updateMany({ userId }, { $set: { lastUsedAt: new Date() } });
    }
    return { sent, failed, pruned };
  }
}
