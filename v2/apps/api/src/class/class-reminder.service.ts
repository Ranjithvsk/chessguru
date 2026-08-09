// Phase 6d: class-reminder scheduler.
//
// Runs a small setInterval inside the Nest process. Every minute it looks for
// scheduled classes starting within the next REMIND_WINDOW_MIN minutes that
// haven't had their reminder queued yet, and emails each invitee + the coach
// with a short "your class starts soon" note including the join link.
//
// Design:
//   * Single-process only (setInterval on the API pod). If we ever run more
//     than one API replica we should move this to a BullMQ job with a Redis
//     lock — but until then the atomic findOneAndUpdate below is enough to
//     de-dupe against a double tick.
//   * "Reminder queued" is a one-way state — reminderSentAt is set to now()
//     as soon as we START emailing, not after. Belt-and-braces against a
//     crash-and-restart mid-batch resending to everyone.
//   * Coach's email pulled from the users collection via createdByUserId.
//     Anonymous-coach classes still get their invitees pinged.
//   * Failure to send an individual invitee is logged but doesn't roll back
//     reminderSentAt — half a batch is better than an infinite retry loop.

import { Injectable, OnModuleInit } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { sendMail } from "../lib/mail";

const TICK_MS = 60_000;                    // scan cadence
const REMIND_WINDOW_MIN = 15;              // fire when startAt is within this many minutes
// Public origin used in email join links. Falls back to the DNS name we know
// this API is behind; overridable in prod via env.
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? "https://harinitharanjith.com";

@Injectable()
export class ClassReminderService implements OnModuleInit {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  onModuleInit(): void {
    // Kick off shortly after boot so we don't race with Nest wiring, then tick
    // every minute. In-process only — see the header comment.
    setTimeout(() => { this.tick().catch(() => {}); }, 5_000);
    setInterval(() => { this.tick().catch(() => {}); }, TICK_MS);
  }

  async tick(): Promise<void> {
    const now = new Date();
    const soon = new Date(now.getTime() + REMIND_WINDOW_MIN * 60_000);
    const schedules = this.conn.db!.collection("classSchedules");
    // Grab everything eligible in one go (small list — a busy day has maybe
    // 20 classes total, most of them not in the window).
    const candidates = await schedules.find({
      startAt: { $gt: now, $lte: soon },
      $or: [{ reminderSentAt: null }, { reminderSentAt: { $exists: false } }],
    }).limit(50).toArray();
    if (candidates.length === 0) return;
    for (const row of candidates) {
      // Claim the row so a second tick (or a peer process if we ever multi-instance)
      // can't re-send. If we don't win the claim, skip — someone else got it.
      const claimed: any = await schedules.findOneAndUpdate(
        { _id: row._id, $or: [{ reminderSentAt: null }, { reminderSentAt: { $exists: false } }] },
        { $set: { reminderSentAt: now } },
        { returnDocument: "before" } as any,
      );
      const target = claimed?.value ?? claimed;
      if (!target || !target._id) continue;   // lost the race
      await this.sendFor(target).catch((e) => {
        // eslint-disable-next-line no-console
        console.warn("[class-reminder] send failed for", row._id, e);
      });
    }
  }

  private async sendFor(row: any): Promise<void> {
    // Collect recipient set — coach + invitees, deduped, lowercased.
    const recipients = new Set<string>();
    if (Array.isArray(row.invitees)) {
      for (const inv of row.invitees) {
        if (inv?.email && typeof inv.email === "string") recipients.add(inv.email.toLowerCase());
      }
    }
    if (row.createdByUserId) {
      const user: any = await this.conn.db!.collection("users").findOne({ _id: row.createdByUserId as any });
      if (user?.email && typeof user.email === "string") recipients.add(String(user.email).toLowerCase());
    }
    if (recipients.size === 0) return;

    const joinUrl = `${PUBLIC_ORIGIN}/class/${encodeURIComponent(row._id)}`;
    const start = new Date(row.startAt);
    const when = start.toLocaleString(undefined, {
      weekday: "short", day: "numeric", month: "short",
      hour: "numeric", minute: "2-digit",
    });
    const minsAway = Math.max(1, Math.round((start.getTime() - Date.now()) / 60_000));
    const subject = `Reminder: ${row.title} starts in ${minsAway} min`;
    const text = [
      `${row.title}`,
      ``,
      `Starts: ${when} (in ${minsAway} min)`,
      `Coach:  ${row.coach}`,
      `Duration: ${row.durationMin} min`,
      row.notes ? `Notes: ${row.notes}` : "",
      ``,
      `Join the class:`,
      joinUrl,
      ``,
      `— ChessGuru`,
    ].filter(Boolean).join("\n");
    const html = `
      <div style="font-family:system-ui,-apple-system,sans-serif;line-height:1.55;color:#111;max-width:520px">
        <div style="background:linear-gradient(135deg,#6d28d9,#4338ca);color:#fff;padding:20px 24px;border-radius:12px 12px 0 0">
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;opacity:.75">Class reminder</div>
          <div style="font-size:22px;font-weight:700;margin-top:4px">${escapeHtml(row.title)}</div>
          <div style="font-size:13px;margin-top:6px;opacity:.85">${escapeHtml(when)} · in ${minsAway} min</div>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:0;padding:20px 24px;border-radius:0 0 12px 12px">
          <div style="font-size:14px;color:#374151">
            👑 Coach: <b>${escapeHtml(row.coach)}</b> · ${row.durationMin} min
          </div>
          ${row.notes ? `<p style="font-size:13px;color:#4b5563;margin:12px 0">${escapeHtml(row.notes)}</p>` : ""}
          <p style="margin:20px 0">
            <a href="${escapeAttr(joinUrl)}"
               style="display:inline-block;background:linear-gradient(90deg,#7c3aed,#3b82f6);color:#fff;
                      padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px">
              ▶ Join the class
            </a>
          </p>
          <p style="font-size:11px;color:#9ca3af;margin-top:20px">
            Direct link: <a href="${escapeAttr(joinUrl)}" style="color:#6b7280">${escapeHtml(joinUrl)}</a>
          </p>
        </div>
      </div>
    `;
    // Fire in parallel. Individual send failures are logged inside sendMail;
    // we don't unwind reminderSentAt so a Resend hiccup doesn't cause a resend storm.
    await Promise.all([...recipients].map((to) => sendMail({ to, subject, html, text })));
  }
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]!));
}
function escapeAttr(s: string): string { return escapeHtml(s); }
