// Fees → Invoices (W2b)
//
// Filterable table of every invoice in the academy, with a right-hand drawer
// that shows lines + payments + Mark Cash Paid + Waive/Cancel. Row hover
// reveals the fastest action (📞 remind next week, 💵 mark paid) but the
// drawer is the workhorse for detail.
//
// Design principles per plan §DesignPrinciples: all 4 states, i18n-keyed
// strings, ≥ 44px touch targets, Intl currency, undoable-via-drawer.

import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  INVOICE_STATUS_META,
  type InvoiceResponse,
  type InvoiceStatus,
  type PaymentResponse,
  type RecordManualPaymentInput,
  feesApi,
  fmtRupees,
  parseRupeesInput,
} from "../lib/fees-api";

const t = (s: string) => s;

const STATUS_TABS: Array<{ key: InvoiceStatus | "ALL" | "OPEN"; label: string; hint?: string }> = [
  { key: "ALL",       label: "All" },
  { key: "OPEN",      label: "Open",       hint: "sent + partial + overdue" },
  { key: "OVERDUE",   label: "Overdue" },
  { key: "PAID",      label: "Paid" },
  { key: "WAIVED",    label: "Waived" },
  { key: "CANCELLED", label: "Cancelled" },
];

export default function FeesInvoicesPage() {
  const [sp, setSp] = useSearchParams();
  const activeTab = (sp.get("tab") ?? "OPEN") as (InvoiceStatus | "ALL" | "OPEN");
  const activeInvoiceId = sp.get("id") ?? null;
  const programId = sp.get("programId") ?? undefined;

  const listQ = useQuery({
    queryKey: ["fees.invoices", { tab: activeTab, programId }],
    queryFn: () => {
      if (activeTab === "ALL") return feesApi.listInvoices({ programId });
      if (activeTab === "OPEN") {
        // OPEN = SENT + PARTIAL + OVERDUE. Server can't filter with $in without
        // extra plumbing this slice — fetch broadly + filter client-side. Bounded
        // by the 500-row server cap so this is safe for MVP scale.
        return feesApi.listInvoices({ programId })
          .then((r) => ({ invoices: r.invoices.filter((i) => i.status === "SENT" || i.status === "PARTIAL" || i.status === "OVERDUE") }));
      }
      return feesApi.listInvoices({ status: activeTab, programId });
    },
  });

  const invoices = listQ.data?.invoices ?? [];

  function setTab(next: (InvoiceStatus | "ALL" | "OPEN")) {
    const n = new URLSearchParams(sp);
    n.set("tab", next);
    n.delete("id");
    setSp(n, { replace: true });
  }
  function openInvoice(id: string) {
    const n = new URLSearchParams(sp);
    n.set("id", id);
    setSp(n, { replace: true });
  }
  function closeDrawer() {
    const n = new URLSearchParams(sp);
    n.delete("id");
    setSp(n, { replace: true });
  }

  const totals = useMemo(() => {
    return invoices.reduce(
      (acc, i) => {
        acc.count++;
        acc.total += i.totalPaise;
        acc.balance += i.balancePaise;
        acc.paid += i.paidPaise;
        return acc;
      },
      { count: 0, total: 0, balance: 0, paid: 0 },
    );
  }, [invoices]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="mb-2 flex items-center gap-2 text-xs">
        <Link to="/fees" className="text-ink-300 hover:text-white">← {t("Fees")}</Link>
        <span className="text-ink-500">/</span>
        <span className="text-ink-300">{t("Invoices")}</span>
      </div>

      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-1">
            <span className="rounded-full bg-brand-500/15 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-brand-300 ring-1 ring-brand-400/30">{t("Beta · W2")}</span>
          </div>
          <h1 className="font-display text-3xl text-ink-100 sm:text-4xl">{t("Invoices")}</h1>
          <p className="mt-1 max-w-lg text-sm text-ink-300">{t("Every bill, every payment, every balance — filter, tap to open, mark cash paid.")}</p>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <StatChip label={t("Bills")}     value={String(totals.count)}                accent="brand" />
          <StatChip label={t("Total")}     value={fmtRupees(totals.total)}             accent="gold" />
          <StatChip label={t("Balance")}   value={fmtRupees(totals.balance)}           accent={totals.balance > 0 ? "gold" : "accent"} />
        </div>
      </header>

      {/* Tab bar */}
      <div className="mb-4 flex flex-wrap gap-1 rounded-2xl border border-ink-700 bg-ink-900/60 p-1">
        {STATUS_TABS.map((tab) => {
          const on = tab.key === activeTab;
          return (
            <button
              key={tab.key}
              onClick={() => setTab(tab.key)}
              title={tab.hint}
              className={`h-9 rounded-xl px-3 text-xs font-semibold transition ${on ? "bg-brand-500/20 text-brand-200 shadow-glow" : "text-ink-300 hover:bg-ink-800 hover:text-white"}`}
            >
              {t(tab.label)}
            </button>
          );
        })}
      </div>

      {/* States */}
      {listQ.isLoading && <TableSkeleton />}
      {listQ.isError && <ErrorCard message={listQ.error instanceof Error ? listQ.error.message : t("Couldn't load invoices.")} onRetry={() => listQ.refetch()} />}
      {!listQ.isLoading && !listQ.isError && invoices.length === 0 && <EmptyState tab={activeTab} />}
      {!listQ.isLoading && !listQ.isError && invoices.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-ink-700 bg-ink-900/60">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-ink-400 bg-ink-900/40">
                  <th className="px-4 py-3 font-medium">{t("Invoice")}</th>
                  <th className="px-4 py-3 font-medium">{t("Student · Parent")}</th>
                  <th className="px-4 py-3 font-medium">{t("Period")}</th>
                  <th className="px-4 py-3 font-medium">{t("Due")}</th>
                  <th className="px-4 py-3 font-medium text-right">{t("Total")}</th>
                  <th className="px-4 py-3 font-medium text-right">{t("Balance")}</th>
                  <th className="px-4 py-3 font-medium">{t("Status")}</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((i) => (
                  <InvoiceRow key={i.id} inv={i} active={i.id === activeInvoiceId} onOpen={() => openInvoice(i.id)} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeInvoiceId && <InvoiceDrawer id={activeInvoiceId} onClose={closeDrawer} />}
    </div>
  );
}

// ---- Row ----------------------------------------------------------------

function InvoiceRow({ inv, active, onOpen }: { inv: InvoiceResponse; active: boolean; onOpen: () => void }) {
  const meta = INVOICE_STATUS_META[inv.status];
  const overdue = (inv.status === "SENT" || inv.status === "PARTIAL") && new Date(inv.dueOn) < new Date();
  return (
    <tr
      onClick={onOpen}
      className={`cursor-pointer border-t border-ink-800 text-ink-100 transition hover:bg-ink-800/40 ${active ? "bg-brand-500/5" : ""}`}
    >
      <td className="px-4 py-3">
        <div className="font-medium tabular-nums">{inv.invoiceNo}</div>
        <div className="text-[11px] text-ink-400">{inv.programName ?? "—"}</div>
      </td>
      <td className="px-4 py-3">
        <div className="font-medium">{inv.studentName ?? <span className="text-ink-500">(unknown)</span>}</div>
        <div className="text-[11px] text-ink-400">{inv.guardianName ?? <span className="text-ink-500">no parent</span>}{inv.guardianPhone ? ` · ${inv.guardianPhone}` : ""}</div>
      </td>
      <td className="px-4 py-3 text-ink-300">{fmtPeriod(inv.periodStart, inv.periodEnd)}</td>
      <td className="px-4 py-3 text-ink-300">
        {new Date(inv.dueOn).toLocaleDateString()}
        {overdue && <span className="ml-1 text-red-300">·{t("late")}</span>}
      </td>
      <td className="px-4 py-3 text-right font-display text-lg text-ink-100">{fmtRupees(inv.totalPaise)}</td>
      <td className={`px-4 py-3 text-right font-display text-lg ${inv.balancePaise > 0 ? "text-gold-400" : "text-accent-400"}`}>{fmtRupees(inv.balancePaise)}</td>
      <td className="px-4 py-3">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${overdue ? INVOICE_STATUS_META.OVERDUE.ring : meta.ring}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${overdue ? INVOICE_STATUS_META.OVERDUE.dot : meta.dot}`} />
          {overdue ? INVOICE_STATUS_META.OVERDUE.label : meta.label}
        </span>
      </td>
    </tr>
  );
}

// ---- Drawer -------------------------------------------------------------

function InvoiceDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["fees.invoice", id],
    queryFn: () => feesApi.getInvoice(id),
  });

  const [payOpen, setPayOpen] = useState(false);

  return (
    <div className="fixed inset-0 z-40 flex" role="dialog" aria-modal>
      <button aria-label="close" onClick={onClose} className="flex-1 bg-black/50 backdrop-blur-sm" />
      <aside className="ml-auto flex h-full w-full max-w-lg flex-col overflow-y-auto border-l border-ink-700 bg-ink-950 shadow-2xl">
        <div className="flex items-center gap-2 border-b border-ink-800 px-5 py-4">
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg bg-ink-800 text-ink-300 hover:bg-ink-700">←</button>
          <div className="min-w-0 flex-1 truncate">
            <div className="text-xs uppercase tracking-wider text-ink-400">{t("Invoice")}</div>
            <div className="truncate font-medium text-ink-100">{data?.invoice.invoiceNo ?? "…"}</div>
          </div>
          {data?.invoice && <StatusPill status={data.invoice.status} overdue={(data.invoice.status === "SENT" || data.invoice.status === "PARTIAL") && new Date(data.invoice.dueOn) < new Date()} />}
        </div>

        <div className="flex-1 p-5">
          {isLoading && <div className="py-8 text-center text-sm text-ink-400">{t("Loading…")}</div>}
          {isError && <ErrorCard message={error instanceof Error ? error.message : t("Couldn't load invoice.")} onRetry={() => refetch()} />}
          {data && (
            <>
              {/* Student + Guardian */}
              <section className="mb-4 rounded-xl border border-ink-800 bg-ink-900/40 p-3">
                <div className="text-[11px] uppercase tracking-wider text-ink-400">{t("For")}</div>
                <div className="mt-0.5 font-semibold text-ink-100">{data.invoice.studentName ?? "—"}</div>
                <div className="text-xs text-ink-300">
                  {data.invoice.guardianName ?? <span className="text-ink-500">{t("(no parent linked)")}</span>}
                  {data.invoice.guardianPhone ? ` · 📞 ${data.invoice.guardianPhone}` : ""}
                </div>
              </section>

              {/* Period */}
              <div className="mb-4 grid grid-cols-2 gap-3">
                <MetaChip label={t("Period")} value={fmtPeriod(data.invoice.periodStart, data.invoice.periodEnd)} />
                <MetaChip label={t("Due")}    value={new Date(data.invoice.dueOn).toLocaleDateString()} />
              </div>

              {/* Lines */}
              <section className="mb-4 rounded-xl border border-ink-800 bg-ink-900/40">
                <div className="border-b border-ink-800 px-3 py-2 text-[11px] uppercase tracking-wider text-ink-400">{t("Lines")}</div>
                <ul>
                  {data.invoice.lines.map((l, i) => (
                    <li key={i} className="flex items-center justify-between border-b border-ink-800 px-3 py-2 last:border-none">
                      <div>
                        <div className="text-sm text-ink-100">{l.name}</div>
                        <div className="text-[11px] uppercase tracking-wider text-ink-400">{l.kind.toLowerCase()}{l.gstPct ? ` · GST ${l.gstPct}%` : ""}</div>
                      </div>
                      <div className="tabular-nums text-ink-100">{fmtRupees(l.amountPaise)}</div>
                    </li>
                  ))}
                </ul>
                <div className="border-t border-ink-800 px-3 py-2 text-sm">
                  <div className="flex justify-between text-ink-400"><span>{t("Subtotal")}</span><span className="tabular-nums text-ink-200">{fmtRupees(data.invoice.subtotalPaise)}</span></div>
                  {data.invoice.discountPaise > 0 && <div className="flex justify-between text-ink-400"><span>{t("Discount")}</span><span className="tabular-nums text-accent-400">− {fmtRupees(data.invoice.discountPaise)}</span></div>}
                  {data.invoice.taxPaise > 0 && <div className="flex justify-between text-ink-400"><span>{t("GST")}</span><span className="tabular-nums text-ink-200">+ {fmtRupees(data.invoice.taxPaise)}</span></div>}
                  <div className="mt-1 flex justify-between border-t border-ink-800 pt-1"><span className="font-semibold text-ink-100">{t("Total")}</span><span className="font-display text-lg text-ink-100 tabular-nums">{fmtRupees(data.invoice.totalPaise)}</span></div>
                  <div className="flex justify-between text-ink-400"><span>{t("Paid")}</span><span className="tabular-nums text-accent-400">{fmtRupees(data.invoice.paidPaise)}</span></div>
                  <div className="flex justify-between"><span className="font-semibold text-ink-100">{t("Balance")}</span><span className={`font-display text-lg tabular-nums ${data.invoice.balancePaise > 0 ? "text-gold-400" : "text-accent-400"}`}>{fmtRupees(data.invoice.balancePaise)}</span></div>
                </div>
              </section>

              {/* Payments */}
              <section className="mb-4 rounded-xl border border-ink-800 bg-ink-900/40">
                <div className="border-b border-ink-800 px-3 py-2 text-[11px] uppercase tracking-wider text-ink-400">{t("Payments")}</div>
                {data.payments.length === 0 ? (
                  <div className="px-3 py-6 text-center text-xs text-ink-400">{t("No payments yet.")}</div>
                ) : (
                  <ul>
                    {data.payments.map((p) => <PaymentLine key={p.id} p={p} />)}
                  </ul>
                )}
              </section>

              {data.invoice.waivedReason && (
                <section className="mb-4 rounded-xl border border-ink-800 bg-ink-900/40 p-3">
                  <div className="text-[11px] uppercase tracking-wider text-ink-400">{t("Waived reason")}</div>
                  <div className="mt-0.5 text-sm text-ink-200">{data.invoice.waivedReason}</div>
                </section>
              )}

              {/* Actions */}
              {data.invoice.status !== "CANCELLED" && data.invoice.status !== "WAIVED" && data.invoice.balancePaise > 0 && (
                <button onClick={() => setPayOpen(true)} className="mb-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-accent-500 to-accent-400 text-sm font-semibold text-ink-950 shadow-glow transition hover:brightness-105">
                  💵 {t("Mark cash / bank payment")}
                </button>
              )}
              <div className="mb-2 flex gap-2">
                <a
                  href={feesApi.invoicePdfUrl(data.invoice.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl border border-brand-500/50 bg-brand-500/10 text-sm font-semibold text-brand-200 transition hover:bg-brand-500/20"
                >
                  📄 {t("Download PDF")}
                </a>
              </div>
              <div className="flex gap-2">
                {data.invoice.status !== "CANCELLED" && data.invoice.status !== "WAIVED" && (
                  <WaiveButton id={data.invoice.id} onDone={() => { qc.invalidateQueries({ queryKey: ["fees.invoice", id] }); qc.invalidateQueries({ queryKey: ["fees.invoices"] }); }} />
                )}
                {data.invoice.status !== "CANCELLED" && data.invoice.paidPaise === 0 && (
                  <CancelButton id={data.invoice.id} onDone={() => { qc.invalidateQueries({ queryKey: ["fees.invoice", id] }); qc.invalidateQueries({ queryKey: ["fees.invoices"] }); }} />
                )}
              </div>
            </>
          )}
        </div>
        {payOpen && data?.invoice && (
          <RecordPaymentModal
            invoice={data.invoice}
            onClose={() => setPayOpen(false)}
            onDone={() => { setPayOpen(false); qc.invalidateQueries({ queryKey: ["fees.invoice", id] }); qc.invalidateQueries({ queryKey: ["fees.invoices"] }); }}
          />
        )}
      </aside>
    </div>
  );
}

function PaymentLine({ p }: { p: PaymentResponse }) {
  return (
    <li className="flex items-start justify-between gap-3 border-b border-ink-800 px-3 py-2 last:border-none">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-ink-100 tabular-nums">{fmtRupees(p.amountPaise)}</div>
        <div className="text-[11px] uppercase tracking-wider text-ink-400">
          {p.method}
          {p.capturedAt ? ` · ${new Date(p.capturedAt).toLocaleDateString()}` : ""}
          {p.pgProvider !== "manual" ? ` · ${p.pgProvider}` : ""}
        </div>
        <div className="text-[11px] text-ink-500">{p.receiptNo}</div>
        {p.note && <div className="mt-0.5 text-xs text-ink-300">{p.note}</div>}
      </div>
      <div className="flex flex-col items-end gap-1">
        <a
          href={feesApi.receiptPdfUrl(p.id)}
          target="_blank"
          rel="noreferrer"
          title={t("Download receipt PDF")}
          className="inline-flex h-7 items-center gap-1 rounded-lg border border-accent-500/40 bg-accent-500/10 px-2 text-[11px] font-semibold text-accent-300 hover:bg-accent-500/20"
        >
          📄 {t("Receipt")}
        </a>
        <div className="text-right text-[11px] text-ink-400">
          {p.allocations.map((a, i) => <div key={i}>→ {a.invoiceNo ?? a.invoiceId.slice(-6)}: {fmtRupees(a.amountPaise)}</div>)}
        </div>
      </div>
    </li>
  );
}

// ---- Record payment modal -----------------------------------------------

function RecordPaymentModal({ invoice, onClose, onDone }: { invoice: InvoiceResponse; onClose: () => void; onDone: () => void }) {
  const [method, setMethod] = useState<"CASH" | "BANK" | "UPI">("CASH");
  const [amountRupees, setAmountRupees] = useState<string>(String(invoice.balancePaise / 100));
  const [note, setNote] = useState("");
  const [capturedOn, setCapturedOn] = useState<string>(todayISO());
  const [err, setErr] = useState<string | null>(null);

  const rec = useMutation({
    mutationFn: (b: RecordManualPaymentInput) => feesApi.recordManualPayment(b),
    onSuccess: () => onDone(),
    onError: (e) => setErr(e instanceof Error ? e.message : t("Couldn't record payment.")),
  });

  function submit() {
    setErr(null);
    const paise = parseRupeesInput(amountRupees);
    if (paise === null || paise < 100) { setErr(t("Enter a valid amount (≥ ₹1).")); return; }
    rec.mutate({ invoiceIds: [invoice.id], amountPaise: paise, method, capturedOn, note: note.trim() || undefined });
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-ink-700 bg-ink-950 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4">
          <h2 className="font-display text-xl text-ink-100">{t("Record payment")}</h2>
          <p className="mt-1 text-sm text-ink-400">{t("For invoice")} <span className="tabular-nums text-ink-200">{invoice.invoiceNo}</span></p>
        </div>

        <div className="mb-3 grid grid-cols-3 gap-2">
          {(["CASH", "BANK", "UPI"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMethod(m)}
              className={`flex items-center justify-center gap-1 rounded-xl border py-3 text-sm font-semibold transition ${method === m ? "border-accent-500 bg-accent-500/10 text-accent-400 shadow-glow" : "border-ink-700 bg-ink-900 text-ink-200 hover:border-ink-600"}`}
            >
              {m === "CASH" ? "💵" : m === "BANK" ? "🏦" : "📱"} {m}
            </button>
          ))}
        </div>

        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-ink-300">{t("Amount")}</span>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-4 grid place-items-center text-ink-400">₹</span>
            <input
              value={amountRupees}
              onChange={(e) => setAmountRupees(e.target.value.replace(/[^\d.,]/g, ""))}
              inputMode="decimal"
              className="h-12 w-full rounded-xl border border-ink-700 bg-ink-900 pl-8 pr-4 font-display text-xl text-ink-100 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />
          </div>
          <div className="mt-1 flex items-center justify-between text-[11px] text-ink-500">
            <span>{t("Balance")}: {fmtRupees(invoice.balancePaise)}</span>
            <button type="button" onClick={() => setAmountRupees(String(invoice.balancePaise / 100))} className="text-brand-300 hover:text-brand-200">{t("Full balance")}</button>
          </div>
        </label>

        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-ink-300">{t("Captured on")}</span>
          <input type="date" value={capturedOn} onChange={(e) => setCapturedOn(e.target.value)} className="h-11 w-full rounded-xl border border-ink-700 bg-ink-900 px-4 text-sm text-ink-100 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
        </label>

        <label className="mb-4 block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-ink-300">{t("Note")} <span className="normal-case text-ink-500">({t("optional")})</span></span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("e.g. Cheque #12345, cash from Aarav's mum")} maxLength={200} className="h-11 w-full rounded-xl border border-ink-700 bg-ink-900 px-4 text-sm text-ink-100 placeholder:text-ink-500 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
        </label>

        {err && <div role="alert" className="mb-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{err}</div>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="h-11 rounded-xl px-4 text-sm font-semibold text-ink-300 hover:bg-ink-800">{t("Cancel")}</button>
          <button onClick={submit} disabled={rec.isPending} className="inline-flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-accent-500 to-accent-400 px-5 text-sm font-semibold text-ink-950 shadow-glow transition hover:brightness-105 disabled:opacity-60">
            {rec.isPending ? t("Recording…") : t("Record payment")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Waive + Cancel buttons ---------------------------------------------

function WaiveButton({ id, onDone }: { id: string; onDone: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const waive = useMutation({
    mutationFn: (reason: string) => feesApi.waiveInvoice(id, reason),
    onSuccess: () => onDone(),
    onError: (e) => setErr(e instanceof Error ? e.message : "err"),
  });
  return (
    <>
      <button
        onClick={() => {
          const reason = prompt(t("Reason for waiving this invoice?"));
          if (reason && reason.trim()) waive.mutate(reason.trim());
        }}
        disabled={waive.isPending}
        className="h-10 flex-1 rounded-xl border border-ink-700 bg-ink-900 text-sm font-semibold text-ink-200 hover:border-gold-400/60 hover:text-gold-300 disabled:opacity-50"
      >
        {t("Waive")}
      </button>
      {err && <div role="alert" className="mt-2 text-xs text-red-300">{err}</div>}
    </>
  );
}
function CancelButton({ id, onDone }: { id: string; onDone: () => void }) {
  const cancel = useMutation({
    mutationFn: () => feesApi.cancelInvoice(id),
    onSuccess: () => onDone(),
  });
  return (
    <button
      onClick={() => { if (confirm(t("Cancel this invoice? It will disappear from the ledger."))) cancel.mutate(); }}
      disabled={cancel.isPending}
      className="h-10 flex-1 rounded-xl border border-ink-700 bg-ink-900 text-sm font-semibold text-ink-200 hover:border-red-400/60 hover:text-red-300 disabled:opacity-50"
    >
      {t("Cancel")}
    </button>
  );
}

// ---- Small shared bits ---------------------------------------------------

function StatChip({ label, value, accent }: { label: string; value: string; accent: "brand" | "gold" | "accent" }) {
  const ring = accent === "brand" ? "from-brand-600/40 via-brand-500/10" : accent === "gold" ? "from-gold-500/40 via-gold-500/10" : "from-accent-500/40 via-accent-500/10";
  return (
    <div className="relative overflow-hidden rounded-xl border border-ink-700 bg-ink-900/60 px-3 py-2">
      <div className={`pointer-events-none absolute -right-4 -top-4 h-16 w-16 rounded-full bg-gradient-to-br ${ring} to-transparent blur-lg`} />
      <div className="text-[10px] uppercase tracking-wider text-ink-400">{label}</div>
      <div className="font-display text-lg text-ink-100">{value}</div>
    </div>
  );
}
function MetaChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-ink-800 bg-ink-900/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-ink-400">{label}</div>
      <div className="text-sm text-ink-100">{value}</div>
    </div>
  );
}
function StatusPill({ status, overdue }: { status: InvoiceStatus; overdue: boolean }) {
  const meta = overdue ? INVOICE_STATUS_META.OVERDUE : INVOICE_STATUS_META[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${meta.ring}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}
function TableSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-ink-700 bg-ink-900/60 p-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-ink-800 py-3 last:border-none">
          <div className="h-4 w-24 rounded bg-ink-700" />
          <div className="h-4 w-40 rounded bg-ink-700" />
          <div className="ml-auto h-4 w-20 rounded bg-ink-800" />
        </div>
      ))}
    </div>
  );
}
function EmptyState({ tab }: { tab: string }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center justify-center rounded-2xl border border-dashed border-ink-700 bg-ink-900/40 px-6 py-14 text-center">
      <div className="mb-3 text-4xl" aria-hidden>🧾</div>
      <h3 className="font-display text-xl text-ink-100">{t("No invoices")}</h3>
      <p className="mt-2 max-w-sm text-sm text-ink-400">
        {tab === "PAID" ? t("Nothing paid yet in this window.") :
         tab === "OVERDUE" ? t("Everything is on time. Nice work.") :
         t("Open a program and hit Generate to create this period's invoices.")}
      </p>
      <Link to="/fees/programs" className="mt-4 inline-flex h-10 items-center rounded-xl bg-brand-500/20 px-4 text-xs font-semibold text-brand-200 hover:bg-brand-500/30">
        {t("→ Programs")}
      </Link>
    </div>
  );
}
function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-6 text-center">
      <div className="mb-2 text-3xl">😬</div>
      <h3 className="text-lg font-semibold text-ink-100">{message}</h3>
      <button onClick={onRetry} className="mt-4 h-10 rounded-xl border border-red-500/50 bg-red-500/10 px-4 text-sm font-semibold text-red-200 hover:bg-red-500/20">{t("Retry")}</button>
    </div>
  );
}

function fmtPeriod(startISO: string, endISO: string): string {
  const s = new Date(startISO);
  const e = new Date(endISO);
  // Same month → "September 2026". Different months → "Sep 1 – Oct 15".
  if (s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth()) {
    return s.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }
  return `${s.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${e.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
