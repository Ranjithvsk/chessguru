// Phase 7h: weekly progress digest.
//
// Sunday morning email (server-local ~8-10am window) with each user's past-7-day
// puzzle stats: solves, wins, accuracy, rating delta, top-active hour, best
// solve time. Opt-out via HMAC-signed link in the footer (matches the class-
// reminder unsubscribe pattern).
//
// Design mirrors ClassReminderService:
//   * Single-process only (setInterval on the API pod). If we ever scale out we
//     need a lock; for now the digestSentAt stamp de-dupes a double tick.
//   * Frequent poll (10 min) so we always land inside the 8-10am window with a
//     tolerance for restarts; each user only gets one email per week (guarded
//     by digestSentAt < 6 days ago check).
//   * Fails-open on the mail transport — a Resend hiccup for one user doesn't
//     block the loop for the others.

import { Injectable, OnModuleInit } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { sendMail } from "../lib/mail";
import { digestOptOutToken } from "./digest-optout.controller";

const TICK_MS = 10 * 60_000;             // 10 min — fine enough to hit the send window
const WINDOW_HOUR_START = 8;             // server-local hours [8..10) inclusive
const WINDOW_HOUR_END   = 10;
const MIN_SOLVES = 5;                    // don't nag users who barely played
const SEND_INTERVAL_MS = 6 * 86_400_000; // one send per ~6 days per user (avoids Sunday double)
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? "https://harinitharanjith.com";

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]!));
}

@Injectable()
export class WeeklyDigestService implements OnModuleInit {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  onModuleInit(): void {
    setTimeout(() => { this.tick().catch(() => {}); }, 15_000);
    setInterval(() => { this.tick().catch(() => {}); }, TICK_MS);
  }

  async tick(): Promise<void> {
    const now = new Date();
    if (now.getDay() !== 0) return;      // Sunday only (0 = Sun in JS Date)
    const hour = now.getHours();
    if (hour < WINDOW_HOUR_START || hour >= WINDOW_HOUR_END) return;

    const users = this.conn.db!.collection("users");
    const cutoff = new Date(now.getTime() - SEND_INTERVAL_MS);
    // Candidates: has email, not opted out, hasn't been sent to this week.
    // The `digestSentAt: { $exists: false }` branch covers first-time recipients.
    const candidates = await users.find({
      email: { $type: "string" },
      weeklyDigestOptedOut: { $ne: true },
      $or: [{ digestSentAt: { $exists: false } }, { digestSentAt: { $lt: cutoff } }],
    }, { projection: { _id: 1, username: 1, email: 1 } as any }).limit(500).toArray();

    for (const user of candidates) {
      await this.sendFor(user).catch((e) => {
        // eslint-disable-next-line no-console
        console.warn("[weekly-digest] failed for", user._id, e);
      });
    }
  }

