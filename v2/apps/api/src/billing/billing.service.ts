// ChessGuru platform billing (owner 2026-09-13: "is there payment integration after trial?" → build it).
//
// Pricing (owner, 2026-09-13 afternoon, replacing the morning's student tiers): ₹1,000/mo flat —
// unlimited students, unlimited coaches. No quotation line. 30-day trial from sign-up (auth.service signupAcademy).
//
// Money flow: owner opens /academy/billing → POST order (Razorpay order via fees.pg createOrder with the
// platform env keys) → Razorpay Checkout in the browser → POST confirm with the handshake fields → we verify
// the HMAC AND fetch the payment from Razorpay to check it is captured for that order → extend paidUntil.
// No webhook is needed for this path; RAZORPAY_WEBHOOK_SECRET stays optional.
//
// Manual payments (bank / UPI to the owner): superadmin POST /api/admin/academies/:id/billing/mark-paid.
//
// Enforcement: trial or paid period ends → 7-day grace (banner) → "locked": the academy dashboard shows the
// billing wall to the owner and owner-only management calls answer 402. Coaches keep teaching and students
// are never affected. Reminders: email the owner (if they have one) 7 days / 1 day before, on expiry and at
// lock — one email per academy per kind per day.
import { BadRequestException, ForbiddenException, Injectable, HttpException, NotFoundException } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import type { Connection } from "mongoose";
import { createOrder, readRazorpayCredentials, verifyPaymentHandshake, verifyWebhookSignature } from "../fees/fees.pg";
import * as crypto from "node:crypto";
import { sendMail } from "../lib/mail";

const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? "https://chessguru.cc";
const GRACE_DAYS = 7;
const DAY = 86_400_000;
export const QUOTATION_ABOVE = 500;
/** Owner 2026-09-13: "two months free for yearly payment" — 12 months cost 10. */
export const YEAR_MONTHS_CHARGED = 10;
export function amountForMonths(monthlyPaise: number, months: number): number { return monthlyPaise * (months === 12 ? YEAR_MONTHS_CHARGED : months); }
export const WHATSAPP_DISPLAY = "+91 82483 53593";

/** Monthly price in paise. Flat ₹1,000 whatever the student count (owner 2026-09-13:
 *  "unlimited students pricing for 1000"). The signature keeps `students` and the
 *  nullable return so callers and the quotation guard stay valid; it never returns null now. */
export const FLAT_MONTHLY_PAISE = 100000;
export function monthlyPricePaise(_students: number): number | null {
  return FLAT_MONTHLY_PAISE;
}

export type BillingState = "trialing" | "active" | "manual" | "grace" | "locked";

export interface BillingStatus {
  academyId: string; academyName: string;
  state: BillingState; plan: string | null;
  students: number; monthlyPricePaise: number | null; yearlyPricePaise: number | null; quotation: boolean; customPrice: boolean;
  trialEndsAt: string | null; paidUntil: string | null; periodEndsAt: string | null;
  daysLeft: number | null; graceEndsAt: string | null;
  razorpayConfigured: boolean; keyId: string | null;
  // auto-renew (Razorpay Subscriptions): present once the owner has subscribed
  subscription: { id: string; status: string; amountPaise: number; period: "monthly" | "yearly"; nextChargeAt: string | null; cancelling: boolean; lastChargeFailedAt: string | null } | null;
  /** Owner 2026-09-13: "only subscribe option; if subscription payment failed then only single pay method" —
   *  true while Razorpay reports the auto-renew charge as failed (subscription pending / halted). */
  paymentFailed: boolean;
  payments: Array<{ id: string; at: string; amountPaise: number; months: number; method: string; status: string; paidUntil: string | null; note?: string }>;
  whatsapp: string;
}

/** Summary for the academy dashboard hero — a plain function so AcademyModule (a separate Nest module)
 *  needs no provider wiring; it shares the pure state computation below. */
export async function billingSummaryFor(conn: Connection, academyId: string) {
  const acad: any = await conn.db!.collection("academies").findOne({ _id: academyId } as never);
  if (!acad) return null;
  const students = await conn.db!.collection("users").countDocuments({ academyId, role: "student" } as never);
  const c = computeBilling(acad, students);
  return { state: c.state, daysLeft: c.daysLeft, periodEndsAt: c.periodEndsAt?.toISOString() ?? null, graceEndsAt: c.graceEndsAt?.toISOString() ?? null, students, monthlyPricePaise: c.price, quotation: c.price === null };
}
/** Per-academy deal (owner 2026-09-13: "for gunachess.com ₹1,000 per month"): `academies.customMonthlyPricePaise`
 *  overrides the student-count tiers and never falls into quotation. */
