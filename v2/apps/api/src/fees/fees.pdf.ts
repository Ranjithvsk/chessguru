// Invoice + receipt PDF generation via PDFKit.
//
// Two entry points:
//   buildInvoicePdf(invoice, branding, ctx) → Buffer
//   buildReceiptPdf(payment, invoices, branding, ctx) → Buffer
//
// Design notes (matches CHESSGURU-FEES-WORLD-CLASS §Trust §Money Lineage):
//   * Vector-first: everything drawn with primitives so scaling is crisp.
//     Logo image is embedded raster only if provided.
//   * Money always shown with en-IN grouping (fmtRupees) — same formatter
//     the web UI uses so a PDF matches what the owner saw on screen.
//   * Deliberately minimal chrome — accountants care about numbers, not
//     branding. Header is one line + logo, footer is one line.
//   * "Money lineage" panel on the receipt PDF names the head-level split
//     so a parent can see exactly where their rupee went (per §Trust).

import PDFDocument from "pdfkit";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { InvoiceDoc, PaymentDoc, PaymentAllocationDoc } from "./fees.types";

// PDFKit's built-in Helvetica lacks ₹ (U+20B9). We ship DejaVu Sans (700 KB,
// widely-licensed) so every deploy renders identical PDFs regardless of the
// OS font stack. Loaded once at module import — cached buffers passed to each
// doc.registerFont call.
//
// This file compiles under CommonJS (nest build → dist/fees/fees.pdf.js).
// __dirname resolves to that dist path; we also probe the src tree as a
// fallback for dev-mode `tsx watch` runs where dist isn't populated.
function resolveFontsDir(): string {
  const here = __dirname;
  const candidates = [
    path.join(here, "fonts"),
    // dist layout: apps/api/dist/fees/fees.pdf.js → walk back to src/fees/fonts
    path.join(here, "..", "..", "src", "fees", "fonts"),
    path.join(process.cwd(), "apps", "api", "src", "fees", "fonts"),
  ];
  for (const c of candidates) {
    try { readFileSync(path.join(c, "DejaVuSans.ttf")); return c; } catch { /* try next */ }
  }
  throw new Error("Bundled DejaVu Sans not found — reinstall the API package to restore src/fees/fonts/*.ttf.");
}
let FONTS_CACHED: { regular: Buffer; bold: Buffer } | null = null;
function loadFonts(): { regular: Buffer; bold: Buffer } {
  if (FONTS_CACHED) return FONTS_CACHED;
  const dir = resolveFontsDir();
  FONTS_CACHED = {
    regular: readFileSync(path.join(dir, "DejaVuSans.ttf")),
    bold:    readFileSync(path.join(dir, "DejaVuSans-Bold.ttf")),
  };
  return FONTS_CACHED;
}
function registerFonts(doc: InstanceType<typeof PDFDocument>) {
  const f = loadFonts();
  doc.registerFont("Body",     f.regular);
  doc.registerFont("Body-Bold", f.bold);
  doc.registerFont("Body-Italic", f.regular);   // DejaVu Sans Oblique not bundled; italic falls back to regular for now
  doc.font("Body");
}

// ---- shared helpers ---------------------------------------------------------

const COLORS = {
  ink: "#0b0f19",
  text: "#111827",
  subtle: "#6b7280",
  hair: "#e5e7eb",
  brand: "#4f46e5",     // indigo — matches brand.600 on the web
  accent: "#059669",    // emerald — matches accent.600
  gold: "#d97706",
} as const;

function fmtRupees(paise: number): string {
  const r = paise / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: r % 1 === 0 ? 0 : 2,
  }).format(r);
}

function fmtDate(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" });
}

function fmtPeriod(start: Date, end: Date): string {
  const s = start, e = end;
  if (s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth()) {
    return s.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  }
  return `${s.toLocaleDateString("en-IN", { month: "short", day: "numeric" })} – ${e.toLocaleDateString("en-IN", { month: "short", day: "numeric", year: "numeric" })}`;
}

