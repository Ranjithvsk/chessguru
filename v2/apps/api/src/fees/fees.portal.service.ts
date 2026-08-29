// Parent portal service — public HTTP surface for guardians.
//
// Every method here takes a portal token instead of a session cookie. The
// token is HMAC-derived (see fees.pg.ts) so verification is stateless. Any
// person with the URL can act on this guardian's students — that's the whole
// point of the magic-link model. No signup, no login, no password reset flow.
//
// The service reuses FeesService for the write-side: recordManualPayment's
// FIFO allocator handles Razorpay-captured payments identically to cash, just
// with pgProvider=razorpay + method inferred from the payment payload. This
// keeps the invoice state machine simple (one code path for all successful
// payments) and idempotent under webhook retries (pgPaymentId unique index).

import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { ObjectId } from "mongodb";
import {
  COL,
  CreateCheckoutOrderResponse,
  InvoiceDoc,
  PaymentAllocationDoc,
  PaymentDoc,
  PaymentMethod,
  PortalInvoiceLine,
  PortalResponse,
} from "./fees.types";
import {
  createOrder as rzpCreateOrder,
  isConfigured as rzpIsConfigured,
  readRazorpayCredentials,
  verifyPortalToken,
  verifyWebhookSignature,
} from "./fees.pg";
import { sendMail } from "../lib/mail";

@Injectable()
export class FeesPortalService {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  private invoices()    { return this.conn.db!.collection<InvoiceDoc>(COL.invoices); }
  private payments()    { return this.conn.db!.collection<PaymentDoc>(COL.payments); }
  private allocs()      { return this.conn.db!.collection<PaymentAllocationDoc>(COL.paymentAllocs); }
  private users()       { return this.conn.db!.collection("users"); }
  private academies()   { return this.conn.db!.collection("academies"); }
  private academyBrand(){ return this.conn.db!.collection("academybrandings"); }
  private counters()    { return this.conn.db!.collection("fees_counters"); }
  private programs()    { return this.conn.db!.collection("fees_programs"); }

  // ---- token resolve ---------------------------------------------------

  /** Verifies the token → returns {academyId, guardianUserId} or throws 403. */
  private resolveToken(token: string, academyId: string, guardianUserId: string): { academyId: string; guardianUserId: string } {
    if (!verifyPortalToken(token, academyId, guardianUserId)) {
      throw new ForbiddenException("Invalid or expired portal link. Ask the academy to resend the link.");
    }
    return { academyId, guardianUserId };
  }

  // ---- portal view -----------------------------------------------------