export function priceForAcademy(acad: any, students: number): number | null {
  const custom = acad?.customMonthlyPricePaise;
  return typeof custom === "number" && custom > 0 ? Math.round(custom) : monthlyPricePaise(students);
}
function computeBilling(acad: any, students: number, now = new Date()) {
  const trialEndsAt: Date | null = acad.trialEndsAt ? new Date(acad.trialEndsAt) : null;
  const paidUntil: Date | null = acad.paidUntil ? new Date(acad.paidUntil) : null;
  const price = priceForAcademy(acad, students);
  let state: BillingState; let periodEndsAt: Date | null = null;
  if (paidUntil && paidUntil > now) { state = "active"; periodEndsAt = paidUntil; }
  else if (!paidUntil && (acad.plan === "active" || acad.plan === "manual" || acad.subscriptionStatus === "active") && !trialEndsAt) { state = "manual"; }
  else if (trialEndsAt && trialEndsAt > now && !paidUntil) { state = "trialing"; periodEndsAt = trialEndsAt; }
  else {
    const ended = paidUntil ?? trialEndsAt;
    if (!ended) state = "manual";
    else { periodEndsAt = ended; state = now.getTime() - ended.getTime() <= GRACE_DAYS * DAY ? "grace" : "locked"; }
  }
  const daysLeft = periodEndsAt ? Math.ceil((periodEndsAt.getTime() - now.getTime()) / DAY) : null;
  const graceEndsAt = periodEndsAt && (state === "grace" || state === "locked") ? new Date(periodEndsAt.getTime() + GRACE_DAYS * DAY) : null;
  return { state, trialEndsAt, paidUntil, periodEndsAt, daysLeft, graceEndsAt, price };
}

@Injectable()
export class BillingService {
  private lockCache = new Map<string, { locked: boolean; at: number }>();
  constructor(@InjectConnection() private readonly conn: Connection) {}
  private academies() { return this.conn.db!.collection("academies"); }
  private users() { return this.conn.db!.collection("users"); }
  private payments() { return this.conn.db!.collection("academyPayments"); }
  private reminders() { return this.conn.db!.collection("billingReminders"); }
  private plans() { return this.conn.db!.collection("billingPlans"); }
  private subs() { return this.conn.db!.collection("academySubscriptions"); }
  private rzp(path: string, init?: { method?: string; body?: unknown }) {
    const keyId = process.env.RAZORPAY_KEY_ID?.trim() ?? "", secret = process.env.RAZORPAY_KEY_SECRET?.trim() ?? "";
    if (!keyId || !secret) throw new BadRequestException("Online payment is temporarily unavailable. WhatsApp " + WHATSAPP_DISPLAY + " and we will sort it out.");
    return fetch(`https://api.razorpay.com/v1${path}`, { method: init?.method ?? "GET", headers: { "Content-Type": "application/json", Authorization: `Basic ${Buffer.from(`${keyId}:${secret}`).toString("base64")}` }, body: init?.body ? JSON.stringify(init.body) : undefined })
      .then(async (r) => { const j: any = await r.json().catch(() => null); if (!r.ok) throw new BadRequestException(`Razorpay: ${JSON.stringify(j?.error ?? r.status).slice(0, 300)}`); return j; });
  }

  onModuleInit(): void {
    if (process.env.BILLING_TICK_DISABLED === "1") return;
    setTimeout(() => { this.tick().catch((e) => console.error("[billing] tick", e)); }, 30_000);
    setInterval(() => { this.tick().catch((e) => console.error("[billing] tick", e)); }, 6 * 3600_000);
  }

  // ── status ────────────────────────────────────────────────────────────────
  /** Pure computation from the academy row + student count (also used by the tick and the lock check). */
  private compute(acad: any, students: number, now = new Date()) { return computeBilling(acad, students, now); }
  private async studentCount(academyId: string): Promise<number> {
    return this.users().countDocuments({ academyId, role: "student" } as never);
  }
  private member(session: any): { academyId: string; userId: string; role: string } {
    const userId = session?.userId; const academyId = session?.academyId; const role = session?.role;
    if (!userId) throw new ForbiddenException("sign in first");
    if ((role !== "academy_owner" && role !== "coach") || !academyId) throw new ForbiddenException("owner or coach only");
    return { academyId: String(academyId), userId: String(userId), role };
  }