// Header row shared by invoice + receipt. Logo is optional — if the caller
// provides a data URL or path we embed; otherwise render initials only.
function renderHeader(
  doc: InstanceType<typeof PDFDocument>,
  branding: BrandingCtx,
  rightBlock: { label: string; value: string; badge?: { text: string; color: string } },
) {
  const top = doc.page.margins.top;
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;

  // ---- left: academy identity
  if (branding.logoBuffer) {
    try { doc.image(branding.logoBuffer, left, top, { fit: [56, 56] }); } catch { /* bad image → skip */ }
    doc.fillColor(COLORS.text).font("Body-Bold").fontSize(16).text(branding.name, left + 68, top + 4, { width: 320 });
    doc.fillColor(COLORS.subtle).font("Body").fontSize(9).text(branding.tagline ?? "Chess academy", left + 68, top + 26);
    if (branding.contactLine) doc.text(branding.contactLine, left + 68, top + 40);
  } else {
    // Initials chip if no logo
    const initials = branding.name.split(/\s+/).slice(0, 2).map((w) => w[0] ?? "").join("").toUpperCase() || "A";
    doc.roundedRect(left, top, 56, 56, 10).fillColor(COLORS.brand).fill();
    doc.fillColor("#fff").font("Body-Bold").fontSize(20).text(initials, left, top + 18, { width: 56, align: "center" });
    doc.fillColor(COLORS.text).font("Body-Bold").fontSize(16).text(branding.name, left + 68, top + 4, { width: 320 });
    doc.fillColor(COLORS.subtle).font("Body").fontSize(9).text(branding.tagline ?? "Chess academy", left + 68, top + 26);
    if (branding.contactLine) doc.text(branding.contactLine, left + 68, top + 40);
  }

  // ---- right: label + big value + optional status pill.
  // Width sized for a max invoice number "PREFIXPREFIX/YYYY-YY/NNNNNN" at 15pt DejaVu Bold.
  const rBlockW = 260;
  const rX = right - rBlockW;
  doc.fillColor(COLORS.subtle).font("Body").fontSize(9).text(rightBlock.label.toUpperCase(), rX, top + 2, { width: rBlockW, align: "right" });
  doc.fillColor(COLORS.text).font("Body-Bold").fontSize(15).text(rightBlock.value, rX, top + 16, { width: rBlockW, align: "right" });
  if (rightBlock.badge) {
    const pillW = doc.widthOfString(rightBlock.badge.text.toUpperCase()) + 14;
    const pillX = right - pillW;
    const pillY = top + 40;
    doc.roundedRect(pillX, pillY, pillW, 16, 8).fillColor(rightBlock.badge.color).fill();
    doc.fillColor("#fff").font("Body-Bold").fontSize(8).text(rightBlock.badge.text.toUpperCase(), pillX, pillY + 4, { width: pillW, align: "center" });
  }

  // Divider under header
  doc.moveTo(left, top + 72).lineTo(right, top + 72).lineWidth(0.5).strokeColor(COLORS.hair).stroke();
  doc.y = top + 84;
  doc.x = left;
}

function renderFooter(doc: InstanceType<typeof PDFDocument>, branding: BrandingCtx) {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const bottom = doc.page.height - doc.page.margins.bottom;
  doc.moveTo(left, bottom - 26).lineTo(right, bottom - 26).lineWidth(0.5).strokeColor(COLORS.hair).stroke();
  doc.fillColor(COLORS.subtle).font("Body").fontSize(8);
  doc.text(`${branding.name} · ${branding.footerLine ?? "chessguru.cc"}`, left, bottom - 20, { width: (right - left) / 2, align: "left" });
  doc.text(`Generated ${new Date().toLocaleString("en-IN")}`, left + (right - left) / 2, bottom - 20, { width: (right - left) / 2, align: "right" });
}

// Simple 2-col metadata row (label · value pairs) laid out on one line.
function renderMetaRow(doc: InstanceType<typeof PDFDocument>, items: Array<{ label: string; value: string }>) {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const usable = right - left;
  const w = usable / items.length;
  const y = doc.y;
  items.forEach((it, i) => {
    const x = left + i * w;
    doc.fillColor(COLORS.subtle).font("Body").fontSize(8).text(it.label.toUpperCase(), x, y);
    doc.fillColor(COLORS.text).font("Body-Bold").fontSize(11).text(it.value, x, y + 12, { width: w - 8 });
  });
  doc.y = y + 32;
  doc.x = left;
}