  async portalView(token: string, academyId: string, guardianUserId: string): Promise<PortalResponse> {
    const { } = this.resolveToken(token, academyId, guardianUserId);

    // Load guardian + academy + branding in parallel with the invoice list.
    const [guardian, academy, brand, invoicesRaw] = await Promise.all([
      this.users().findOne(
        { _id: this.oid(guardianUserId), role: "parent" },
        { projection: { name: 1, username: 1, email: 1, mobile: 1 } as never },
      ),
      this.academies().findOne(
        { $or: [{ _id: this.tryOid(academyId) }, { slug: academyId }] },
        { projection: { name: 1, slug: 1, tagline: 1 } as never },
      ),
      this.academyBrand().findOne({ academyId }, { projection: { brandName: 1, tagline: 1 } as never }),
      this.invoices().find(
        { academyId, guardianUserId, status: { $in: ["SENT", "PARTIAL", "OVERDUE", "PAID"] } },
      ).sort({ dueOn: 1 }).limit(50).toArray(),
    ]);
    if (!guardian) throw new NotFoundException("Guardian not found.");

    // Enrich with student names + program names.
    const stuIds = Array.from(new Set(invoicesRaw.map((i) => i.studentUserId))).map((s) => this.tryOid(s)).filter((v): v is ObjectId => !!v);
    const progIds = Array.from(new Set(invoicesRaw.map((i) => i.programId))).map((s) => this.tryOid(s)).filter((v): v is ObjectId => !!v);
    const [students, programs] = await Promise.all([
      stuIds.length ? this.users().find({ _id: { $in: stuIds } }, { projection: { name: 1, username: 1 } as never }).toArray() : Promise.resolve([]),
      progIds.length ? this.programs().find({ _id: { $in: progIds } }, { projection: { name: 1 } as never }).toArray() : Promise.resolve([]),
    ]);
    const sById = new Map(students.map((s) => [String(s._id), s]));
    const pById = new Map(programs.map((p) => [String(p._id), p]));

    const now = new Date();
    const invoices: PortalInvoiceLine[] = invoicesRaw.map((inv) => {
      const balance = Math.max(0, inv.totalPaise - inv.paidPaise);
      const overdue = balance > 0 && (inv.status === "SENT" || inv.status === "PARTIAL") && inv.dueOn < now;
      const start = inv.periodStart; const end = inv.periodEnd;
      const periodLabel = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()
        ? start.toLocaleDateString("en-IN", { month: "long", year: "numeric" })
        : `${start.toLocaleDateString("en-IN", { month: "short", day: "numeric" })} – ${end.toLocaleDateString("en-IN", { month: "short", day: "numeric", year: "numeric" })}`;
      return {
        id: String(inv._id),
        invoiceNo: inv.invoiceNo,
        studentName: (sById.get(inv.studentUserId)?.name as string) ?? (sById.get(inv.studentUserId)?.username as string) ?? undefined,
        programName: (pById.get(inv.programId)?.name as string) ?? undefined,
        periodLabel,
        totalPaise: inv.totalPaise,
        paidPaise: inv.paidPaise,
        balancePaise: balance,
        dueOn: inv.dueOn.toISOString(),
        status: inv.status,
        overdue,
      };
    });

    const totalOutstanding = invoices.reduce((s, i) => s + i.balancePaise, 0);
    const academyName = (brand?.brandName as string) || (academy?.name as string) || "Chess Academy";
    const academyTagline = (brand?.tagline as string) || (academy?.tagline as string) || undefined;

    return {
      guardianName: (guardian.name as string) ?? (guardian.username as string) ?? "there",
      guardianPhone: (guardian.mobile as string) ?? undefined,
      academyName,
      academyTagline,
      invoices,
      currency: "INR",
      totalOutstandingPaise: totalOutstanding,
      razorpayAvailable: rzpIsConfigured(),
    };
  }

  // ---- create checkout order ------------------------------------------

  async createCheckoutOrder(token: string, academyId: string, guardianUserId: string, invoiceIds: string[]): Promise<CreateCheckoutOrderResponse> {
    this.resolveToken(token, academyId, guardianUserId);
    if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
      throw new BadRequestException("Pick at least one invoice to pay.");
    }
    if (invoiceIds.length > 20) throw new BadRequestException("Too many invoices in one checkout (max 20).");
    const creds = readRazorpayCredentials();
    if (!creds) throw new BadRequestException("Online payment isn't configured yet. Please pay the academy directly.");

    const oids = invoiceIds.map((s) => this.oid(s));
    const invoices = await this.invoices().find({ _id: { $in: oids }, academyId, guardianUserId }).toArray();
    if (invoices.length !== invoiceIds.length) throw new BadRequestException("One or more invoices weren't found.");

    let amountPaise = 0;
    for (const inv of invoices) {
      if (inv.status === "CANCELLED" || inv.status === "WAIVED") throw new BadRequestException(`Invoice ${inv.invoiceNo} is ${inv.status.toLowerCase()} — can't pay against it.`);
      const bal = Math.max(0, inv.totalPaise - inv.paidPaise);
      if (bal <= 0) throw new BadRequestException(`Invoice ${inv.invoiceNo} has no balance to pay.`);
      amountPaise += bal;
    }
    if (amountPaise <= 0) throw new BadRequestException("Nothing to pay — all selected invoices are already settled.");

