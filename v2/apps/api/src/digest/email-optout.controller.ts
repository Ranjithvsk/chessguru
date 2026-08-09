// Phase 7j: unified email-channel opt-out endpoint.
//
// Replaces the digest-specific unsubscribe with a channel-aware version. One
// URL shape (`/api/me/email/unsubscribe?u=<userId>&c=<channel>&t=<token>`)
// serves every transactional-email channel we add — currently `digest` and
// `streak`. Each channel has its own HMAC token so a leaked digest URL can't
// silently disable streak reminders too.
//
// Old `/api/me/digest/unsubscribe` still lives (see digest-optout.controller)
// so historic email links keep working — we just prefer the new URL going
// forward.

import { Controller, Get, Query, Res, HttpStatus } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { createHmac, timingSafeEqual } from "crypto";
type Response = any;

type Channel = "digest" | "streak" | "coachStarred";
const CHANNEL_FIELD: Record<Channel, string> = {
  digest: "weeklyDigestOptedOut",
  streak: "streakReminderOptedOut",
  coachStarred: "coachStarredDigestOptedOut",
};
const CHANNEL_LABEL: Record<Channel, string> = {
  digest: "weekly progress digest",
  streak: "streak reminders",
  coachStarred: "weekly starred-snap digest for coaches",
};

function secret(): string {
  return process.env.DIGEST_OPTOUT_SECRET || "chessguru-digest-dev-secret-set-env";
}

/** Exported so senders (WeeklyDigestService, StreakReminderService) can bake
 *  the same token into their footer links. Channel is part of the HMAC input
 *  so a token good for `digest` can't be swapped in for `streak`. */
export function emailOptOutToken(userId: string, channel: Channel): string {
  return createHmac("sha256", secret()).update(`${channel}:${userId}`).digest("hex").slice(0, 32);
}

function verify(userId: string, channel: Channel, tok: string): boolean {
  const expected = emailOptOutToken(userId, channel);
  if (typeof tok !== "string" || tok.length !== expected.length) return false;
  try { return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(tok, "hex")); }
  catch { return false; }
}

const page = (title: string, body: string, tone: "ok" | "warn") => {
  const accent = tone === "ok" ? "#059669" : "#b45309";
  const bg     = tone === "ok" ? "#ecfdf5" : "#fffbeb";
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]!));
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head><body style="font-family:system-ui,-apple-system,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:32px;min-height:100vh;box-sizing:border-box">
    <div style="max-width:480px;margin:60px auto;background:${bg};color:#111;border-radius:16px;padding:32px 28px;box-shadow:0 20px 60px rgba(0,0,0,.4)">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:${accent};font-weight:600">ChessGuru</div>
      <h1 style="font-size:22px;margin:8px 0 12px;color:#111">${esc(title)}</h1>
      <p style="color:#374151;font-size:14px;line-height:1.55;margin:0">${esc(body)}</p>
    </div>
  </body></html>`;
};

@Controller("me/email")
export class EmailOptOutController {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  // GET /api/me/email/unsubscribe?u=<userId>&c=<channel>&t=<hmac>
  @Get("unsubscribe")
  async unsubscribe(
    @Query("u") u: string,
    @Query("c") c: string,
    @Query("t") t: string,
    @Res() res: Response,
  ) {
    const userId = String(u ?? "");
    const chan   = String(c ?? "") as Channel;
    const tok    = String(t ?? "");
    if (!userId || !(chan in CHANNEL_FIELD) || !verify(userId, chan, tok)) {
      return res.status(HttpStatus.BAD_REQUEST).type("html").send(
        page("Link no longer valid", "This unsubscribe link doesn't check out. It may have been tampered with, or the account no longer exists.", "warn"),
      );
    }
    const field = CHANNEL_FIELD[chan];
    const label = CHANNEL_LABEL[chan];
    await this.conn.db!.collection("users").updateOne(
      { _id: userId as any },
      { $set: { [field]: true, [`${field}At`]: new Date() } },
    );
    res.type("html").send(page(
      "You're unsubscribed.",
      `We won't send you ${label} anymore. You can turn them back on any time from your dashboard settings.`,
      "ok",
    ));
  }
}
