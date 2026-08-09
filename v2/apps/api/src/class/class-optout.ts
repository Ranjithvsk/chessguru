// Phase 6g: per-invitee unsubscribe link.
//
// Every reminder email carries an "Stop reminders for this class" link with a
// stateless HMAC token — no pre-generated per-invitee tokens to manage. The
// token is HMAC-SHA256(classId + ":" + email-lowercased, SECRET); we verify
// server-side before recording the opt-out into the classOptOuts collection.
//
// Design:
//   * Stateless = no need to write a token row on every reminder send.
//   * Constant-time compare so a leaked token can't be brute-forced past the
//     hash (a real attacker would need SECRET to forge one, but doing it
//     right is cheap).
//   * Two endpoints:
//       GET  /class/:id/unsubscribe?email=X&t=Y  → one-click opt-out
//       POST /class/:id/resubscribe?email=X&t=Y  → change of mind, same page
//   * Response is a tiny standalone HTML page (no SPA routing needed for a
//     one-shot action from an email client).

import { Controller, Get, Post, Param, Query, Req, Res, HttpException, HttpStatus } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { createHmac, timingSafeEqual } from "crypto";
type Response = any;

const ROOM_RE = /^[A-Za-z0-9_-]{4,64}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// SECRET only needs to be stable across restarts so already-mailed links stay
// valid. Falls back to a fixed dev string when the env var is missing (fine
// for local — in prod set CLASS_OPTOUT_SECRET to a real random value).
function secret(): string {
  return process.env.CLASS_OPTOUT_SECRET || "chessguru-optout-dev-secret-set-env";
}

// Public helper: build the token for (classId, email) so the reminder mailer
// can drop the link directly into the email body.
export function optOutToken(classId: string, email: string): string {
  return createHmac("sha256", secret())
    .update(`${classId}:${email.trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 32); // 128 bits of tag is plenty for a link that already carries the email
}

function verifyToken(classId: string, email: string, tok: string): boolean {
  const expected = optOutToken(classId, email);
  if (typeof tok !== "string" || tok.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(tok, "hex"));
  } catch { return false; }
}

// Minimal branded confirmation page. Kept as a template literal so this file
// stays self-contained — no view engine, no SPA touch.
function page(title: string, subtitle: string, tone: "ok" | "warn", back?: { href: string; label: string }): string {
  const accent = tone === "ok" ? "#059669" : "#b45309";
  const bg     = tone === "ok" ? "#ecfdf5" : "#fffbeb";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="font-family:system-ui,-apple-system,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:32px;min-height:100vh;box-sizing:border-box">
  <div style="max-width:480px;margin:60px auto;background:${bg};color:#111;border-radius:16px;padding:32px 28px;box-shadow:0 20px 60px rgba(0,0,0,.4)">
    <div style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:${accent};font-weight:600">ChessGuru</div>
    <h1 style="font-size:22px;margin:8px 0 12px;color:#111">${escapeHtml(title)}</h1>
    <p style="color:#374151;font-size:14px;line-height:1.55;margin:0 0 20px">${escapeHtml(subtitle)}</p>
    ${back ? `<a href="${escapeAttr(back.href)}" style="display:inline-block;background:${accent};color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px">${escapeHtml(back.label)}</a>` : ""}
  </div>
</body></html>`;
}
function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]!));
}
function escapeAttr(s: string): string { return escapeHtml(s); }

@Controller("class")
export class ClassOptOutController {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  // GET /api/class/:id/unsubscribe?email=X&t=Y  — one-click opt-out from a
  // reminder email. Idempotent: repeated clicks after unsubscribing succeed
  // silently.
  @Get(":id/unsubscribe")
  async unsubscribe(@Param("id") id: string, @Query("email") emailRaw: string, @Query("t") tok: string, @Req() req: any, @Res() res: Response) {
    const email = String(emailRaw || "").trim().toLowerCase();
    if (!ROOM_RE.test(id) || !EMAIL_RE.test(email) || !verifyToken(id, email, tok)) {
      return res.status(HttpStatus.BAD_REQUEST).type("html").send(
        page("Link no longer valid", "This unsubscribe link doesn't check out. It may have been tampered with, or the class no longer exists.", "warn"),
      );
    }
    await this.conn.db!.collection("classOptOuts").updateOne(
      { classId: id, email },
      { $set: { classId: id, email, optedOutAt: new Date() } },
      { upsert: true },
    );
    // Build a resubscribe link so the user can undo without support intervention.
    const base = `${req.protocol}://${req.get("host")}`;
    const back = `${base}/api/class/${encodeURIComponent(id)}/resubscribe?email=${encodeURIComponent(email)}&t=${encodeURIComponent(tok)}`;
    res.type("html").send(page(
      "You're unsubscribed.",
      `We won't email ${email} about this class anymore. Changed your mind?`,
      "ok",
      { href: back, label: "↺ Resubscribe" },
    ));
  }

  // GET /api/class/:id/optouts — coach-only list of opted-out emails for a
  // class. Used by the edit overlay to warn coach that certain invitees have
  // silenced reminders (so the coach knows "why isn't Alice getting my
  // emails?"). Gated to the schedule's creator; returns 403 otherwise.
  @Get(":id/optouts")
  async listOptouts(@Param("id") id: string, @Req() req: any) {
    if (!ROOM_RE.test(id)) throw new HttpException("bad room", HttpStatus.BAD_REQUEST);
    const me: string | null = req?.session?.userId ?? null;
    if (!me) throw new HttpException("sign in required", HttpStatus.UNAUTHORIZED);
    const sched: any = await this.conn.db!.collection("classSchedules").findOne({ _id: id as any });
    if (!sched) throw new HttpException("not found", HttpStatus.NOT_FOUND);
    if (sched.createdByUserId !== me) throw new HttpException("only the creator can see opt-outs", HttpStatus.FORBIDDEN);
    const rows: any[] = await this.conn.db!.collection("classOptOuts")
      .find({ classId: id }, { sort: { optedOutAt: -1 } as any }).limit(500).toArray();
    return { emails: rows.map((r) => ({ email: r.email, optedOutAt: r.optedOutAt })) };
  }

  // POST /api/class/:id/resubscribe — same token, undo. Exposed as GET too so
  // it can be linked from the confirmation page above (browser navigation is
  // GET, mailto clients likewise). Symmetric with unsubscribe.
  @Get(":id/resubscribe")
  @Post(":id/resubscribe")
  async resubscribe(@Param("id") id: string, @Query("email") emailRaw: string, @Query("t") tok: string, @Res() res: Response) {
    const email = String(emailRaw || "").trim().toLowerCase();
    if (!ROOM_RE.test(id) || !EMAIL_RE.test(email) || !verifyToken(id, email, tok)) {
      return res.status(HttpStatus.BAD_REQUEST).type("html").send(
        page("Link no longer valid", "This link doesn't check out.", "warn"),
      );
    }
    await this.conn.db!.collection("classOptOuts").deleteOne({ classId: id, email });
    res.type("html").send(page(
      "Resubscribed.",
      `${email} will get class reminders again.`,
      "ok",
    ));
  }
}

// Fetch the set of opted-out emails for a class. Used by the reminder scheduler
// to filter recipients before sending. Cheap query; called at most once per
// class per stage-fire.
export async function loadOptOuts(conn: Connection, classId: string): Promise<Set<string>> {
  const rows: any[] = await conn.db!.collection("classOptOuts").find({ classId }).toArray();
  const out = new Set<string>();
  for (const r of rows) if (typeof r?.email === "string") out.add(r.email.toLowerCase());
  return out;
}