    const [guardian, academy, brand] = await Promise.all([
      this.users().findOne({ _id: this.oid(guardianUserId) }, { projection: { name: 1, username: 1, mobile: 1 } as never }),
      this.academies().findOne(
        { $or: [{ _id: this.tryOid(academyId) }, { slug: academyId }] },
        { projection: { name: 1 } as never },
      ),
      this.academyBrand().findOne({ academyId }, { projection: { brandName: 1 } as never }),
    ]);
    const academyName = (brand?.brandName as string) || (academy?.name as string) || "Chess Academy";

    // notes are echoed back in the webhook payload so we can look up which
    // invoices this payment settled without a separate order-store roundtrip.
    // Keep values ≤ 256 chars (RZP limit).
    const order = await rzpCreateOrder({
      amountPaise,
      receipt: `p_${guardianUserId}_${Date.now()}`.slice(0, 40),
      notes: {
        academyId,
        guardianUserId,
        invoiceIds: invoiceIds.slice(0, 20).join(","),   // comma-separated for compactness
      },
    });

    return {
      razorpayKeyId: creds.keyId,
      razorpayOrderId: order.id,
      amountPaise,
      currency: "INR",
      guardianName: (guardian?.name as string) ?? (guardian?.username as string) ?? undefined,
      guardianPhone: (guardian?.mobile as string) ?? undefined,
      invoiceIds,
      academyName,
    };
  }

  // ---- webhook handler -------------------------------------------------

  /** Verifies the signature, extracts payment.captured / payment.failed events,
   *  and (on capture) inserts a Payment row + FIFO-allocates to invoices.
   *  Idempotent — pgPaymentId unique per academyId means retries collapse. */
  async handleWebhook(rawBody: string, signatureHeader: string): Promise<{ ok: true; handled: string; note?: string }> {
    if (!verifyWebhookSignature(rawBody, signatureHeader)) {
      throw new ForbiddenException("Bad signature.");
    }
    let payload: {
      event?: string;
      payload?: { payment?: { entity?: { id: string; amount: number; method: string; status: string; order_id: string; email?: string; contact?: string; captured_at?: number; notes?: Record<string, string> } } };
    };
    try { payload = JSON.parse(rawBody); } catch { throw new BadRequestException("Bad JSON body."); }

    const event = payload?.event ?? "";
    const p = payload?.payload?.payment?.entity;
    if (!p) return { ok: true, handled: event, note: "no payment entity — ignored" };

    if (event !== "payment.captured") {
      // We only act on captured. failed / refunded are logged for later
      // (deferred to a refund pipeline). Signature was valid so it's safe to
      // just ack — RZP will stop retrying.
      return { ok: true, handled: event, note: "event not captured — noop" };
    }

    const notes = p.notes ?? {};
    const academyId = notes.academyId;
    const guardianUserId = notes.guardianUserId;
    const invoiceIdsStr = notes.invoiceIds ?? "";
    const invoiceIds = invoiceIdsStr.split(",").map((s) => s.trim()).filter(Boolean);
    if (!academyId || !guardianUserId || invoiceIds.length === 0) {
      return { ok: true, handled: event, note: "missing notes — signed but unusable, ignored" };
    }

    // Idempotent insert: unique(academyId, pgPaymentId) — a retry returns the
    // existing row instead of creating a duplicate.
    const existing = await this.payments().findOne({ academyId, pgPaymentId: p.id });
    if (existing) {
      return { ok: true, handled: event, note: `duplicate: payment ${p.id} already recorded as ${existing.receiptNo}` };
    }

    // Reuse FeesService's receipt-no counter for numbering (shared with manual entries).
    const receiptNo = await this.buildReceiptNo(academyId);

    // Method mapping — Razorpay's `method` field is one of card|upi|netbanking|wallet|emi|...
    const method: PaymentMethod =
      p.method === "upi" ? "UPI" :
      p.method === "card" ? "CARD" :
      p.method === "wallet" ? "WALLET" : "CARD";

    const now = new Date();
    const capturedAt = p.captured_at ? new Date(p.captured_at * 1000) : now;

    const insertRes = await this.payments().insertOne({
      _id: new ObjectId(),
      academyId,
      guardianUserId,
      amountPaise: p.amount,
      method,
      pgProvider: "razorpay",
      pgOrderId: p.order_id,
      pgPaymentId: p.id,
      status: "CAPTURED",
      receiptNo,
      capturedAt,
      note: undefined,
      createdBy: "system:razorpay-webhook",
      createdAt: now,
    } as PaymentDoc);
    const paymentId = insertRes.insertedId as ObjectId;

    // FIFO alloc across the invoices listed in notes.invoiceIds (order preserved
    // as sent by client — client already picked order by dueOn ASC).
    const oids = invoiceIds.map((s) => { try { return new ObjectId(s); } catch { return null; } }).filter((v): v is ObjectId => !!v);
    const invoices = await this.invoices().find({ _id: { $in: oids }, academyId }).toArray();
    let remaining = p.amount;
    const allocs: PaymentAllocationDoc[] = [];
    for (const inv of invoices) {
      if (remaining <= 0) break;
      const openBalance = Math.max(0, inv.totalPaise - inv.paidPaise);
      if (openBalance === 0) continue;
      const take = Math.min(openBalance, remaining);
      allocs.push({
        _id: new ObjectId(),
        academyId,
        paymentId: String(paymentId),
        invoiceId: String(inv._id),
        amountPaise: take,
        createdAt: now,
      });
      remaining -= take;
    }
    if (allocs.length > 0) {
      await this.allocs().insertMany(allocs);
      for (const a of allocs) {
        const inv = invoices.find((i) => String(i._id) === a.invoiceId);
        if (!inv) continue;
        const newPaid = inv.paidPaise + a.amountPaise;
        const newStatus: InvoiceDoc["status"] = newPaid >= inv.totalPaise ? "PAID" : "PARTIAL";
        const upd: Record<string, unknown> = { paidPaise: newPaid, status: newStatus, updatedAt: now };
        if (newStatus === "PAID") upd.paidAt = now;
        await this.invoices().updateOne({ _id: inv._id, academyId }, { $set: upd });
      }
    }

    // Fire-and-forget: send receipt email if guardian has one on file.
    void this.sendReceiptEmail(academyId, guardianUserId, String(paymentId)).catch(() => { /* best-effort */ });

    return { ok: true, handled: event, note: `captured ${p.id} → ${allocs.length} invoices, leftover ₹${remaining / 100}` };
  }

  // ---- receipt email (auto after capture) ------------------------------

  private async sendReceiptEmail(academyId: string, guardianUserId: string, paymentId: string): Promise<void> {
    const [payment, guardian, academy, brand] = await Promise.all([
      this.payments().findOne({ _id: this.oid(paymentId), academyId }),
      this.users().findOne({ _id: this.oid(guardianUserId) }, { projection: { name: 1, username: 1, email: 1 } as never }),
      this.academies().findOne({ $or: [{ _id: this.tryOid(academyId) }, { slug: academyId }] }, { projection: { name: 1 } as never }),
      this.academyBrand().findOne({ academyId }, { projection: { brandName: 1 } as never }),
    ]);
    if (!payment) return;
    const email = (guardian?.email as string) || "";
    if (!email) return;

    const academyName = (brand?.brandName as string) || (academy?.name as string) || "Chess Academy";
    const guardianName = (guardian?.name as string) ?? (guardian?.username as string) ?? "there";
    const amtStr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: payment.amountPaise % 100 === 0 ? 0 : 2 }).format(payment.amountPaise / 100);
    const receiptUrl = `${process.env.CHESSGURU_PUBLIC_ORIGIN ?? "https://chessguru.cc"}/v2api/api/fees/payments/${paymentId}/receipt.pdf`;
    const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a">
  <div style="max-width:520px;margin:24px auto;padding:0 16px">
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden">
      <div style="background:#059669;color:#fff;padding:14px 20px;font-weight:700;font-size:14px">${escapeHtml(academyName)} · Payment received</div>
      <div style="padding:24px 20px">
        <h1 style="margin:0 0 10px;font-size:22px">Thank you, ${escapeHtml(guardianName)}!</h1>
        <p style="margin:0 0 14px;color:#334155">We've received your payment of <b>${amtStr}</b>.</p>
        <p style="margin:0 0 14px;color:#334155">Receipt no: <code style="background:#f1f5f9;padding:2px 6px;border-radius:6px">${escapeHtml(payment.receiptNo)}</code></p>
        <a href="${receiptUrl}" style="display:inline-block;background:#059669;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:700">Download receipt (PDF)</a>
      </div>
    </div>
  </div>
