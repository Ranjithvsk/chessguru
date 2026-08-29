// Fees reminder cron.
//
// Every minute we tick — but only actually work between 06:00–11:00 IST
// (parent notification hours). During that window we sweep OPEN invoices
// whose dueOn falls on one of the cadence offsets from today (default
// [-3, 0, +3, +7]) and email each guardian at most once per day via the
// atomic reminder-log unique index. Missing an email address = silent skip
// (owner still has the 🔔 WhatsApp button as fallback).
//
// Idempotency: unique(academyId, invoiceId, channel, sentOn) in
// fees_reminders. If the insert throws E11000 we treat it as "already
// nudged today" and don't send. So a pod restart mid-batch or two API
// replicas both ticking = at most one email per guardian per invoice per
// day.
//
// This mirrors the class-reminder.service.ts pattern (setInterval + atomic
// claim). No @nestjs/schedule dep, no BullMQ — single-process is enough
// until we outgrow it. Move to Redis lock + queue if we ever run > 1 API
// replica.

import { Injectable, OnModuleInit } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { ObjectId } from "mongodb";
import { sendMail } from "../lib/mail";
import { COL, ReminderChannel, ReminderTemplate } from "./fees.types";

const TICK_MS = 60_000;                     // once a minute
const CADENCE_DAYS = [-3, 0, 3, 7] as const; // offsets from dueOn
const IST_START_HOUR = 6;                    // ≥ 06:00 IST — don't email pre-dawn
const IST_END_HOUR = 11;                     // < 11:00 IST — plenty of buffer for a 5h window
const BATCH_CAP = 200;                       // safety cap per tick — we'll only mail 200/hour tops
const PUBLIC_ORIGIN = process.env.CHESSGURU_PUBLIC_ORIGIN ?? "https://chessguru.cc";

@Injectable()
export class FeesReminderCron implements OnModuleInit {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  onModuleInit() {
    // Wait 30s after boot before the first tick so a restart doesn't
    // hammer the DB while indexes / prisma-equivalents are warming.
    setTimeout(() => {
      this.tick().catch((e) => console.warn("[fees-cron] first tick failed:", e));
      setInterval(() => { this.tick().catch((e) => console.warn("[fees-cron] tick failed:", e)); }, TICK_MS);
    }, 30_000);
  }

  // ---- IST helpers (duplicated from FeesService — cron is a separate service to
  // keep FeesService's dep graph flat; small duplication is fine) ----------

  private istHourNow(): number {
    const d = new Date();
    // Shift into IST then read hour. IST has no DST — const +5.5h.
    return (d.getUTCHours() + d.getUTCMinutes() / 60 + 5.5) % 24;
  }

  private istDayStamp(d: Date): string {
    const ms = d.getTime() + 5.5 * 60 * 60 * 1000;
    return new Date(ms).toISOString().slice(0, 10);
  }

  /** For a cadence offset (e.g. -3), return the UTC [start, end) instant range
   *  covering the IST calendar day (today - offset). Uses IST midnight boundaries
   *  so an invoice with dueOn=Sept 10 00:30 IST falls into Sept 10's bucket. */
  private istDayRange(offsetDays: number): { start: Date; end: Date } {
    // "today" IST midnight, then shift by offsetDays.
    const now = new Date();
    const istMidnightMs = Math.floor((now.getTime() + 5.5 * 60 * 60 * 1000) / 86400_000) * 86400_000 - 5.5 * 60 * 60 * 1000;
    const start = new Date(istMidnightMs + offsetDays * 86400_000);
    const end = new Date(start.getTime() + 86400_000);
    return { start, end };
  }

  private academies() { return this.conn.db!.collection("academies"); }
  private academyBrand() { return this.conn.db!.collection("academybrandings"); }
  private users() { return this.conn.db!.collection("users"); }
  private invoices() { return this.conn.db!.collection(COL.invoices); }
  private reminders() { return this.conn.db!.collection(COL.reminders); }

  // ---- tick --------------------------------------------------------------

