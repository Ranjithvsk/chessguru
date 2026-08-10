// Reminds in-scope students who haven't opened a shared study material.
//
// Triggers:
//   * Material must be at least 3 days old (fresh uploads should breathe).
//   * Student must be in scope (academy / coach-students / specific).
//   * Student must NOT have opened it (no materialReads row).
//   * Student hasn't been reminded for THIS material in the last 3 days
//     (composite _id on materialReminders keeps it idempotent per pair).
//   * Student hasn't opted out of the "materials" email channel.
//
// Channels: email (via dw-otp) + push (if the student subscribed).
//
// Runs autonomously every 6h. Coach can also fire on-demand via a REST
// endpoint on the MaterialsController ("Remind unread now" button).

import { Injectable, OnModuleInit } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { sendMail } from "../lib/mail";
import { logMail } from "../digest/mail-log";
import { emailOptOutToken } from "../digest/email-optout.controller";
import { PushService } from "../push/push.service";

const TICK_MS = 6 * 60 * 60_000;             // 6h cron
const MIN_AGE_MS = 3 * 86_400_000;           // don't nag before day 3
const COOLDOWN_MS = 3 * 86_400_000;          // 3-day reminder cooldown per pair
const MAX_MATERIALS_PER_TICK = 50;
const MAX_STUDENTS_PER_MATERIAL = 200;
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? "https://harinitharanjith.com";

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]!));
}

@Injectable()
export class MaterialReminderService implements OnModuleInit {
  constructor(
    @InjectConnection() private readonly conn: Connection,
    private readonly push: PushService,
  ) {}

  onModuleInit(): void {
    // Small startup delay so we don't compete with route mounting on boot.
    setTimeout(() => { this.tick().catch(() => {}); }, 60_000);
    setInterval(() => { this.tick().catch(() => {}); }, TICK_MS);
  }

  /** One pass over eligible materials. Safe to call repeatedly — the
   *  materialReminders composite _id upsert de-dupes across ticks. */
  async tick(): Promise<{ scanned: number; sent: number }> {
    const olderThan = new Date(Date.now() - MIN_AGE_MS);
    const materials = await this.conn.db!.collection("studyMaterials").find({
      hasFile: true, uploadedAt: { $lte: olderThan },
    }).sort({ uploadedAt: -1 }).limit(MAX_MATERIALS_PER_TICK).toArray();
    let sent = 0;
    for (const m of materials) {
      try { sent += await this.remindForMaterial(m); }
      catch (e) { console.warn("[material-reminder] failed for", m._id, e); }
    }
    return { scanned: materials.length, sent };
  }

  /** Coach on-demand entry: force-fire reminders for one material NOW,
   *  ignoring the age gate but still respecting the cooldown + opt-outs
   *  so a coach can't spam the same reader hourly. */
  async remindNow(materialId: string): Promise<{ sent: number; skipped: number }> {
    const m: any = await this.conn.db!.collection("studyMaterials").findOne({ _id: materialId as any });
    if (!m || !m.hasFile) return { sent: 0, skipped: 0 };
    const sent = await this.remindForMaterial(m);
    return { sent, skipped: 0 };
  }

  /** Core: for one material, find in-scope-and-unread-and-not-recently-reminded
   *  students and send them each an email + push. Returns count sent. */
  private async remindForMaterial(m: any): Promise<number> {
    const students = await this.audienceFor(m);
    if (students.length === 0) return 0;
    const studentIds = students.map((s: any) => String(s._id));

    // Subtract already-read.
    const reads = await this.conn.db!.collection("materialReads")
      .find({ materialId: String(m._id), userId: { $in: studentIds } }, { projection: { userId: 1 } })
      .toArray();
    const alreadyRead = new Set(reads.map((r: any) => String(r.userId)));

    // Subtract already-reminded within cooldown.
    const cooldownCutoff = new Date(Date.now() - COOLDOWN_MS);
    const recentReminders = await this.conn.db!.collection("materialReminders").find({
      materialId: String(m._id),
      userId: { $in: studentIds },
      lastSentAt: { $gte: cooldownCutoff },
    }, { projection: { userId: 1 } }).toArray();
    const recentlyReminded = new Set(recentReminders.map((r: any) => String(r.userId)));

    const targets = students.filter((s: any) =>
      !alreadyRead.has(String(s._id)) &&
      !recentlyReminded.has(String(s._id)) &&
      !s.materialRemindersOptedOut
    ).slice(0, MAX_STUDENTS_PER_MATERIAL);

    if (targets.length === 0) return 0;

    let sentCount = 0;
    for (const student of targets) {
      try {
        await this.sendOne(m, student);
        sentCount++;
      } catch (e) { console.warn("[material-reminder] send failed", student._id, e); }
    }
    return sentCount;
  }