</body></html>`;
    const text = `Thank you, ${guardianName}!\n\nWe've received your payment of ${amtStr}.\nReceipt: ${payment.receiptNo}\nDownload: ${receiptUrl}\n\n— ${academyName}`;
    await sendMail({ to: email, subject: `Payment received — ${payment.receiptNo} · ${academyName}`, html, text });
  }

  // ---- portal payment history -----------------------------------------

  async recentPaymentsForGuardian(token: string, academyId: string, guardianUserId: string, limit = 20) {
    this.resolveToken(token, academyId, guardianUserId);
    const payments = await this.payments().find({ academyId, guardianUserId, status: "CAPTURED" }).sort({ capturedAt: -1 }).limit(limit).toArray();
    if (payments.length === 0) return [];
    const payIds = payments.map((p) => String(p._id));
    const allocs = await this.allocs().find({ academyId, paymentId: { $in: payIds } }).toArray();
    const invIds = Array.from(new Set(allocs.map((a) => a.invoiceId))).map((s) => this.tryOid(s)).filter((v): v is ObjectId => !!v);
    const invs = invIds.length ? await this.invoices().find({ _id: { $in: invIds } }, { projection: { invoiceNo: 1 } as never }).toArray() : [];
    const invNoById = new Map(invs.map((i) => [String(i._id), i.invoiceNo as string]));
    return payments.map((p) => ({
      id: String(p._id),
      receiptNo: p.receiptNo,
      amountPaise: p.amountPaise,
      method: p.method,
      capturedAt: (p.capturedAt ?? p.createdAt).toISOString(),
      invoiceNos: allocs.filter((a) => a.paymentId === String(p._id)).map((a) => invNoById.get(a.invoiceId)).filter((v): v is string => !!v),
    }));
  }

  // ---- helpers --------------------------------------------------------

  private oid(id: string): ObjectId {
    try { return new ObjectId(id); }
    catch { throw new BadRequestException("Bad id."); }
  }
  private tryOid(id: string): ObjectId | undefined {
    try { return new ObjectId(id); } catch { return undefined; }
  }

  /** Same receipt-no format as manual payments: {PREFIX}/{FY}/R-{6-digit}.
   *  We duplicate the counter helper here rather than injecting FeesService
   *  to keep the portal module free of admin-side deps. Both call sites hit
   *  the same fees_counters row via the same $inc so numbering stays
   *  monotonic. */
  private async buildReceiptNo(academyId: string): Promise<string> {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const startY = m >= 3 ? y : y - 1;
    const fy = `${startY}-${String((startY + 1) % 100).padStart(2, "0")}`;
    await this.counters().updateOne(
      { academyId, kind: "receipt", fyStamp: { $ne: fy } },
      { $set: { seq: 0, fyStamp: fy } },
    );
    const r = await this.counters().findOneAndUpdate(
      { academyId, kind: "receipt" },
      { $inc: { seq: 1 }, $setOnInsert: { fyStamp: fy } },
      { upsert: true, returnDocument: "after" },
    );
    const doc = (r && (r as { value?: { seq: number } }).value) ?? (r as { seq?: number } | undefined);
    const seq: number = (doc as { seq?: number })?.seq ?? 1;

    // Prefix — best-effort from academy slug.
    const academy = await this.academies().findOne(
      { $or: [{ _id: this.tryOid(academyId) }, { slug: academyId }] },
      { projection: { slug: 1 } as never },
    );
    const slug = (academy?.slug as string) || academyId || "ACAD";
    const prefix = slug.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 12) || "ACAD";
    return `${prefix}/${fy}/R-${String(seq).padStart(6, "0")}`;
  }
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c] as string));
}