  private async tick(): Promise<void> {
    const hour = this.istHourNow();
    if (hour < IST_START_HOUR || hour >= IST_END_HOUR) return; // outside working window

    let sent = 0, skipped = 0;
    for (const offset of CADENCE_DAYS) {
      const { start, end } = this.istDayRange(offset);
      // Candidates: open invoices whose dueOn falls in this IST-day, balance > 0.
      const candidates = await this.invoices().find({
        status: { $in: ["SENT", "PARTIAL", "OVERDUE"] },
        dueOn: { $gte: start, $lt: end },
        // Cheap balance filter — we recompute in-memory too to skip PAID rows
        // that missed a status update.
      }).limit(BATCH_CAP).toArray();

      for (const inv of candidates) {
        if ((inv.paidPaise ?? 0) >= (inv.totalPaise ?? 0)) { skipped++; continue; }
        const template: ReminderTemplate = offset < 0 ? "FEE_DUE" : offset === 0 ? "FEE_DUE" : "FEE_OVERDUE";
        const channel: ReminderChannel = "EMAIL";
        // Try to atomically claim today's send slot.
        try {
          await this.reminders().insertOne({
            _id: new ObjectId(),
            academyId: inv.academyId,
            invoiceId: String(inv._id),
            guardianUserId: inv.guardianUserId,
            channel,
            template,
            sentAt: new Date(),
            sentOn: this.istDayStamp(new Date()),
            actorUserId: "system:reminder-cron",
            status: "SENT",
          });
        } catch (e: unknown) {
          if ((e as { code?: number })?.code === 11000) { skipped++; continue; } // already sent today
          console.warn("[fees-cron] claim insert failed:", e); skipped++; continue;
        }
        // Claim succeeded — actually send. If send fails we mark the log row
        // as FAILED so an operator dashboard (later) can surface it. Owner
        // still has the 🔔 button to nudge manually.
        try {
          const ok = await this.sendOne(inv, offset);
          if (!ok) {
            await this.reminders().updateOne({ invoiceId: String(inv._id), sentOn: this.istDayStamp(new Date()), channel }, { $set: { status: "FAILED" } });
            skipped++;
            continue;
          }
          sent++;
        } catch (e) {
          console.warn("[fees-cron] send failed:", e);
          await this.reminders().updateOne({ invoiceId: String(inv._id), sentOn: this.istDayStamp(new Date()), channel }, { $set: { status: "FAILED", errorText: String((e as Error)?.message ?? e).slice(0, 200) } });
          skipped++;
        }
      }
    }
    if (sent > 0 || skipped > 0) console.log(`[fees-cron] sent=${sent} skipped=${skipped}`);
  }

  // ---- send one email ----------------------------------------------------

  private async sendOne(inv: any, offset: number): Promise<boolean> {
    if (!inv.guardianUserId) return false;
    const guardian = await this.users().findOne(
      { _id: this.oid(inv.guardianUserId) },
      { projection: { name: 1, username: 1, email: 1, mobile: 1 } as never },
    );
    const email = (guardian?.email as string) || "";
    if (!email) return false;

    const student = await this.users().findOne(
      { _id: this.oid(inv.studentUserId) },
      { projection: { name: 1, username: 1 } as never },
    );

    const branding = await this.brandingFor(String(inv.academyId));
    const html = this.buildEmailHtml(inv, {
      guardianName: (guardian?.name as string) ?? (guardian?.username as string) ?? "there",
      studentName: (student?.name as string) ?? (student?.username as string) ?? "your child",
      academyName: branding.name,
      offset,
    });
    const text = this.buildEmailText(inv, {
      guardianName: (guardian?.name as string) ?? (guardian?.username as string) ?? "there",
      studentName: (student?.name as string) ?? (student?.username as string) ?? "your child",
      academyName: branding.name,
      offset,
    });
    const isOverdue = offset > 0;
    const subject = isOverdue
      ? `Fee overdue — ${inv.invoiceNo} · ${branding.name}`
      : `Fee reminder — ${inv.invoiceNo} · ${branding.name}`;
    const r = await sendMail({ to: email, subject, html, text });
    return !!r.ok;
  }

  private async brandingFor(academyId: string): Promise<{ name: string }> {
    const [academy, brand] = await Promise.all([
      this.academies().findOne(
        { $or: [{ _id: this.oid(academyId) }, { slug: academyId }] },
        { projection: { name: 1 } as never },
      ),
      this.academyBrand().findOne({ academyId }, { projection: { brandName: 1 } as never }),
    ]);
    return {
      name: (brand?.brandName as string) || (academy?.name as string) || "Chess Academy",
    };
  }

  private oid(id: string): ObjectId | undefined {
    try { return new ObjectId(id); } catch { return undefined; }
  }

  // ---- template ----------------------------------------------------------