// ---- invoice PDF ------------------------------------------------------------

export interface BrandingCtx {
  name: string;                          // "Guna Chess Academy"
  tagline?: string;                      // "Batch A · Bengaluru"
  contactLine?: string;                  // "+91 98765 43210 · hello@guna.chess"
  footerLine?: string;                   // "chessguru.cc · GST: 29ABCDE1234F1Z5"
  logoBuffer?: Buffer;                   // optional embedded logo
}

export interface InvoicePdfCtx {
  studentName: string;
  guardianName?: string;
  guardianPhone?: string;
  programName?: string;
}

export function buildInvoicePdf(inv: InvoiceDoc, branding: BrandingCtx, ctx: InvoicePdfCtx): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margins: { top: 40, left: 40, right: 40, bottom: 40 } });
    registerFonts(doc);
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Status pill colour (matches web INVOICE_STATUS_META semantics).
    const balance = Math.max(0, inv.totalPaise - inv.paidPaise);
    const isOverdue = balance > 0 && (inv.status === "SENT" || inv.status === "PARTIAL") && inv.dueOn < new Date();
    const badgeColor =
      inv.status === "PAID"      ? COLORS.accent :
      inv.status === "WAIVED"    ? COLORS.subtle :
      inv.status === "CANCELLED" ? COLORS.subtle :
      isOverdue                  ? "#dc2626"     :
      inv.status === "PARTIAL"   ? COLORS.gold   :
      COLORS.brand;
    const badgeText = isOverdue ? "OVERDUE" : inv.status;

    renderHeader(doc, branding, { label: "Invoice", value: inv.invoiceNo, badge: { text: badgeText, color: badgeColor } });

    // Metadata strip
    renderMetaRow(doc, [
      { label: "For",     value: ctx.studentName },
      { label: "Period",  value: fmtPeriod(inv.periodStart, inv.periodEnd) },
      { label: "Due",     value: fmtDate(inv.dueOn) },
    ]);

    // Parent details
    if (ctx.guardianName || ctx.guardianPhone) {
      doc.fillColor(COLORS.subtle).font("Body").fontSize(9).text("BILL TO", doc.page.margins.left, doc.y);
      doc.fillColor(COLORS.text).font("Body-Bold").fontSize(11).text(ctx.guardianName ?? "(no parent linked)", doc.page.margins.left, doc.y + 2);
      if (ctx.guardianPhone) doc.fillColor(COLORS.subtle).font("Body").fontSize(10).text(ctx.guardianPhone);
      doc.moveDown(0.6);
    }
    if (ctx.programName) {
      doc.fillColor(COLORS.subtle).font("Body").fontSize(9).text(`Program: ${ctx.programName}`);
      doc.moveDown(0.6);
    }

    // ---- Lines table
    doc.moveDown(0.4);
    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const usable = right - left;
    const colDesc = left;
    const colKind = left + usable * 0.55;
    const colAmt  = right - 80;
    const tableTop = doc.y;
    // header
    doc.roundedRect(left, tableTop, usable, 22, 4).fillColor("#f1f5f9").fill();
    doc.fillColor(COLORS.subtle).font("Body-Bold").fontSize(9);
    doc.text("DESCRIPTION", colDesc + 8, tableTop + 7);
    doc.text("KIND",        colKind, tableTop + 7);
    doc.text("AMOUNT",      colAmt, tableTop + 7, { width: 72, align: "right" });
    doc.y = tableTop + 26;

    // rows
    doc.fillColor(COLORS.text).font("Body").fontSize(10);
    for (const l of inv.lines) {
      const y = doc.y;
      doc.text(l.name, colDesc + 8, y, { width: usable * 0.55 - 12 });
      doc.fillColor(COLORS.subtle).font("Body").fontSize(9).text(l.kind.toLowerCase(), colKind, y + 2);
      if (l.gstPct) doc.text(`GST ${l.gstPct}%`, colKind, y + 14);
      doc.fillColor(COLORS.text).font("Body-Bold").fontSize(10).text(fmtRupees(l.amountPaise), colAmt, y, { width: 72, align: "right" });
      doc.font("Body").fillColor(COLORS.text);
      doc.moveDown(0.6);
      // faint divider
      doc.moveTo(left + 8, doc.y).lineTo(right - 8, doc.y).lineWidth(0.4).strokeColor(COLORS.hair).stroke();
      doc.moveDown(0.4);
    }

    // ---- Totals block (right-aligned)
    doc.moveDown(0.4);
    const totalsX = right - 240;
    const totalsW = 240;
    const totalRow = (label: string, value: string, opts?: { bold?: boolean; color?: string; big?: boolean; strong?: boolean }) => {
      const y = doc.y;
      doc.fillColor(opts?.color ?? COLORS.subtle).font(opts?.bold ? "Body-Bold" : "Body").fontSize(opts?.big ? 13 : 10);
      doc.text(label, totalsX, y, { width: totalsW - 100 });
      doc.fillColor(opts?.color ?? (opts?.strong ? COLORS.text : COLORS.text)).font(opts?.bold ? "Body-Bold" : "Body").fontSize(opts?.big ? 13 : 10);
      doc.text(value, totalsX + totalsW - 100, y, { width: 100, align: "right" });
      doc.moveDown(0.6);
    };
    totalRow("Subtotal", fmtRupees(inv.subtotalPaise));
    if (inv.discountPaise > 0) totalRow("Discount", `− ${fmtRupees(inv.discountPaise)}`, { color: COLORS.accent });
    if (inv.taxPaise > 0) totalRow("GST", `+ ${fmtRupees(inv.taxPaise)}`);
    // faint separator above Total
    doc.moveTo(totalsX, doc.y).lineTo(totalsX + totalsW, doc.y).lineWidth(0.5).strokeColor(COLORS.hair).stroke();
    doc.moveDown(0.2);
    totalRow("Total", fmtRupees(inv.totalPaise), { bold: true, big: true });
    if (inv.paidPaise > 0) totalRow("Paid",   `− ${fmtRupees(inv.paidPaise)}`, { color: COLORS.accent, bold: true });
    // Balance highlight
    const balanceColor = balance === 0 ? COLORS.accent : COLORS.gold;
    totalRow("Balance due", fmtRupees(balance), { bold: true, big: true, color: balanceColor, strong: true });

    // ---- Notes
    if (inv.notes) {
      doc.moveDown(0.6);
      doc.fillColor(COLORS.subtle).font("Body-Italic").fontSize(9).text(`Note: ${inv.notes}`, left, doc.y, { width: usable });
    }

    // ---- Payment nudge if unpaid
    if (balance > 0 && inv.status !== "CANCELLED" && inv.status !== "WAIVED") {
      doc.moveDown(1.2);
      const nudgeY = doc.y;
      doc.roundedRect(left, nudgeY, usable, 44, 6).fillColor("#eef2ff").fill();
      doc.fillColor(COLORS.brand).font("Body-Bold").fontSize(11).text("Pay by " + fmtDate(inv.dueOn), left + 12, nudgeY + 8);
      doc.fillColor(COLORS.text).font("Body").fontSize(9).text("Reply PAY on WhatsApp or visit the parent portal — link comes with the reminder.", left + 12, nudgeY + 26);
      doc.y = nudgeY + 44;
    }

    renderFooter(doc, branding);
    doc.end();
  });
}