  private async sendFor(user: any): Promise<void> {
    const userId = String(user._id);
    const email  = String(user.email).toLowerCase();
    const username = user.username || userId;
    // Aggregate the last 7d of THIS user's rounds. Rounds keyed by
    // <userId>:<puzzleId>, so the range scan gets ALL of them cheaply.
    const lo = `${userId}:`, hi = `${userId};`;
    const since = new Date(Date.now() - 7 * 86_400_000);
    const rounds: any[] = await this.conn.db!.collection("rounds").find({
      _id: { $gte: lo, $lt: hi } as any,
      d: { $gte: since },
    }, { projection: { w: 1, d: 1, rd: 1, r: 1, ms: 1, k: 1 } as any }).limit(2000).toArray();
    const puzzleRounds = rounds.filter((r) => r.k !== "blindfold");
    if (puzzleRounds.length < MIN_SOLVES) {
      // Not enough activity to say something useful — mark as sent so we don't
      // check every 10 min all Sunday morning, and skip.
      await this.conn.db!.collection("users").updateOne({ _id: userId as any }, { $set: { digestSentAt: new Date() } });
      return;
    }
    const count = puzzleRounds.length;
    const wins  = puzzleRounds.filter((r) => r.w).length;
    const acc   = Math.round((wins / count) * 100);
    const ratingDelta = puzzleRounds.reduce((s, r) => s + (typeof r.rd === "number" ? r.rd : 0), 0);
    // Best (fastest) win by ms, if any.
    let fastestMs = Infinity;
    for (const r of puzzleRounds) if (r.w && typeof r.ms === "number" && r.ms > 0 && r.ms < fastestMs) fastestMs = r.ms;
    const fastestSec = isFinite(fastestMs) ? Math.max(0.1, fastestMs / 1000) : null;

    // Latest post-solve rating for the "you're now at X" line. Rounds already
    // limited to 7d — most recent is the first (rounds returned sorted by _id
    // ascending; latest ISO date sorts near end). Sort explicitly.
    const latest = puzzleRounds.slice().sort((a, b) => new Date(b.d).getTime() - new Date(a.d).getTime())[0];
    const rating = typeof latest?.r === "number" ? latest.r : null;

    const unsubUrl = `${PUBLIC_ORIGIN}/v2api/api/me/digest/unsubscribe?u=${encodeURIComponent(userId)}&t=${digestOptOutToken(userId)}`;
    const dashboardUrl = `${PUBLIC_ORIGIN}/dashboard`;

    const subject = `📊 Your ChessGuru week — ${wins}/${count} solved · ${ratingDelta >= 0 ? "+" : ""}${ratingDelta} rating`;
    const text = [
      `Hi ${username},`,
      ``,
      `Here's your ChessGuru week:`,
      ``,
      `  ${count} solves · ${wins} wins (${acc}%)`,
      `  ${ratingDelta >= 0 ? "+" : ""}${ratingDelta} rating${rating != null ? ` · now at ${rating}` : ""}`,
      fastestSec != null ? `  fastest solve: ${fastestSec.toFixed(1)}s` : "",
      ``,
      `Full dashboard: ${dashboardUrl}`,
      ``,
      `— ChessGuru`,
      ``,
      `Stop weekly digests: ${unsubUrl}`,
    ].filter(Boolean).join("\n");

    const deltaColor = ratingDelta >= 0 ? "#059669" : "#e11d48";
    const html = `
      <div style="font-family:system-ui,-apple-system,sans-serif;line-height:1.55;color:#111;max-width:560px">
        <div style="background:linear-gradient(135deg,#6d28d9,#4338ca);color:#fff;padding:22px 26px;border-radius:12px 12px 0 0">
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;opacity:.8">Your ChessGuru week</div>
          <div style="font-size:24px;font-weight:700;margin-top:4px">Hi ${escapeHtml(username)} 👋</div>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:0;padding:24px 26px;border-radius:0 0 12px 12px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div style="background:#f3f4f6;border-radius:10px;padding:14px">
              <div style="font-size:11px;text-transform:uppercase;color:#6b7280">Solves</div>
              <div style="font-size:22px;font-weight:700;margin-top:4px">${count}</div>
              <div style="font-size:12px;color:#6b7280;margin-top:2px">${wins} wins · ${acc}% accuracy</div>
            </div>
            <div style="background:#f3f4f6;border-radius:10px;padding:14px">
              <div style="font-size:11px;text-transform:uppercase;color:#6b7280">Rating</div>
              <div style="font-size:22px;font-weight:700;margin-top:4px;color:${deltaColor}">${ratingDelta >= 0 ? "+" : ""}${ratingDelta}</div>
              <div style="font-size:12px;color:#6b7280;margin-top:2px">${rating != null ? `now at ${rating}` : "this week"}</div>
            </div>
            ${fastestSec != null ? `
            <div style="background:#f3f4f6;border-radius:10px;padding:14px;grid-column:span 2">
              <div style="font-size:11px;text-transform:uppercase;color:#6b7280">⚡ Fastest solve</div>
              <div style="font-size:22px;font-weight:700;margin-top:4px">${fastestSec.toFixed(1)}s</div>
            </div>` : ""}
          </div>
          <p style="margin:22px 0 8px">
            <a href="${escapeHtml(dashboardUrl)}"
               style="display:inline-block;background:linear-gradient(90deg,#7c3aed,#3b82f6);color:#fff;
                      padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px">
              📊 Open your dashboard
            </a>
          </p>
          <p style="font-size:11px;color:#9ca3af;margin-top:24px;text-align:center">
            <a href="${escapeHtml(unsubUrl)}" style="color:#9ca3af;text-decoration:underline">Stop weekly digests</a>
          </p>
        </div>
      </div>`;
    await sendMail({ to: email, subject, html, text });
    await this.conn.db!.collection("users").updateOne({ _id: userId as any }, { $set: { digestSentAt: new Date() } });
  }
}
