// Evening nudge for coaches on a review streak that's about to break.
//
// Fires once per candidate coach per calendar day when:
//   * they have an active review streak (>=2 days) as of yesterday
//   * they've reviewed 0 snaps TODAY
//   * server-local hour is inside NUDGE_WINDOW (13..15 UTC ≈ 18:30..21:00 IST)
//   * they haven't already been nudged today (coachStreakNudgedAt guard)
//
// Design mirrors CoachStarredDigestService: single-process setInterval,
// dedupe via a per-user stamp, fails-open per recipient.
//
// Opt-out: reuses the coachStarredDigestOptedOut flag so a coach who
// silenced the Sunday digest doesn't get pestered here either. A future
// slice can split the two channels if usage patterns show the split is
// worth it.

import { Injectable, OnModuleInit } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { sendMail } from "../lib/mail";
import { emailOptOutToken } from "../digest/email-optout.controller";

const TICK_MS = 10 * 60_000;   // 10-min scan cadence (same as weekly-digest)
const NUDGE_WINDOW_START_UTC = 13;   // 13:00 UTC = 18:30 IST
const NUDGE_WINDOW_END_UTC = 15;     // 15:00 UTC = 20:30 IST
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? "https://harinitharanjith.com";

@Injectable()
export class StreakNudgeService implements OnModuleInit {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  onModuleInit(): void {
    setTimeout(() => { this.tick().catch(() => {}); }, 25_000);
    setInterval(() => { this.tick().catch(() => {}); }, TICK_MS);
  }

  async tick(): Promise<void> {
    const now = new Date();
    const utcHour = now.getUTCHours();
    if (utcHour < NUDGE_WINDOW_START_UTC || utcHour >= NUDGE_WINDOW_END_UTC) return;
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const users = this.conn.db!.collection("users");
    // Candidate filter: coaches/owners with email, not opted out, not already
    // nudged today. Kept loose (500 cap) since the count query per-coach is
    // the expensive part.
    const candidates = await users.find({
      email: { $type: "string" },
      role: { $in: ["academy_owner", "coach"] as any },
      coachStarredDigestOptedOut: { $ne: true },
      $or: [{ coachStreakNudgedAt: { $exists: false } }, { coachStreakNudgedAt: { $lt: dayStart } }],
    }, { projection: { _id: 1, username: 1, email: 1 } as any }).limit(500).toArray();
    for (const u of candidates) {
      await this.checkAndNudge(u).catch((e) => {
        // eslint-disable-next-line no-console
        console.warn("[streak-nudge] failed for", u._id, e);
      });
    }
  }

  private async checkAndNudge(user: any): Promise<void> {
    const userId = String(user._id);
    const email = String(user.email).toLowerCase();
    const username = user.username || userId;
    // Fetch reviewedAt values for last 7d; enough to detect the streak's tail.
    const rows: any[] = await this.conn.db!.collection("classSnaps").find({
      byUserId: userId,
      reviewedAt: { $gte: new Date(Date.now() - 8 * 86_400_000) },
    }, { projection: { reviewedAt: 1 } as any }).limit(200).toArray();
    if (rows.length === 0) return;
    const dayStartMs = (d: Date) => { const c = new Date(d); c.setUTCHours(0, 0, 0, 0); return c.getTime(); };
    const today = dayStartMs(new Date());
    const days = new Set(rows.map((r) => dayStartMs(new Date(r.reviewedAt))));
    if (days.has(today)) return;   // already reviewed today -- streak safe
    // Count consecutive days ending YESTERDAY.
    let streak = 0;
    for (let i = 1; i <= 30; i++) {
      if (days.has(today - i * 86_400_000)) streak++;
      else break;
    }
    if (streak < 2) return;   // 1-day "streak" not worth nudging
    // Send + stamp. Fails-open so a mail hiccup doesn't wedge future scans
    // (retried on next tick).
    const unsubUrl = `${PUBLIC_ORIGIN}/v2api/api/me/email/unsubscribe?u=${encodeURIComponent(userId)}&c=coachStarred&t=${emailOptOutToken(userId, "coachStarred")}`;
    const subject = `⚠ Your ${streak}-day review streak is on the line`;
    const html = `
      <div style="font-family:system-ui,sans-serif;max-width:520px">
        <h2 style="color:#111;margin-bottom:4px">⚠ ${streak}-day streak at risk</h2>
        <p style="color:#666;margin-top:0">Hi ${username} — review one starred snap today and you keep the streak alive.</p>
        <p style="margin:14px 0"><a href="${PUBLIC_ORIGIN}/academy?starred=1&hidedone=1" style="display:inline-block;background:#2563eb;color:white;text-decoration:none;padding:8px 16px;border-radius:8px;font-weight:600">Open your shortlist →</a></p>
        <p style="color:#9ca3af;font-size:11px;margin-top:24px">
          <a href="${unsubUrl}" style="color:#9ca3af;text-decoration:underline">Stop these emails</a>
        </p>
      </div>`;
    const text = [
      `⚠ ${streak}-day review streak at risk`, "",
      `Hi ${username} — review one starred snap today and you keep the streak alive.`, "",
      `Open your shortlist: ${PUBLIC_ORIGIN}/academy?starred=1&hidedone=1`, "",
      `Stop these emails: ${unsubUrl}`,
    ].join("\n");
    const r = await sendMail({ to: email, subject, html, text });
    if (r.ok) {
      await this.conn.db!.collection("users").updateOne(
        { _id: userId as any },
        { $set: { coachStreakNudgedAt: new Date() } }
      );
    }
  }
}