// ---- receipt PDF ------------------------------------------------------------

export interface ReceiptPdfCtx {
  guardianName?: string;
  guardianPhone?: string;
  invoiceLookup: Map<string, { invoiceNo: string; studentName?: string; programName?: string; periodLabel?: string }>;
}

export function buildReceiptPdf(payment: PaymentDoc, allocs: PaymentAllocationDoc[], branding: BrandingCtx, ctx: ReceiptPdfCtx): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margins: { top: 40, left: 40, right: 40, bottom: 40 } });
    registerFonts(doc);
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    renderHeader(doc, branding, {
      label: "Receipt",
      value: payment.receiptNo,
      badge: { text: "PAID", color: COLORS.accent },
    });

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const usable = right - left;

    renderMetaRow(doc, [
      { label: "Received on", value: fmtDate(payment.capturedAt ?? payment.createdAt) },
      { label: "Method",      value: payment.method },
      { label: "Amount",      value: fmtRupees(payment.amountPaise) },
    ]);

    if (ctx.guardianName || ctx.guardianPhone) {
      doc.fillColor(COLORS.subtle).font("Body").fontSize(9).text("RECEIVED FROM", left, doc.y);
      doc.fillColor(COLORS.text).font("Body-Bold").fontSize(11).text(ctx.guardianName ?? "(unlinked)", left, doc.y + 2);
      if (ctx.guardianPhone) doc.fillColor(COLORS.subtle).font("Body").fontSize(10).text(ctx.guardianPhone);
      doc.moveDown(0.6);
    }

    // Allocations table — every allocation is one row = money lineage.
    doc.moveDown(0.4);
    const tableTop = doc.y;
    doc.roundedRect(left, tableTop, usable, 22, 4).fillColor("#f1f5f9").fill();
    doc.fillColor(COLORS.subtle).font("Body-Bold").fontSize(9);
    doc.text("APPLIED TO", left + 8, tableTop + 7);
    doc.text("PERIOD",     left + usable * 0.55, tableTop + 7);
    doc.text("AMOUNT",     right - 88, tableTop + 7, { width: 80, align: "right" });
    doc.y = tableTop + 26;

    let totalApplied = 0;
    for (const a of allocs) {
      const meta = ctx.invoiceLookup.get(a.invoiceId);
      const y = doc.y;
      doc.fillColor(COLORS.text).font("Body-Bold").fontSize(10).text(meta?.invoiceNo ?? a.invoiceId.slice(-6), left + 8, y);
      doc.fillColor(COLORS.subtle).font("Body").fontSize(9).text(meta?.studentName ?? "—", left + 8, y + 14);
      doc.fillColor(COLORS.subtle).font("Body").fontSize(10).text(meta?.periodLabel ?? "", left + usable * 0.55, y + 2);
      doc.fillColor(COLORS.text).font("Body-Bold").fontSize(10).text(fmtRupees(a.amountPaise), right - 88, y, { width: 80, align: "right" });
      totalApplied += a.amountPaise;
      doc.moveDown(1.2);
      doc.moveTo(left + 8, doc.y).lineTo(right - 8, doc.y).lineWidth(0.4).strokeColor(COLORS.hair).stroke();
      doc.moveDown(0.4);
    }

    // Totals
    doc.moveDown(0.4);
    const totalsX = right - 220;
    const totalsW = 220;
    const line = (label: string, value: string, big = false, color: string = COLORS.text, bold = false) => {
      const y = doc.y;
      doc.fillColor(color).font(bold ? "Body-Bold" : "Body").fontSize(big ? 13 : 10);
      doc.text(label, totalsX, y, { width: totalsW - 100 });
      doc.text(value, totalsX + totalsW - 100, y, { width: 100, align: "right" });
      doc.moveDown(0.6);
    };
    line("Total received", fmtRupees(payment.amountPaise), true, COLORS.text, true);
    line("Applied", fmtRupees(totalApplied), false, COLORS.accent);
    const leftover = payment.amountPaise - totalApplied;
    if (leftover > 0) line("Wallet credit", fmtRupees(leftover), false, COLORS.brand);

    if (payment.note) {
      doc.moveDown(0.6);
      doc.fillColor(COLORS.subtle).font("Body-Italic").fontSize(9).text(`Note: ${payment.note}`, left, doc.y, { width: usable });
    }

    // Thank-you strip (soft green, cheerful)
    doc.moveDown(1.4);
    const thankY = doc.y;
    doc.roundedRect(left, thankY, usable, 44, 6).fillColor("#ecfdf5").fill();
    doc.fillColor(COLORS.accent).font("Body-Bold").fontSize(12).text("Thank you!", left + 12, thankY + 8);
    doc.fillColor(COLORS.text).font("Body").fontSize(9).text("This receipt is a valid acknowledgement of payment. Keep it for your records.", left + 12, thankY + 26);
    doc.y = thankY + 44;

    renderFooter(doc, branding);
    doc.end();
  });
}