  async status(session: any): Promise<BillingStatus> {
    const { academyId } = this.member(session);
    return this.statusFor(academyId);
  }
  async statusFor(academyId: string): Promise<BillingStatus> {
    const acad: any = await this.academies().findOne({ _id: academyId } as never);
    if (!acad) throw new NotFoundException("academy not found");
    const students = await this.studentCount(academyId);
    const c = this.compute(acad, students);
    const creds = readRazorpayCredentials();
    const keyId = process.env.RAZORPAY_KEY_ID?.trim() || null;
    const pays = await this.payments().find({ academyId, status: { $in: ["paid", "manual"] } } as never).sort({ at: -1 }).limit(24).toArray();
    const sub: any = acad.subscriptionId ? await this.subs().findOne({ _id: acad.subscriptionId } as never) : null;
    return {
      academyId, academyName: acad.name || academyId, state: c.state, plan: acad.plan ?? null,
      students, monthlyPricePaise: c.price, yearlyPricePaise: c.price == null ? null : amountForMonths(c.price, 12), quotation: c.price === null, customPrice: typeof acad.customMonthlyPricePaise === "number" && acad.customMonthlyPricePaise > 0,
      trialEndsAt: c.trialEndsAt?.toISOString() ?? null, paidUntil: c.paidUntil?.toISOString() ?? null, periodEndsAt: c.periodEndsAt?.toISOString() ?? null,
      daysLeft: c.daysLeft, graceEndsAt: c.graceEndsAt?.toISOString() ?? null,
      razorpayConfigured: !!(creds || (keyId && process.env.RAZORPAY_KEY_SECRET)), keyId,
      subscription: sub && !["cancelled", "completed", "expired", "created"].includes(sub.status) ? { id: sub._id, status: sub.status, amountPaise: sub.amountPaise, period: sub.period === "yearly" ? "yearly" : "monthly", nextChargeAt: sub.nextChargeAt ? new Date(sub.nextChargeAt).toISOString() : null, cancelling: !!sub.cancelAtCycleEnd, lastChargeFailedAt: sub.lastChargeFailedAt ? new Date(sub.lastChargeFailedAt).toISOString() : null } : null,
      paymentFailed: !!sub && ["pending", "halted"].includes(sub.status),
      payments: pays.map((p: any) => ({ id: p._id, at: new Date(p.at).toISOString(), amountPaise: p.amountPaise, months: p.months, method: p.method, status: p.status, paidUntil: p.paidUntil ? new Date(p.paidUntil).toISOString() : null, note: p.note })),
      whatsapp: WHATSAPP_DISPLAY,
    };
  }

  /** Owner-only management calls ask this; cached 5 min so it costs nothing on the hot path. */
  async isLocked(academyId: string): Promise<boolean> {
    const c = this.lockCache.get(academyId);
    if (c && Date.now() - c.at < 300_000) return c.locked;
    const acad: any = await this.academies().findOne({ _id: academyId } as never, { projection: { trialEndsAt: 1, paidUntil: 1, plan: 1, subscriptionStatus: 1 } });
    const locked = acad ? this.compute(acad, 0).state === "locked" : false;
    this.lockCache.set(academyId, { locked, at: Date.now() });
    return locked;
  }
  async assertNotLocked(academyId: string): Promise<void> {
    if (await this.isLocked(academyId)) throw new HttpException({ statusCode: 402, message: "Your ChessGuru subscription is due. Open Academy → Billing to continue.", billing: true }, 402);
  }

