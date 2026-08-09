// Phase 7h: unsubscribe endpoint for the weekly digest.
// Stateless HMAC token — no per-user token rows to manage. On visit we flip
// the user's weeklyDigestOptedOut flag and return a small confirmation page.

import { Controller, Get, Query, Res, HttpException, HttpStatus } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { createHmac, timingSafeEqual } from "crypto";
type Response = any;

function secret(): string {
  return process.env.DIGEST_OPTOUT_SECRET || "chessguru-digest-dev-secret-set-env";
}

// Exported so WeeklyDigestService can bake the same token into its footer link.
export function digestOptOutToken(userId: string): string {
  return createHmac("sha256", secret()).update(`digest:${userId}`).digest("hex").slice(0, 32);
}

function verify(userId: string, tok: string): boolean {
  const expected = digestOptOutToken(userId);
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

@Controller("me/digest")
export class DigestOptOutController {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  // GET /api/me/digest/unsubscribe?u=<userId>&t=<hmac>
  // Sets weeklyDigestOptedOut=true on the user; idempotent.
  @Get("unsubscribe")
  async unsubscribe(@Query("u") u: string, @Query("t") t: string, @Res() res: Response) {
    const userId = String(u ?? "");
    const tok    = String(t ?? "");
    if (!userId || !verify(userId, tok)) {
      return res.status(HttpStatus.BAD_REQUEST).type("html").send(
        page("Link no longer valid", "This unsubscribe link doesn't check out. It may have been tampered with, or the account no longer exists.", "warn"),
      );
    }
    await this.conn.db!.collection("users").updateOne(
      { _id: userId as any },
      { $set: { weeklyDigestOptedOut: true, weeklyDigestOptedOutAt: new Date() } },
    );
    res.type("html").send(page(
      "You're unsubscribed.",
      "We won't send you the weekly progress digest anymore. You can turn it back on any time from your dashboard settings.",
      "ok",
    ));
  }
}