  private fmtRupees(paise: number): string {
    const r = paise / 100;
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: r % 1 === 0 ? 0 : 2 }).format(r);
  }

  private fmtDate(d: Date): string {
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  }

  private buildEmailText(inv: any, ctx: { guardianName: string; studentName: string; academyName: string; offset: number }): string {
    const balance = Math.max(0, (inv.totalPaise ?? 0) - (inv.paidPaise ?? 0));
    const dueStr = this.fmtDate(inv.dueOn instanceof Date ? inv.dueOn : new Date(inv.dueOn));
    const amtStr = this.fmtRupees(balance);
    const openHere = `${PUBLIC_ORIGIN}/fees/invoices?id=${String(inv._id)}`;
    if (ctx.offset < 0) {
      return `Hi ${ctx.guardianName},\n\nA friendly heads-up — ${ctx.studentName}'s fee is coming up.\n\n  Invoice: ${inv.invoiceNo}\n  Amount:  ${amtStr}\n  Due:     ${dueStr}\n\nView / pay: ${openHere}\n\nThank you!\n— ${ctx.academyName}`;
    }
    if (ctx.offset === 0) {
      return `Hi ${ctx.guardianName},\n\nToday is the due date for ${ctx.studentName}'s fee.\n\n  Invoice: ${inv.invoiceNo}\n  Amount:  ${amtStr}\n  Due:     ${dueStr}\n\nView / pay: ${openHere}\n\nThank you!\n— ${ctx.academyName}`;
    }
    return `Hi ${ctx.guardianName},\n\nGentle reminder — ${ctx.studentName}'s fee was due on ${dueStr} and is still outstanding.\n\n  Invoice: ${inv.invoiceNo}\n  Amount:  ${amtStr}\n\nView / pay: ${openHere}\n\nThank you!\n— ${ctx.academyName}`;
  }

  private buildEmailHtml(inv: any, ctx: { guardianName: string; studentName: string; academyName: string; offset: number }): string {
    const balance = Math.max(0, (inv.totalPaise ?? 0) - (inv.paidPaise ?? 0));
    const dueStr = this.fmtDate(inv.dueOn instanceof Date ? inv.dueOn : new Date(inv.dueOn));
    const amtStr = this.fmtRupees(balance);
    const openHere = `${PUBLIC_ORIGIN}/fees/invoices?id=${String(inv._id)}`;
    const isOverdue = ctx.offset > 0;
    const heading = ctx.offset < 0 ? "Fee coming up" : ctx.offset === 0 ? "Fee due today" : "Fee overdue";
    const lead = ctx.offset < 0
      ? `A friendly heads-up — <b>${escapeHtml(ctx.studentName)}</b>'s fee is due on <b>${dueStr}</b>.`
      : ctx.offset === 0
        ? `Today is the due date for <b>${escapeHtml(ctx.studentName)}</b>'s fee.`
        : `Gentle reminder — <b>${escapeHtml(ctx.studentName)}</b>'s fee was due on <b>${dueStr}</b> and is still outstanding.`;
    const accent = isOverdue ? "#d97706" : "#4f46e5";
    return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a">
  <div style="max-width:560px;margin:24px auto;padding:0 16px">
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden">
      <div style="background:${accent};color:#fff;padding:14px 20px;font-weight:700;font-size:14px;letter-spacing:0.02em">
        ${escapeHtml(ctx.academyName)}
      </div>
      <div style="padding:24px 20px 8px">
        <div style="color:${accent};font-weight:800;font-size:12px;text-transform:uppercase;letter-spacing:0.08em">${heading}</div>
        <h1 style="margin:6px 0 12px;font-size:22px;color:#0f172a">Hi ${escapeHtml(ctx.guardianName)},</h1>
        <p style="margin:0 0 16px;color:#334155;line-height:1.5">${lead}</p>

        <table role="presentation" style="width:100%;border-collapse:separate;border-spacing:0;margin:6px 0 18px;font-size:14px">
          <tr><td style="padding:6px 0;color:#64748b">Invoice</td><td style="padding:6px 0;color:#0f172a;text-align:right;font-family:ui-monospace,monospace">${escapeHtml(inv.invoiceNo)}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b">Amount</td><td style="padding:6px 0;color:#0f172a;text-align:right;font-weight:700">${amtStr}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b">Due</td><td style="padding:6px 0;color:#0f172a;text-align:right">${dueStr}</td></tr>
        </table>

        <a href="${openHere}" style="display:inline-block;background:${accent};color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:700;font-size:14px">View invoice</a>

        <p style="margin:20px 0 0;color:#64748b;font-size:13px">Thank you!<br>— ${escapeHtml(ctx.academyName)}</p>
      </div>
    </div>
    <p style="margin:14px 0;color:#94a3b8;font-size:11px;text-align:center">You're receiving this because you're listed as the paying guardian for a student at ${escapeHtml(ctx.academyName)}. To stop these reminders, contact the academy directly.</p>
  </div>
</body></html>`;
  }
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c] as string));
}