  // ── pay ───────────────────────────────────────────────────────────────────
  async createOrder(session: any, monthsIn: unknown) {
    const { academyId, role } = this.member(session);
    if (role !== "academy_owner") throw new ForbiddenException("academy owner only");
    const months = [1, 3, 6, 12].includes(Number(monthsIn)) ? Number(monthsIn) : 1;
    const st = await this.statusFor(academyId);
    if (st.quotation || st.monthlyPricePaise == null) throw new BadRequestException(`More than ${QUOTATION_ABOVE} students — WhatsApp ${WHATSAPP_DISPLAY} for a quotation.`);
    if (!st.razorpayConfigured) throw new BadRequestException("Online payment is temporarily unavailable. WhatsApp " + WHATSAPP_DISPLAY + " and we will sort it out.");
    if (!st.paymentFailed) throw new BadRequestException("Please use Subscribe — a one-time payment is offered only when an auto-renew charge has failed.");
    const amountPaise = amountForMonths(st.monthlyPricePaise, months); // a year is charged as 10 months
    const id = "ap_" + Math.random().toString(36).slice(2, 12);
    const order = await createOrder({ amountPaise, receipt: id, notes: { kind: "platform-subscription", academyId, months: String(months), students: String(st.students) } });
    await this.payments().insertOne({ _id: id, academyId, at: new Date(), amountPaise, months, students: st.students, method: "razorpay", status: "created", razorpayOrderId: order.id, byUserId: session.userId } as never);
    const owner: any = await this.users().findOne({ _id: session.userId } as never, { projection: { name: 1, email: 1, mobile: 1, phone: 1 } });
    return { orderId: order.id, amountPaise, currency: "INR", months, keyId: st.keyId, academyName: st.academyName, prefill: { name: owner?.name ?? "", email: owner?.email ?? "", contact: owner?.mobile ?? owner?.phone ?? "" } };
  }

