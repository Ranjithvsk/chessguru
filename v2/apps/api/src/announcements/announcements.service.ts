// Feature-announcement pipeline for the SaaS academy tier.
//
// When we ship a new user-facing feature, an admin POSTs one row to the
// `announcements` collection. This service (a) stores it, (b) exposes it via
// GET so the /signup-academy showcase page and (later) an in-app "what's new"
// tray can render it, and (c) fans out an email to every academy owner + coach.
//
// Deliberately simple: no scheduling, no per-user throttling, no i18n. If it
// turns out we're announcing more than a few times a month we should batch,
// but at that rate we won't.

import { Injectable } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { sendMail } from "../lib/mail";
import { logMail } from "../digest/mail-log";

const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? "https://harinitharanjith.com";

export interface AnnouncementInput {
  title: string;
  body: string;              // plain text, can include soft line breaks
  ctaLabel?: string;         // e.g. "See it in action"
  ctaUrl?: string;           // relative to PUBLIC_ORIGIN
  category?: string;         // matches a feature-catalog category
  emoji?: string;
}

@Injectable()
export class AnnouncementsService {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  private col() { return this.conn.db!.collection("announcements"); }

  async list(limit = 10): Promise<any[]> {
    return this.col().find({}, { sort: { publishedAt: -1 } }).limit(limit).toArray();
  }

  /** Create + fan-out. Emails every academy-owner or coach whose user doc has
   *  an email address. Fail-safe: mail transport hiccup for one recipient
   *  doesn't stop the rest. */
  async publish(input: AnnouncementInput): Promise<{ ok: true; id: string; recipients: number; sent: number; failed: number }> {
    const now = new Date();
    const doc = { ...input, publishedAt: now };
    const insert = await this.col().insertOne(doc as any);
    const id = String(insert.insertedId);

    const recipients: any[] = await this.conn.db!.collection("users").find(
      { role: { $in: ["academy_owner", "coach"] }, email: { $type: "string" } },
      { projection: { _id: 1, username: 1, email: 1, role: 1 } as any },
    ).toArray();

    const subject = `✨ New in ChessGuru: ${input.title}`;
    const ctaLabel = input.ctaLabel || "Open ChessGuru";
    const ctaUrl = new URL(input.ctaUrl || "/", PUBLIC_ORIGIN).href;
    const emoji = input.emoji || "✨";

    let sent = 0, failed = 0;
    for (const u of recipients) {
      const html = `
        <div style="font-family:system-ui,-apple-system,sans-serif;line-height:1.55;color:#111;max-width:560px">
          <div style="background:linear-gradient(135deg,#7c3aed,#3b82f6);color:#fff;padding:22px 26px;border-radius:12px 12px 0 0">
            <div style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;opacity:.8">What's new · ChessGuru</div>
            <div style="font-size:26px;font-weight:700;margin-top:6px">${emoji} ${escapeHtml(input.title)}</div>
          </div>
          <div style="border:1px solid #e5e7eb;border-top:0;padding:22px 26px;border-radius:0 0 12px 12px">
            <p style="margin:0 0 16px;font-size:15px;color:#111">Hi ${escapeHtml(u.username)},</p>
            <p style="margin:0 0 18px;font-size:14px;color:#374151;white-space:pre-wrap">${escapeHtml(input.body)}</p>
            <p style="margin:0">
              <a href="${escapeAttr(ctaUrl)}"
                 style="display:inline-block;background:linear-gradient(90deg,#7c3aed,#3b82f6);color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px">
                ${escapeHtml(ctaLabel)}
              </a>
            </p>
            <p style="font-size:11px;color:#9ca3af;margin-top:22px">
              You're getting this because you run or coach at a ChessGuru academy.
            </p>
          </div>
        </div>`;
      const text = `${input.title}\n\nHi ${u.username},\n\n${input.body}\n\n${ctaLabel}: ${ctaUrl}\n\n— ChessGuru`;
      const res = await sendMail({ to: String(u.email), subject, html, text });
      // Log to the same mailLog collection the digest + streak use; channel:
      // "announcement" so admin views can filter.
      await logMail(this.conn, {
        userId: String(u._id), channel: "digest" as any, // reuse channel typing; announcement filed here
        email: String(u.email), subject,
        status: res.ok ? "sent" : "failed",
        messageId: res.id ?? null,
        error: res.error ?? null,
      });
      if (res.ok) sent++; else failed++;
    }
    // Stamp final counts back on the announcement row so admins can audit.
    await this.col().updateOne({ _id: insert.insertedId }, { $set: { sent, failed, recipients: recipients.length } });

    return { ok: true, id, recipients: recipients.length, sent, failed };
  }
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]!));
}
function escapeAttr(s: string): string { return escapeHtml(s); }