  private async audienceFor(m: any): Promise<any[]> {
    const filter: any = { role: "student", academyId: m.academyId };
    if (m.scope === "academy") {
      // Every student in the academy.
    } else if (m.scope === "coach-students") {
      filter.coachId = m.coachId;
    } else if (m.scope === "specific-students") {
      const ids: string[] = Array.isArray(m.targetStudentIds) ? m.targetStudentIds : [];
      if (ids.length === 0) return [];
      filter._id = { $in: ids };
    } else return [];
    return this.conn.db!.collection("users").find(filter, {
      projection: { _id: 1, username: 1, email: 1, materialRemindersOptedOut: 1 },
    }).limit(500).toArray();
  }

  private async sendOne(m: any, student: any): Promise<void> {
    const userId = String(student._id);
    const now = new Date();
    // Stamp the reminder row FIRST so a mid-send crash doesn't cause duplicate
    // sends when we restart — the cooldown check will exclude this user next tick.
    await this.conn.db!.collection("materialReminders").updateOne(
      { _id: `${m._id}:${userId}` as any },
      {
        $setOnInsert: { materialId: String(m._id), userId, firstSentAt: now },
        $set: { lastSentAt: now },
        $inc: { sends: 1 },
      },
      { upsert: true },
    );

    // Push (best-effort; skip students with no subscription).
    await this.push.sendToUser(userId, {
      title: `📚 New material from ${m.coachName || "your coach"}`,
      body: m.title,
      url: "/dashboard#materials",
      tag: `cg-material-${m._id}`,
    }).catch(() => { /* per-service logged */ });

    // Email (fail-safe — only if the student has an address on file).
    if (typeof student.email === "string" && student.email.length > 0) {
      const email = String(student.email).toLowerCase();
      const unsubUrl = `${PUBLIC_ORIGIN}/v2api/api/me/email/unsubscribe?u=${encodeURIComponent(userId)}&c=materials&t=${emailOptOutToken(userId, "materials")}`;
      const openUrl = `${PUBLIC_ORIGIN}/v2api/api/materials/${encodeURIComponent(String(m._id))}/file`;
      const dashboardUrl = `${PUBLIC_ORIGIN}/dashboard`;
      const subject = `📚 Study material waiting: ${m.title}`;
      const text = [
        `Hi ${student.username || userId},`,
        ``,
        `Your coach shared "${m.title}" and it's still waiting to be opened.`,
        m.description ? `\n${m.description}\n` : "",
        `Open it: ${openUrl}`,
        `All your materials: ${dashboardUrl}`,
        ``,
        `— ChessGuru`,
        ``,
        `Stop reminders about materials: ${unsubUrl}`,
      ].join("\n");
      const html = `
        <div style="font-family:system-ui,-apple-system,sans-serif;line-height:1.55;color:#111;max-width:520px">
          <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;padding:22px 26px;border-radius:12px 12px 0 0">
            <div style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;opacity:.85">Study material · Reminder</div>
            <div style="font-size:22px;font-weight:700;margin-top:6px">📚 ${escapeHtml(m.title)}</div>
          </div>
          <div style="border:1px solid #e5e7eb;border-top:0;padding:22px 26px;border-radius:0 0 12px 12px">
            <p style="margin:0 0 12px;font-size:15px;color:#111">Hi ${escapeHtml(student.username || userId)},</p>
            <p style="margin:0 0 18px;font-size:14px;color:#374151">
              ${escapeHtml(m.coachName || "Your coach")} shared this ${describeAge(m.uploadedAt)} and you haven't opened it yet.
            </p>
            ${m.description ? `<p style="margin:0 0 18px;font-size:14px;color:#4b5563;white-space:pre-wrap">${escapeHtml(m.description)}</p>` : ""}
            <p style="margin:0">
              <a href="${escapeHtml(openUrl)}"
                 style="display:inline-block;background:linear-gradient(90deg,#6366f1,#8b5cf6);color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px">
                Open now
              </a>
            </p>
            <p style="font-size:11px;color:#9ca3af;margin-top:22px;text-align:center">
              <a href="${escapeHtml(unsubUrl)}" style="color:#9ca3af;text-decoration:underline">Stop material reminders</a>
            </p>
          </div>
        </div>`;
      const res = await sendMail({ to: email, subject, html, text });
      await logMail(this.conn, {
        userId, channel: "digest" as any,   // reuse mailLog typing; announce/material both file here
        email, subject,
        status: res.ok ? "sent" : "failed",
        messageId: res.id ?? null,
        error: res.error ?? null,
      });
    }
  }
}

function describeAge(iso: any): string {
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return "recently";
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  const weeks = Math.round(days / 7);
  return weeks === 1 ? "a week ago" : `${weeks} weeks ago`;
}