  async confirm(session: any, body: { orderId?: string; paymentId?: string; signature?: string }) {
    const { academyId, role, userId } = this.member(session);
    if (role !== "academy_owner") throw new ForbiddenException("academy owner only");
    const orderId = String(body?.orderId ?? ""), paymentId = String(body?.paymentId ?? ""), signature = String(body?.signature ?? "");
    const pending: any = await this.payments().findOne({ razorpayOrderId: orderId, academyId } as never);
    if (!pending) throw new NotFoundException("order not found");
    if (pending.status === "paid") return { ok: true, alreadyDone: true, status: await this.statusFor(academyId) };
    if (!verifyPaymentHandshake({ orderId, paymentId, signature })) throw new BadRequestException("payment signature did not verify");
    // Belt and braces: ask Razorpay what it thinks of this payment before extending anything.
    const keyId = process.env.RAZORPAY_KEY_ID?.trim() ?? "", secret = process.env.RAZORPAY_KEY_SECRET?.trim() ?? "";
    const r = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, { headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${secret}`).toString("base64")}` } });
    const pay: any = await r.json().catch(() => null);
    if (!r.ok || !pay || pay.order_id !== orderId || !["captured", "authorized"].includes(pay.status) || Number(pay.amount) < pending.amountPaise) {
      throw new BadRequestException(`Razorpay reports this payment as ${pay?.status ?? "unknown"} — nothing was changed. WhatsApp ${WHATSAPP_DISPLAY} if money left your account.`);
    }
    const paidUntil = await this.extend(academyId, pending.months, pending.amountPaise);
    await this.payments().updateOne({ _id: pending._id } as never, { $set: { status: "paid", razorpayPaymentId: paymentId, paidAt: new Date(), paidUntil, confirmedBy: userId } } as never);
    this.lockCache.delete(academyId);
    await this.receipt(academyId, pending.amountPaise, pending.months, paidUntil, "Razorpay");
    return { ok: true, paidUntil: paidUntil.toISOString(), status: await this.statusFor(academyId) };
  }

  /** Extend the paid period: from the later of now / current paidUntil / trial end, by N months. */
  private async extend(academyId: string, months: number, amountPaise: number): Promise<Date> {
    const acad: any = await this.academies().findOne({ _id: academyId } as never);
    const now = new Date();
    const candidates = [now, acad?.paidUntil ? new Date(acad.paidUntil) : null, acad?.trialEndsAt ? new Date(acad.trialEndsAt) : null].filter((d): d is Date => !!d && !isNaN(d.getTime()));
    const base = new Date(Math.max(...candidates.map((d) => d.getTime())));
    const paidUntil = new Date(base); paidUntil.setMonth(paidUntil.getMonth() + months);
    await this.academies().updateOne({ _id: academyId } as never, { $set: { paidUntil, plan: "paid", subscriptionStatus: "active", monthlyPricePaise: Math.round(amountPaise / months), lastPaymentAt: now } } as never);
    return paidUntil;
  }

  /** Superadmin: a special monthly price for one academy (null clears it back to the tiers). */
  async adminSetPrice(academyId: string, body: { monthlyPaise?: number | null; note?: string }, byUserId: string) {
    const acad: any = await this.academies().findOne({ _id: academyId } as never);
    if (!acad) throw new NotFoundException("academy not found");
    const v = body?.monthlyPaise;
    if (v == null) await this.academies().updateOne({ _id: academyId } as never, { $unset: { customMonthlyPricePaise: "", customPriceNote: "" }, $set: { customPriceBy: byUserId, customPriceAt: new Date() } } as never);
    else if (Number(v) > 0) await this.academies().updateOne({ _id: academyId } as never, { $set: { customMonthlyPricePaise: Math.round(Number(v)), customPriceNote: String(body?.note ?? "").slice(0, 200), customPriceBy: byUserId, customPriceAt: new Date() } } as never);
    else throw new BadRequestException("monthlyPaise must be a positive number of paise, or null to clear");
    return { ok: true, status: await this.statusFor(academyId) };
  }
  /** Superadmin: bank transfer / UPI / goodwill — mark N months paid (or a date) by hand. */
  async adminMarkPaid(academyId: string, body: { months?: number; paidUntil?: string; amountPaise?: number; note?: string }, byUserId: string) {
    const acad: any = await this.academies().findOne({ _id: academyId } as never);
    if (!acad) throw new NotFoundException("academy not found");
    let paidUntil: Date;
    const months = Number(body?.months) > 0 ? Math.min(36, Number(body.months)) : 0;
    const amountPaise = Number(body?.amountPaise) > 0 ? Math.round(Number(body.amountPaise)) : (priceForAcademy(acad, await this.studentCount(academyId)) ?? 0) * Math.max(1, months);
    if (body?.paidUntil) {
      paidUntil = new Date(body.paidUntil); if (isNaN(paidUntil.getTime())) throw new BadRequestException("bad paidUntil");
      await this.academies().updateOne({ _id: academyId } as never, { $set: { paidUntil, plan: "paid", subscriptionStatus: "active", lastPaymentAt: new Date() } } as never);
    } else if (months) paidUntil = await this.extend(academyId, months, amountPaise);
    else throw new BadRequestException("months or paidUntil required");
    await this.payments().insertOne({ _id: "ap_" + Math.random().toString(36).slice(2, 12), academyId, at: new Date(), amountPaise, months: months || null, method: "manual", status: "manual", paidUntil, note: String(body?.note ?? "").slice(0, 200), byUserId } as never);
    this.lockCache.delete(academyId);
    await this.receipt(academyId, amountPaise, months || 0, paidUntil, "recorded by ChessGuru");
    return { ok: true, paidUntil: paidUntil.toISOString(), status: await this.statusFor(academyId) };
  }

  // ── auto-renew (Razorpay Subscriptions) ───────────────────────────────────
  /** One Razorpay plan per (amount, period), created lazily and cached in billingPlans. */
  private async ensurePlan(amountPaise: number, period: "monthly" | "yearly"): Promise<string> {
    const cached: any = await this.plans().findOne({ amountPaise, period } as never);
    if (cached) return cached.planId;
    const plan = await this.rzp("/plans", { method: "POST", body: { period, interval: 1, item: { name: `ChessGuru academy · ₹${amountPaise / 100}/${period === "yearly" ? "year" : "month"}`, amount: amountPaise, currency: "INR", description: period === "yearly" ? "ChessGuru platform subscription — yearly (12 months for the price of 10)" : "ChessGuru platform subscription (unlimited coaches; priced by students)" } } });
    await this.plans().insertOne({ _id: plan.id, planId: plan.id, amountPaise, period, createdAt: new Date() } as never);
    return plan.id;
  }
  /** Owner: start an auto-renewing subscription — monthly, or yearly at the 10-month price (owner: "yearly
   *  subscription also with auto renew"). The first period is charged at authorisation. */
  async createSubscription(session: any, periodIn: unknown) {
    const { academyId, role, userId } = this.member(session);
    if (role !== "academy_owner") throw new ForbiddenException("academy owner only");
    const period: "monthly" | "yearly" = periodIn === "yearly" ? "yearly" : "monthly";
    const st = await this.statusFor(academyId);
    if (st.quotation || st.monthlyPricePaise == null) throw new BadRequestException(`More than ${QUOTATION_ABOVE} students — WhatsApp ${WHATSAPP_DISPLAY} for a quotation.`);
    if (st.subscription && ["active", "authenticated", "pending"].includes(st.subscription.status) && !st.subscription.cancelling) throw new BadRequestException("You already have an active subscription.");
    const monthsPerCharge = period === "yearly" ? 12 : 1;
    const amountPaise = amountForMonths(st.monthlyPricePaise, monthsPerCharge);
    const planId = await this.ensurePlan(amountPaise, period);
    const sub = await this.rzp("/subscriptions", { method: "POST", body: { plan_id: planId, total_count: period === "yearly" ? 10 : 120, quantity: 1, customer_notify: 1, notes: { kind: "platform-subscription", academyId, students: String(st.students), period } } });
    await this.subs().insertOne({ _id: sub.id, academyId, planId, amountPaise, period, monthsPerCharge, status: sub.status ?? "created", at: new Date(), byUserId: userId, charges: [] } as never);
    const owner: any = await this.users().findOne({ _id: userId } as never, { projection: { name: 1, email: 1, mobile: 1, phone: 1 } });
    return { subscriptionId: sub.id, amountPaise, period, keyId: st.keyId, academyName: st.academyName, prefill: { name: owner?.name ?? "", email: owner?.email ?? "", contact: owner?.mobile ?? owner?.phone ?? "" } };
  }
  /** After Checkout: verify HMAC(secret, paymentId|subscriptionId), confirm with Razorpay, activate + extend one month. */
  async confirmSubscription(session: any, body: { subscriptionId?: string; paymentId?: string; signature?: string }) {
    const { academyId, role } = this.member(session);
    if (role !== "academy_owner") throw new ForbiddenException("academy owner only");
    const subscriptionId = String(body?.subscriptionId ?? ""), paymentId = String(body?.paymentId ?? ""), signature = String(body?.signature ?? "");
    const rec: any = await this.subs().findOne({ _id: subscriptionId, academyId } as never);
    if (!rec) throw new NotFoundException("subscription not found");
    const secret = process.env.RAZORPAY_KEY_SECRET?.trim() ?? "";
    const expected = crypto.createHmac("sha256", secret).update(`${paymentId}|${subscriptionId}`).digest("hex");
    const a = Buffer.from(expected, "hex"), b = Buffer.from(signature.trim(), "hex");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new BadRequestException("subscription signature did not verify");
    const sub = await this.rzp(`/subscriptions/${encodeURIComponent(subscriptionId)}`);
    if (!["authenticated", "active"].includes(sub.status)) throw new BadRequestException(`Razorpay reports the subscription as ${sub.status} — nothing was changed.`);
    await this.applySubscriptionCharge(subscriptionId, paymentId, rec.amountPaise, "checkout");
    await this.subs().updateOne({ _id: subscriptionId } as never, { $set: { status: sub.status, nextChargeAt: sub.charge_at ? new Date(sub.charge_at * 1000) : null, currentEnd: sub.current_end ? new Date(sub.current_end * 1000) : null } } as never);
    return { ok: true, status: await this.statusFor(academyId) };
  }
  /** Idempotent: one month per Razorpay payment id, from checkout OR the webhook (whichever lands first). */
  private async applySubscriptionCharge(subscriptionId: string, paymentId: string, amountPaise: number, via: string): Promise<boolean> {
    const rec: any = await this.subs().findOne({ _id: subscriptionId } as never); if (!rec) return false;
    if (await this.payments().findOne({ razorpayPaymentId: paymentId } as never)) return false;
    const months = rec.monthsPerCharge === 12 ? 12 : 1; // yearly plan renews a year at a time
    const paidUntil = await this.extend(rec.academyId, months, amountPaise);
    await this.payments().insertOne({ _id: "ap_" + Math.random().toString(36).slice(2, 12), academyId: rec.academyId, at: new Date(), amountPaise, months, method: "razorpay-subscription", status: "paid", razorpayPaymentId: paymentId, subscriptionId, paidUntil, via } as never);
    await this.academies().updateOne({ _id: rec.academyId } as never, { $set: { subscriptionId, autoRenew: true } } as never);
    await this.subs().updateOne({ _id: subscriptionId } as never, { $push: { charges: { paymentId, amountPaise, at: new Date(), via } }, $set: { status: "active" } } as never);
    this.lockCache.delete(rec.academyId);
    await this.receipt(rec.academyId, amountPaise, months, paidUntil, `Razorpay auto-renew (${rec.period === "yearly" ? "yearly" : "monthly"})`);
    return true;
  }
  /** Owner: stop auto-renew at the end of the paid cycle (what is paid stays paid). */
  async cancelSubscription(session: any) {
    const { academyId, role } = this.member(session);
    if (role !== "academy_owner") throw new ForbiddenException("academy owner only");
    const acad: any = await this.academies().findOne({ _id: academyId } as never);
    if (!acad?.subscriptionId) throw new NotFoundException("no subscription");
    const sub = await this.rzp(`/subscriptions/${encodeURIComponent(acad.subscriptionId)}/cancel`, { method: "POST", body: { cancel_at_cycle_end: 1 } });
    await this.subs().updateOne({ _id: acad.subscriptionId } as never, { $set: { status: sub.status ?? "cancelled", cancelAtCycleEnd: true, cancelledAt: new Date() } } as never);
    await this.academies().updateOne({ _id: academyId } as never, { $set: { autoRenew: false } } as never);
    return { ok: true, status: await this.statusFor(academyId) };
  }

  // ── webhook ───────────────────────────────────────────────────────────────
  /** Razorpay → us. Dashboard: URL <origin>/v2api/api/billing/webhook/razorpay, secret = RAZORPAY_WEBHOOK_SECRET,
   *  events: payment.captured, subscription.charged / activated / cancelled / halted / paused / completed. */
  async webhook(rawBody: Buffer | string | undefined, signature: string, parsed: any): Promise<{ ok: boolean; handled?: string }> {
    if (!process.env.RAZORPAY_WEBHOOK_SECRET?.trim()) throw new ForbiddenException("webhook secret not configured");
    if (!rawBody || !verifyWebhookSignature(rawBody, signature)) throw new ForbiddenException("bad signature");
    const event = String(parsed?.event ?? "");
    const pay = parsed?.payload?.payment?.entity, sub = parsed?.payload?.subscription?.entity;
    if (event === "subscription.charged" && sub?.id && pay?.id) {
      const applied = await this.applySubscriptionCharge(sub.id, pay.id, Number(pay.amount) || 0, "webhook");
      await this.subs().updateOne({ _id: sub.id } as never, { $set: { nextChargeAt: sub.charge_at ? new Date(sub.charge_at * 1000) : null, currentEnd: sub.current_end ? new Date(sub.current_end * 1000) : null, paidCount: sub.paid_count ?? null } } as never);
      return { ok: true, handled: applied ? "charged" : "duplicate" };
    }
    if (event.startsWith("subscription.") && sub?.id) {
      const status = event.slice("subscription.".length); // activated / authenticated / cancelled / halted / paused / resumed / completed / pending
      const failed = ["pending", "halted"].includes(sub.status ?? status); // pending = a charge failed and Razorpay is retrying; halted = retries exhausted
      await this.subs().updateOne({ _id: sub.id } as never, { $set: { status: sub.status ?? status, nextChargeAt: sub.charge_at ? new Date(sub.charge_at * 1000) : null, ...(failed ? { lastChargeFailedAt: new Date() } : {}) } } as never);
      const rec: any = await this.subs().findOne({ _id: sub.id } as never);
      if (rec && ["cancelled", "halted", "paused", "completed", "expired"].includes(sub.status ?? status)) await this.academies().updateOne({ _id: rec.academyId } as never, { $set: { autoRenew: false } } as never);
      return { ok: true, handled: event };
    }
    if (event === "payment.captured" && pay?.id && pay?.order_id && pay?.notes?.kind === "platform-subscription") {
      const pending: any = await this.payments().findOne({ razorpayOrderId: pay.order_id } as never);
      if (pending && pending.status !== "paid" && Number(pay.amount) >= pending.amountPaise) {
        const paidUntil = await this.extend(pending.academyId, pending.months, pending.amountPaise);
        await this.payments().updateOne({ _id: pending._id } as never, { $set: { status: "paid", razorpayPaymentId: pay.id, paidAt: new Date(), paidUntil, via: "webhook" } } as never);
        this.lockCache.delete(pending.academyId);
        await this.receipt(pending.academyId, pending.amountPaise, pending.months, paidUntil, "Razorpay");
        return { ok: true, handled: "order-paid" };
      }
      return { ok: true, handled: "order-duplicate" };
    }
    return { ok: true, handled: "ignored" };
  }

  // ── reminders ─────────────────────────────────────────────────────────────
  private async ownerEmail(acad: any): Promise<{ email: string | null; name: string }> {
    const o: any = await this.users().findOne({ _id: acad.ownerId } as never, { projection: { email: 1, name: 1, username: 1 } });
    return { email: o?.email && /@/.test(o.email) ? o.email : null, name: o?.name || o?.username || "there" };
  }
  private async receipt(academyId: string, amountPaise: number, months: number, paidUntil: Date, method: string) {
    try {
      const acad: any = await this.academies().findOne({ _id: academyId } as never); if (!acad) return;
      const { email, name } = await this.ownerEmail(acad); if (!email) return;
      const until = paidUntil.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
      await sendMail({ to: email, subject: `ChessGuru · payment received — ${acad.name} is active until ${until}`,
        html: `<p>Hi ${name},</p><p>Thanks — we received <b>₹${(amountPaise / 100).toLocaleString("en-IN")}</b> (${method}${months ? `, ${months} month${months === 1 ? "" : "s"}` : ""}) for <b>${acad.name}</b>.</p><p>Your academy is active until <b>${until}</b>. Manage billing any time at <a href="${PUBLIC_ORIGIN}/academy/billing">${PUBLIC_ORIGIN}/academy/billing</a>.</p><p>— ChessGuru · WhatsApp ${WHATSAPP_DISPLAY}</p>`,
        text: `Hi ${name}, we received ₹${(amountPaise / 100).toLocaleString("en-IN")} (${method}) for ${acad.name}. Active until ${until}. Billing: ${PUBLIC_ORIGIN}/academy/billing` });
    } catch (e) { console.error("[billing] receipt mail", e); }
  }
  /** Every 6 h: 7 days / 1 day before the period ends, on the day it ends, and when the grace period ends. */
  async tick(): Promise<void> {
    const now = new Date(); const today = now.toISOString().slice(0, 10);
    const acads = await this.academies().find({ $or: [{ trialEndsAt: { $exists: true } }, { paidUntil: { $exists: true } }] } as never).toArray();
    for (const acad of acads as any[]) {
      const c = this.compute(acad, 0, now);
      let kind: string | null = null;
      if (c.state === "trialing" || c.state === "active") { if (c.daysLeft === 7) kind = "7d"; else if (c.daysLeft === 1) kind = "1d"; }
      else if (c.state === "grace" && c.daysLeft != null && c.daysLeft >= -1) kind = "ended";
      else if (c.state === "locked" && c.graceEndsAt && now.getTime() - c.graceEndsAt.getTime() < DAY) kind = "locked";
      if (!kind) continue;
      const key = `${acad._id}:${kind}:${today}`;
      if (await this.reminders().findOne({ _id: key } as never)) continue;
      await this.reminders().insertOne({ _id: key, academyId: acad._id, kind, at: now } as never);
      const { email, name } = await this.ownerEmail(acad);
      const students = await this.studentCount(acad._id); const price = priceForAcademy(acad, students);
      const priceTxt = price == null ? `a quotation (WhatsApp ${WHATSAPP_DISPLAY})` : `₹${(price / 100).toLocaleString("en-IN")} / month for ${students} students`;
      const when = c.periodEndsAt?.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) ?? "";
      const subject = kind === "7d" ? `ChessGuru · ${acad.name}: ${c.state === "trialing" ? "trial" : "subscription"} ends in 7 days (${when})`
        : kind === "1d" ? `ChessGuru · ${acad.name}: ${c.state === "trialing" ? "trial" : "subscription"} ends tomorrow`
        : kind === "ended" ? `ChessGuru · ${acad.name}: ${c.trialEndsAt && !c.paidUntil ? "trial" : "subscription"} ended — ${GRACE_DAYS} days of grace`
        : `ChessGuru · ${acad.name}: academy management is paused until payment`;
      console.log(`[billing] reminder ${kind} → ${acad._id} (${email ?? "no owner email"})`);
      if (!email) continue;
      const body = `Hi ${name},\n\n${subject.replace(/^ChessGuru · /, "")}.\n\nYour plan: ${priceTxt}. Coaches stay unlimited; students are never locked out.\n\nPay online (Razorpay — UPI / card / net banking): ${PUBLIC_ORIGIN}/academy/billing\nQuestions? WhatsApp ${WHATSAPP_DISPLAY}.\n\n— ChessGuru`;
      try { await sendMail({ to: email, subject, text: body, html: body.replace(/\n/g, "<br>") }); } catch (e) { console.error("[billing] reminder mail", e); }
    }
  }
}
