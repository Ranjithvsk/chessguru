// Phase 7j: evening streak-save reminder.
//
// When a user has an active daily streak (≥ 3 days) and hasn't solved anything
// yet today, we send a single evening email to nudge them back in. Same
// building blocks as the weekly digest: Nest OnModuleInit, poll interval,
// server-local window, per-user dedup stamp, HMAC opt-out link.
//
// Why 3 days as the floor: below that, "streak" isn't a habit yet and a
// reminder just reads as spam. Above that, we're actually protecting something
// the user cares about (Duolingo established this pattern). ON by default —
// mirrors the weekly-digest choice; users can opt out from the email footer
// or from Dashboard → Email notifications.

import { Injectable, OnModuleInit } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { sendMail } from "../lib/mail";
import { emailOptOutToken } from "./email-optout.controller";
import { logMail } from "./mail-log";
import { PushService } from "../push/push.service";

const TICK_MS = 15 * 60_000;            // 15 min — narrower window than digest, still restart-tolerant
const WINDOW_HOUR_START = 18;           // 18:00–20:00 server-local
const WINDOW_HOUR_END   = 20;
const MIN_STREAK = 3;                   // habit threshold — below this we say nothing
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? "https://harinitharanjith.com";

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]!));
}

/** Reuse the streak calculation the dashboard shows so the reminder shows the
 *  same number the user sees on their homepage. `days` is a sparse list of
 *  active days (ISO yyyy-mm-dd). Current streak = today-and-back consecutive
 *  run, with a one-day grace for a today with no activity yet. */
function currentStreak(activeDays: string[]): number {
  if (activeDays.length === 0) return 0;
  const set = new Set(activeDays);
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const cursor = new Date(today);
  if (!set.has(iso(cursor))) cursor.setUTCDate(cursor.getUTCDate() - 1);
  let n = 0;
  while (set.has(iso(cursor))) { n++; cursor.setUTCDate(cursor.getUTCDate() - 1); }
  return n;
}

@Injectable()
export class StreakReminderService implements OnModuleInit {
  constructor(
    @InjectConnection() private readonly conn: Connection,
    private readonly push: PushService,
  ) {}

  onModuleInit(): void {
    setTimeout(() => { this.tick().catch(() => {}); }, 20_000);
    setInterval(() => { this.tick().catch(() => {}); }, TICK_MS);
  }

  async tick(): Promise<void> {
    const now = new Date();
    const hour = now.getHours();
    if (hour < WINDOW_HOUR_START || hour >= WINDOW_HOUR_END) return;

    const users = this.conn.db!.collection("users");
    // Only fire once per user per calendar day. streakReminderSentAt is stamped
    // by sendFor; today-start cutoff means yesterday's stamp doesn't block today.
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const candidates = await users.find({
      email: { $type: "string" },
      streakReminderOptedOut: { $ne: true },
      $or: [{ streakReminderSentAt: { $exists: false } }, { streakReminderSentAt: { $lt: todayStart } }],
    }, { projection: { _id: 1, username: 1, email: 1 } as any }).limit(500).toArray();

    for (const user of candidates) {
      await this.considerFor(user).catch((e) => {
        // eslint-disable-next-line no-console
        console.warn("[streak-reminder] failed for", user._id, e);
      });
    }
  }

