// Weekly rollup email for coaches -- Sunday morning digest of the snaps
// they starred in the past 7 days. Chess coaches often plan the next
// week's lessons Sunday evening; this email lands the shortlist directly
// in their inbox with click-through links back to /board-editor (fen +
// arrows preserved).
//
// Design mirrors WeeklyDigestService:
//   * Single-process only (setInterval). One send per coach per week
//     guarded by coachStarredDigestSentAt on the user doc.
//   * Send window: Sunday 08..10 local. 10 min tick catches restart
//     tolerance without spamming.
//   * Skips coaches with zero recent starred snaps.
//   * Fails-open per coach so a mail-transport hiccup doesn't stop the batch.

import { Injectable, OnModuleInit } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { sendMail } from "../lib/mail";
import { emailOptOutToken } from "../digest/email-optout.controller";

const TICK_MS = 10 * 60_000;
const WINDOW_HOUR_START = 8;
const WINDOW_HOUR_END = 10;
// Default cadence when the user hasn't set one. Individual coaches can pick
// weekly / biweekly / monthly (see cadenceInterval below).
const DEFAULT_INTERVAL_MS = 6 * 86_400_000;
function cadenceIntervalMs(v: unknown): number {
  if (v === "biweekly") return 13 * 86_400_000;   // ~2 weeks
  if (v === "monthly")  return 28 * 86_400_000;   // ~4 weeks (loose)
  return DEFAULT_INTERVAL_MS;                     // "weekly" or unset
}
function cadenceWindowDays(v: unknown): number {
  if (v === "biweekly") return 14;
  if (v === "monthly")  return 28;
  return 7;                                       // "weekly" or unset
}
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? "https://harinitharanjith.com";

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]!));
}
function encodeShapes(shapes: any[]): string {
  return Buffer.from(JSON.stringify(shapes)).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function snapLink(s: any): string {
  const fenParam = encodeURIComponent(String(s.fen));
  const shapes = Array.isArray(s.shapes) ? s.shapes : [];
  return shapes.length > 0
    ? `${PUBLIC_ORIGIN}/board-editor?fen=${fenParam}&shapes=${encodeShapes(shapes)}`
    : `${PUBLIC_ORIGIN}/board-editor?fen=${fenParam}`;
}

@Injectable()
export class CoachStarredDigestService implements OnModuleInit {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  onModuleInit(): void {
    setTimeout(() => { this.tick().catch(() => {}); }, 20_000);
    setInterval(() => { this.tick().catch(() => {}); }, TICK_MS);
  }

  async tick(): Promise<void> {
    const now = new Date();
    if (now.getDay() !== 0) return;
    const hour = now.getHours();
    if (hour < WINDOW_HOUR_START || hour >= WINDOW_HOUR_END) return;
    // Coarse pre-filter with the most-lax cadence -- per-user cadence check
    // happens below so we don't send monthly-picking coaches every week.
    const laxCutoff = new Date(now.getTime() - DEFAULT_INTERVAL_MS);
    const users = await this.conn.db!.collection("users").find({
      email: { $type: "string" },
      role: { $in: ["academy_owner", "coach"] as any },
      coachStarredDigestOptedOut: { $ne: true },
      $or: [{ coachStarredDigestSentAt: { $exists: false } }, { coachStarredDigestSentAt: { $lt: laxCutoff } }],
    }, { projection: { _id: 1, username: 1, email: 1, coachStarredDigestCadence: 1, coachStarredDigestSentAt: 1 } as any }).limit(500).toArray();
    for (const u of users) {
      const iv = cadenceIntervalMs(u.coachStarredDigestCadence);
      const lastSent = u.coachStarredDigestSentAt ? new Date(u.coachStarredDigestSentAt).getTime() : 0;
      if (lastSent && (now.getTime() - lastSent) < iv) continue;
      await this.sendFor(u).catch((e) => {
        // eslint-disable-next-line no-console
        console.warn("[coach-starred-digest] failed for", u._id, e);
      });
    }
  }

  /** Read-only shape the dashboard preview shows so the coach knows what
   *  next Sunday's digest will contain. Same 7d window + starred filter as
   *  the send path. */
  /** Preview window auto-sizes to the coach's chosen cadence so what they
   *  see matches what the digest actually sends. Caller may override via
   *  sinceDaysBack for QA. */
  async previewFor(userId: string, sinceDaysBack?: number) {
    const user: any = await this.conn.db!.collection("users").findOne({ _id: userId as any },
      { projection: { coachStarredDigestCadence: 1, coachStarredDigestOptedOut: 1, coachStarredDigestSentAt: 1, coachStarredDigestSentCount: 1, coachStarredDigestHistory: 1 } as any });
    const cadence = (user?.coachStarredDigestCadence as "weekly" | "biweekly" | "monthly" | undefined) ?? "weekly";
    const days = sinceDaysBack ?? cadenceWindowDays(cadence);
    const since = new Date(Date.now() - days * 86_400_000);
    const reviewSince = user?.coachStarredDigestSentAt
      ? new Date(user.coachStarredDigestSentAt)
      : new Date(Date.now() - 30 * 86_400_000);
    const [snaps, reviewedCount, pendingBacklog, recentReviewCount, staleCount, reviewedIn30d]: [any[], number, number, number, number, any[]] = await Promise.all([
      this.conn.db!.collection("classSnaps").find({
        byUserId: String(userId),
        starred: true,
        at: { $gte: since },
      }).sort({ at: -1 }).limit(60).toArray(),
      this.conn.db!.collection("classSnaps").countDocuments({
        byUserId: String(userId),
        reviewedAt: { $gte: reviewSince },
      }),
      this.conn.db!.collection("classSnaps").countDocuments({
        byUserId: String(userId), starred: true, reviewedAt: { $in: [null, undefined] as any },
      }),
      this.conn.db!.collection("classSnaps").countDocuments({
        byUserId: String(userId), reviewedAt: { $gte: new Date(Date.now() - 21 * 86_400_000) },
      }),
      this.conn.db!.collection("classSnaps").countDocuments({
        byUserId: String(userId),
        starred: true,
        reviewedAt: { $in: [null, undefined] as any },
        at: { $lt: new Date(Date.now() - 30 * 86_400_000) },
      }),
      this.conn.db!.collection("classSnaps").find({
        byUserId: String(userId),
        reviewedAt: { $gte: new Date(Date.now() - 30 * 86_400_000) },
      }, { projection: { reviewedAt: 1 } as any }).limit(500).toArray(),
    ]);
    const stuck = pendingBacklog >= 3 && recentReviewCount === 0;
    // Review streak (parallels the sendFor / dashboard heatmap calc).
    let streakDays = 0;
    if (reviewedIn30d.length > 0) {
      const dayMs = (d: Date) => { const c = new Date(d); c.setHours(0, 0, 0, 0); return c.getTime(); };
      const todayStart = dayMs(new Date());
      const set = new Set(reviewedIn30d.map((r) => dayMs(new Date(r.reviewedAt))));
      for (let i = 0; i < 30; i++) {
        if (set.has(todayStart - i * 86_400_000)) streakDays++;
        else break;
      }
    }
    // Busiest class this window -- mirrors the digest-email stat so the
    // preview shows the same signal.
    const classTallyPreview = new Map<string, { title: string; n: number }>();
    for (const s of snaps) {
      const cur = classTallyPreview.get(s.classId);
      if (cur) cur.n++;
      else classTallyPreview.set(s.classId, { title: s.classTitle, n: 1 });
    }
    const topClassPreview = [...classTallyPreview.values()].sort((a, b) => b.n - a.n)[0];
    const busiestClass = (classTallyPreview.size > 1 && topClassPreview)
      ? { title: topClassPreview.title, n: topClassPreview.n }
      : null;
    return {
      snapCount: snaps.length,
      cadence,
      windowDays: days,
      optedOut: !!user?.coachStarredDigestOptedOut,
      sentCount: typeof user?.coachStarredDigestSentCount === "number" ? user.coachStarredDigestSentCount : 0,
      lastSentAt: user?.coachStarredDigestSentAt ?? null,
      reviewedSinceLast: reviewedCount,
      pendingBacklog,
      stuck,
      staleCount,
      busiestClass,
      streakDays,
      history: Array.isArray(user?.coachStarredDigestHistory)
        ? user.coachStarredDigestHistory.slice(-12).reverse().map((h: any) => ({
            sentAt: h.sentAt, snapCount: h.snapCount ?? 0, windowDays: h.windowDays ?? 7,
          }))
        : [],
      snaps: snaps.map((s) => ({
        _id: s._id,
        classId: s.classId,
        at: s.at,
        note: s.note || "",
        hasAudio: !!s.hasAudio,
        shapeCount: Array.isArray(s.shapes) ? s.shapes.length : 0,
        link: snapLink(s),
      })),
    };
  }

  /** Public: send the digest to a specific user right now, bypassing the
   *  Sunday-window guard. Used by the dashboard's "Send it to me now" test
   *  button. Still requires the user to have an email + not be opted out.
   *  Zero-snap window is treated as a no-op with a note in the response. */
  async sendNowFor(userId: string): Promise<{ ok: boolean; snapCount: number; note?: string }> {
    const user: any = await this.conn.db!.collection("users").findOne({ _id: userId as any });
    if (!user) return { ok: false, snapCount: 0, note: "user not found" };
    if (!user.email) return { ok: false, snapCount: 0, note: "no email on account" };
    if (user.coachStarredDigestOptedOut) return { ok: false, snapCount: 0, note: "you have opted out of this digest" };
    const preview = await this.previewFor(userId, 7);
    if (preview.snapCount === 0) return { ok: false, snapCount: 0, note: "no starred snaps in the last 7 days -- nothing to send" };
    await this.sendFor(user);
    return { ok: true, snapCount: preview.snapCount };
  }

  private async sendFor(user: any): Promise<void> {
    const userId = String(user._id);
    const email = String(user.email).toLowerCase();
    const username = user.username || userId;
    // Window scales to the coach's cadence so a biweekly recipient gets 14
    // days of context in one email instead of the last 7 (which would leave
    // the previous week's snaps unseen).
    const days = cadenceWindowDays(user.coachStarredDigestCadence);
    const since = new Date(Date.now() - days * 86_400_000);
    const snaps: any[] = await this.conn.db!.collection("classSnaps").find({
      byUserId: userId,
      starred: true,
      at: { $gte: since },
    }).sort({ at: -1 }).limit(60).toArray();
    // "N reviewed since your last digest" progress marker. Anchored on the
    // last-sent timestamp (or 30d ago on first-ever send). Cheap count-only
    // query; no docs fetched.
    const reviewSince = user.coachStarredDigestSentAt
      ? new Date(user.coachStarredDigestSentAt)
      : new Date(Date.now() - 30 * 86_400_000);
    const reviewedCount = await this.conn.db!.collection("classSnaps").countDocuments({
      byUserId: userId,
      reviewedAt: { $gte: reviewSince },
    });
    // Sticky-nudge signal: coach has pending starred snaps but hasn't reviewed
    // anything in 21+ days. Count the pending backlog so the nudge text can be
    // specific ("4 positions still waiting"). Two cheap count queries only run
    // when the digest has snaps to send.
    const pendingBacklog = snaps.length > 0
      ? await this.conn.db!.collection("classSnaps").countDocuments({
          byUserId: userId, starred: true, reviewedAt: { $in: [null, undefined] as any },
        })
      : 0;
    const anyRecentReview = await this.conn.db!.collection("classSnaps").countDocuments({
      byUserId: userId,
      reviewedAt: { $gte: new Date(Date.now() - 21 * 86_400_000) },
    });
    const showStuckNudge = pendingBacklog >= 3 && anyRecentReview === 0;
    // Stale count: starred + unreviewed + snap.at > 30 days ago. Different
    // signal from the stuck-nudge: stale = "you flagged X specific items
    // and never came back to them"; stuck = "you flagged things and never
    // reviewed anything at all". A coach can be stale but not stuck (e.g.
    // review recent ones but ignore old backlog).
    const staleCount = await this.conn.db!.collection("classSnaps").countDocuments({
      byUserId: userId,
      starred: true,
      reviewedAt: { $in: [null, undefined] as any },
      at: { $lt: new Date(Date.now() - 30 * 86_400_000) },
    });
    // Review streak: consecutive days ending TODAY where the coach reviewed
    // >=1 snap. Mirrors the dashboard heatmap 🔥 badge so the email carries
    // the same motivator.
    const reviewedIn30d: any[] = await this.conn.db!.collection("classSnaps").find({
      byUserId: userId,
      reviewedAt: { $gte: new Date(Date.now() - 30 * 86_400_000) },
    }, { projection: { reviewedAt: 1 } as any }).limit(500).toArray();
    let streakDays = 0;
    // 30-day count-per-day array for the ASCII/HTML heatmap. Index 0 = 29
    // days ago, 29 = today.
    const daysBuckets: number[] = new Array(30).fill(0);
    if (reviewedIn30d.length > 0) {
      const dayMs = (d: Date) => { const c = new Date(d); c.setHours(0, 0, 0, 0); return c.getTime(); };
      const today = dayMs(new Date());
      const days = new Set(reviewedIn30d.map((r) => dayMs(new Date(r.reviewedAt))));
      for (let i = 0; i < 30; i++) {
        if (days.has(today - i * 86_400_000)) streakDays++;
        else break;
      }
      for (const r of reviewedIn30d) {
        const idx = 29 - Math.round((today - dayMs(new Date(r.reviewedAt))) / 86_400_000);
        if (idx >= 0 && idx < 30) daysBuckets[idx]!++;
      }
    }
    const heatmapHtml = daysBuckets.some((n) => n > 0)
      ? `<div style="display:inline-block;margin:8px 0;line-height:0">${daysBuckets.map((n) => {
          const bg = n === 0 ? "#e5e7eb"
            : n === 1 ? "#a7f3d0"
            : n <= 3 ? "#34d399"
            : "#059669";
          return `<span style="display:inline-block;width:8px;height:12px;background:${bg};border-radius:1px;margin-right:1px"></span>`;
        }).join("")}</div>`
      : "";
    const heatmapText = daysBuckets.some((n) => n > 0)
      ? "30d review cadence: " + daysBuckets.map((n) => n === 0 ? "·" : n === 1 ? "▂" : n <= 3 ? "▄" : "█").join("") + "\n"
      : "";
    // "Busiest class" this window: the class contributing the most snaps.
    // Small stat in the email header so the coach sees which class dominated
    // their prep list without opening the dashboard.
    const classTally = new Map<string, { title: string; n: number }>();
    for (const s of snaps) {
      const cur = classTally.get(s.classId);
      if (cur) cur.n++;
      else classTally.set(s.classId, { title: s.classTitle, n: 1 });
    }
    const topClass = [...classTally.values()].sort((a, b) => b.n - a.n)[0];
    if (snaps.length === 0) {
      // Nothing to say -- mark sent so we don't re-check every 10 min all
      // Sunday morning. Doesn't burn the weekly cadence for real content
      // (next week's tick clears the guard once past cutoff).
      await this.conn.db!.collection("users").updateOne(
        { _id: userId as any }, { $set: { coachStarredDigestSentAt: new Date() } }
      );
      return;
    }
    const truncate = (s: string, n: number) => s.length > n ? s.slice(0, n).trimEnd() + "…" : s;
    const rows = snaps.map((s) => {
      const transPreview = typeof s.transcript === "string" && s.transcript.trim()
        ? truncate(String(s.transcript).trim(), 200)
        : "";
      return `
      <li style="margin-bottom:6px">
        <a href="${snapLink(s)}" style="color:#2563eb;text-decoration:none;font-weight:600">Open position</a>
        ${s.note ? ` — ${esc(String(s.note))}` : ""}
        ${Array.isArray(s.shapes) && s.shapes.length > 0 ? ` <span style="color:#b45309;font-size:12px">(${s.shapes.length} arrow${s.shapes.length === 1 ? "" : "s"})</span>` : ""}
        ${s.hasAudio ? ` <span style="color:#7c3aed;font-size:12px">(🎙 voice note)</span>` : ""}
        ${transPreview ? `<div style="color:#6b7280;font-size:12px;font-style:italic;margin-top:4px;padding-left:12px;border-left:2px solid #e5e7eb">"${esc(transPreview)}"</div>` : ""}
      </li>`;
    }).join("");
    const rowsText = snaps.map((s, i) => {
      const transPreview = typeof s.transcript === "string" && s.transcript.trim()
        ? truncate(String(s.transcript).trim(), 200)
        : "";
      return `${i + 1}. ${snapLink(s)}${s.note ? ` — ${String(s.note)}` : ""}${transPreview ? `\n   "${transPreview}"` : ""}`;
    }).join("\n");
    const windowLabel = days === 7 ? "this week" : days === 14 ? "the last 2 weeks" : days === 28 ? "this month" : `the last ${days} days`;
    const subject = `Your starred positions ${windowLabel} (${snaps.length})`;
    const unsubUrl = `${PUBLIC_ORIGIN}/v2api/api/me/email/unsubscribe?u=${encodeURIComponent(userId)}&c=coachStarred&t=${emailOptOutToken(userId, "coachStarred")}`;
    const html = `
      <div style="font-family:system-ui,sans-serif;max-width:520px">
        <h2 style="color:#111;margin-bottom:4px">★ Your review shortlist</h2>
        <p style="color:#666;margin-top:0">Hi ${esc(username)} — you starred ${snaps.length} position${snaps.length === 1 ? "" : "s"} in ${windowLabel}.</p>
        ${topClass && classTally.size > 1 ? `<p style="margin:4px 0 0;color:#666;font-size:12px">🏫 Most from <b>${esc(topClass.title)}</b> (${topClass.n} snap${topClass.n === 1 ? "" : "s"}).</p>` : ""}
        ${reviewedCount > 0 ? `<p style="margin:8px 0;color:#059669;font-size:13px">✓ You reviewed ${reviewedCount} snap${reviewedCount === 1 ? "" : "s"} since the last digest — nice work.${streakDays >= 3 ? ` <span style="color:#f97316">🔥 ${streakDays}-day streak</span>` : ""}</p>` : ""}
        ${heatmapHtml}
        ${showStuckNudge ? `<div style="margin:12px 0;padding:10px 12px;border-left:3px solid #f59e0b;background:#fffbeb;color:#78350f;font-size:13px">💤 It's been a while — <b>${pendingBacklog}</b> starred position${pendingBacklog === 1 ? "" : "s"} ${pendingBacklog === 1 ? "is" : "are"} still waiting for review. Even one Sunday morning session can move the needle.</div>` : ""}
        ${staleCount > 0 ? `<p style="margin:8px 0;color:#9a3412;font-size:12px">⏰ <b>${staleCount}</b> starred position${staleCount === 1 ? "" : "s"} ${staleCount === 1 ? "is" : "are"} over 30 days old and still unreviewed — worth revisiting or clearing.</p>` : ""}
        <ol style="line-height:1.6;padding-left:20px;color:#333">${rows}</ol>
        <p style="color:#666;font-size:13px">Every link opens the board editor with your arrows preserved. Pick a few for next week's lessons.</p>
        <p style="color:#9ca3af;font-size:11px;margin-top:24px">
          Manage on <a href="${PUBLIC_ORIGIN}/academy" style="color:#9ca3af">Academy dashboard</a> ·
          <a href="${unsubUrl}" style="color:#9ca3af;text-decoration:underline">Stop these emails</a>
        </p>
      </div>`;
    const text = [
      `★ Your review shortlist`, "",
      `Hi ${username} — you starred ${snaps.length} position(s) in ${windowLabel}:`,
      (topClass && classTally.size > 1) ? `🏫 Most from ${topClass.title} (${topClass.n} snap${topClass.n === 1 ? "" : "s"}).\n` : "",
      reviewedCount > 0 ? `✓ You reviewed ${reviewedCount} snap(s) since the last digest — nice work.${streakDays >= 3 ? ` 🔥 ${streakDays}-day streak` : ""}\n` : "",
      heatmapText,
      showStuckNudge ? `\n💤 It's been a while — ${pendingBacklog} starred position${pendingBacklog === 1 ? "" : "s"} still waiting for review.\n` : "",
      staleCount > 0 ? `⏰ ${staleCount} starred position(s) over 30 days old and still unreviewed.\n` : "",
      rowsText, "",
      `Manage on ${PUBLIC_ORIGIN}/academy`,
      `Stop these emails: ${unsubUrl}`,
    ].join("\n");
    const r = await sendMail({ to: email, subject, html, text });
    if (r.ok) {
      // Append the send to a bounded history array. $push + $slice keeps the
      // last 12 entries only so the doc doesn't bloat over years of Sundays.
      const historyEntry = { sentAt: new Date(), snapCount: snaps.length, windowDays: days };
      await this.conn.db!.collection("users").updateOne(
        { _id: userId as any },
        {
          $set: { coachStarredDigestSentAt: new Date() },
          $inc: { coachStarredDigestSentCount: 1 },
          $push: { coachStarredDigestHistory: { $each: [historyEntry], $slice: -12 } as any } as any,
        }
      );
    }
  }
}