  private async considerFor(user: any): Promise<void> {
    const userId = String(user._id);
    // Pull last 30 days of rounds for this user — enough to compute the
    // streak and check today's activity. Range scan on _id prefix stays
    // cheap even for heavy users.
    const lo = `${userId}:`, hi = `${userId};`;
    const since = new Date(Date.now() - 30 * 86_400_000);
    const rounds: any[] = await this.conn.db!.collection("rounds").find({
      _id: { $gte: lo, $lt: hi } as any,
      d: { $gte: since },
    }, { projection: { d: 1 } as any }).limit(500).toArray();
    if (rounds.length === 0) return;

    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const todayIso = iso(new Date());
    const days = new Set<string>();
    let solvedToday = false;
    for (const r of rounds) {
      const day = iso(new Date(r.d));
      days.add(day);
      if (day === todayIso) solvedToday = true;
    }
    if (solvedToday) {
      // Nothing to remind — stamp so we don't re-check every 15 min tonight.
      await this.conn.db!.collection("users").updateOne({ _id: userId as any }, { $set: { streakReminderSentAt: new Date() } });
      return;
    }
    const streak = currentStreak([...days]);
    if (streak < MIN_STREAK) return;   // not a habit worth protecting yet

    await this.send(userId, user.username || userId, String(user.email).toLowerCase(), streak);
    // Also fire a browser push if the user has subscribed devices. Same
    // trigger, redundant channel — whichever the user notices first is fine.
    await this.push.sendToUser(userId, {
      title: `🔥 Your ${streak}-day streak is at risk`,
      body: `One quick puzzle keeps it alive.`,
      url: "/",
      tag: "cg-streak",
    }).catch(() => { /* push failures are per-service logged; don't block the mark-as-sent */ });
    await this.conn.db!.collection("users").updateOne({ _id: userId as any }, { $set: { streakReminderSentAt: new Date() } });
  }

  private async send(userId: string, username: string, email: string, streak: number): Promise<void> {
    const tok = emailOptOutToken(userId, "streak");
    const unsubUrl = `${PUBLIC_ORIGIN}/v2api/api/me/email/unsubscribe?u=${encodeURIComponent(userId)}&c=streak&t=${tok}`;
    const solveUrl = `${PUBLIC_ORIGIN}/`;
    const subject = `🔥 Your ${streak}-day streak is at risk`;
    const text = [
      `Hi ${username},`,
      ``,
      `You're on a ${streak}-day solving streak — but you haven't done a puzzle yet today.`,
      `One quick puzzle keeps it alive.`,
      ``,
      `Solve now: ${solveUrl}`,
      ``,
      `— ChessGuru`,
      ``,
      `Stop streak reminders: ${unsubUrl}`,
    ].join("\n");
    const html = `
      <div style="font-family:system-ui,-apple-system,sans-serif;line-height:1.55;color:#111;max-width:520px">
        <div style="background:linear-gradient(135deg,#f97316,#e11d48);color:#fff;padding:26px 26px;border-radius:12px 12px 0 0">
          <div style="font-size:56px;line-height:1;margin-bottom:8px">🔥</div>
          <div style="font-size:22px;font-weight:700">${streak}-day streak</div>
          <div style="font-size:13px;opacity:.9;margin-top:4px">still ticking — but not for long</div>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:0;padding:24px 26px;border-radius:0 0 12px 12px">
          <p style="margin:0 0 12px;font-size:15px;color:#111">Hi ${escapeHtml(username)},</p>
          <p style="margin:0 0 18px;font-size:14px;color:#374151">
            You haven't solved a puzzle yet today. One quick puzzle keeps your <b>${streak}-day</b> streak alive.
          </p>
          <p style="margin:0">
            <a href="${escapeHtml(solveUrl)}"
               style="display:inline-block;background:linear-gradient(90deg,#f97316,#e11d48);color:#fff;
                      padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px">
              ⚡ Solve one now
            </a>
          </p>
          <p style="font-size:11px;color:#9ca3af;margin-top:24px;text-align:center">
            <a href="${escapeHtml(unsubUrl)}" style="color:#9ca3af;text-decoration:underline">Stop streak reminders</a>
          </p>
        </div>
      </div>`;
    const result = await sendMail({ to: email, subject, html, text });
    await logMail(this.conn, {
      userId, channel: "streak", email, subject,
      status: result.ok ? "sent" : "failed",
      messageId: result.id ?? null,
      error: result.error ?? null,
    });
  }
}
