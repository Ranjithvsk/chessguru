// Parent portal — /pay/:token?g=<guardianUserId>&a=<academyId>
//
// Public page. Magic-link auth via the token in the URL. The server verifies
// HMAC(academyId, guardianUserId) === token and returns invoice list + Razorpay
// key metadata. Parent taps invoices, hits Pay → Razorpay Checkout opens →
// on success the parent lands on the success screen; the server-side webhook
// records the payment authoritatively regardless of client state.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { fmtRupees, portalApi, type CheckoutOrderResponse, type PortalInvoiceLine, type PortalResponse } from "../../lib/fees-api";

// The Razorpay Checkout SDK loads globally as `window.Razorpay`. We hydrate
// it lazily so first paint doesn't wait for a 200 KB script that many
// visitors never need (they might be checking history, not paying).
declare global {
  interface Window { Razorpay?: any }  // eslint-disable-line @typescript-eslint/no-explicit-any
}

const RZP_SCRIPT_URL = "https://checkout.razorpay.com/v1/checkout.js";

async function loadRazorpay(): Promise<void> {
  if (typeof window === "undefined") return;
  if (window.Razorpay) return;
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = RZP_SCRIPT_URL; s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Couldn't load Razorpay. Check your connection and try again."));
    document.head.appendChild(s);
  });
}

export default function ParentPortalPage() {
  const { token = "" } = useParams<{ token: string }>();
  const [sp] = useSearchParams();
  const g = sp.get("g") ?? "";
  const a = sp.get("a") ?? "";

  const [data, setData] = useState<PortalResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [payBusy, setPayBusy] = useState(false);
  const [successPayId, setSuccessPayId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await portalApi.view(token, g, a);
      setData(r);
      // Auto-select unpaid invoices — most parents will pay everything.
      const open = new Set(r.invoices.filter((i) => i.balancePaise > 0).map((i) => i.id));
      setPicked(open);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't load your invoices."); }
    finally { setLoading(false); }
  }, [token, g, a]);

  useEffect(() => { void refresh(); }, [refresh]);

  const totals = useMemo(() => {
    if (!data) return { picked: 0, paidBalance: 0, allBalance: 0 };
    const pickedTotal = data.invoices.filter((i) => picked.has(i.id)).reduce((s, i) => s + i.balancePaise, 0);
    return { picked: pickedTotal, paidBalance: data.totalOutstandingPaise - pickedTotal, allBalance: data.totalOutstandingPaise };
  }, [data, picked]);

  function toggle(id: string) {
    setPicked((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function payNow() {
    if (!data || totals.picked <= 0) return;
    setPayBusy(true); setErr(null);
    try {
      await loadRazorpay();
      const invoiceIds = data.invoices
        .filter((i) => picked.has(i.id) && i.balancePaise > 0)
        .sort((x, y) => new Date(x.dueOn).getTime() - new Date(y.dueOn).getTime())
        .map((i) => i.id);
      const order: CheckoutOrderResponse = await portalApi.checkout(token, g, a, invoiceIds);
      openRzpCheckout(order, {
        onDismiss: () => setPayBusy(false),
        onSuccess: (rzpResp) => {
          setPayBusy(false);
          setSuccessPayId(rzpResp.razorpay_payment_id);
          // Give the webhook a couple seconds to record + allocate, then
          // refetch so balances flip.
          setTimeout(() => { void refresh(); }, 3500);
        },
        onFail: (msg) => { setPayBusy(false); setErr(msg); },
      });
    } catch (e) {
      setPayBusy(false);
      setErr(e instanceof Error ? e.message : "Couldn't start checkout.");
    }
  }

  // ---- render ---------------------------------------------------------

  if (loading) return <ShellCentered><Spinner /></ShellCentered>;
  if (err && !data) return <ShellCentered><ErrorCard title="Couldn't open your portal" msg={err} /></ShellCentered>;
  if (!data) return null;

  if (successPayId) return <SuccessCard academyName={data.academyName} paymentId={successPayId} onView={() => setSuccessPayId(null)} />;

  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-50 via-white to-brand-50 text-slate-800">
      <header className="mx-auto max-w-xl px-4 pt-8 pb-4">
        <div className="rounded-3xl bg-white px-6 py-5 shadow-lg ring-1 ring-slate-200">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-brand-600">{data.academyName}</div>
          <h1 className="mt-1 font-display text-2xl text-slate-900">Hi {data.guardianName}!</h1>
          <p className="mt-1 text-sm text-slate-500">Here's what's due for your student{data.invoices.length !== 1 ? "s" : ""}. Tap invoices to select, then pay in one go.</p>
        </div>
      </header>

      <main className="mx-auto max-w-xl px-4 pb-40">
        {err && <div role="alert" className="mb-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}

        {data.invoices.length === 0 ? (
          <EmptyState academyName={data.academyName} />
        ) : (
          <ul className="space-y-3">
            {data.invoices.map((i) => <InvoiceRow key={i.id} inv={i} checked={picked.has(i.id)} onToggle={() => toggle(i.id)} />)}
          </ul>
        )}
      </main>

      {data.invoices.some((i) => i.balancePaise > 0) && (
        <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
          <div className="mx-auto flex max-w-xl items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Selected</div>
              <div className="font-display text-2xl text-slate-900 tabular-nums">{fmtRupees(totals.picked)}</div>
            </div>
            {data.razorpayAvailable ? (
              <button
                onClick={payNow}
                disabled={payBusy || totals.picked <= 0}
                className="inline-flex h-12 min-w-[140px] items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-600 to-emerald-500 px-6 text-sm font-bold text-white shadow-lg transition hover:brightness-105 disabled:opacity-50"
              >
                {payBusy ? "Opening…" : "Pay now →"}
              </button>
            ) : (
              <div className="text-xs text-slate-500 text-right">Online payment isn't set up yet.<br/>Please pay the academy directly.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Invoice row ---------------------------------------------------------

function InvoiceRow({ inv, checked, onToggle }: { inv: PortalInvoiceLine; checked: boolean; onToggle: () => void }) {
  const isPaid = inv.balancePaise <= 0;
  const chipColor = isPaid ? "bg-emerald-100 text-emerald-800" : inv.overdue ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800";
  const chipLabel = isPaid ? "paid" : inv.overdue ? "overdue" : "due";
  return (
    <li
      onClick={() => !isPaid && onToggle()}
      className={`rounded-3xl border ${checked && !isPaid ? "border-emerald-400 bg-emerald-50 shadow-md" : "border-slate-200 bg-white"} ${isPaid ? "opacity-70" : "cursor-pointer active:scale-[0.995] transition"} px-5 py-4`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${chipColor}`}>{chipLabel}</span>
            <span className="truncate text-xs text-slate-500">{inv.periodLabel}</span>
          </div>
          <div className="mt-1 font-semibold text-slate-900">{inv.studentName ?? "—"}</div>
          {inv.programName && <div className="text-xs text-slate-500">{inv.programName}</div>}
          <div className="mt-1 font-mono text-[11px] text-slate-400">{inv.invoiceNo}</div>
        </div>
        <div className="text-right">
          <div className={`font-display text-xl tabular-nums ${isPaid ? "text-slate-400 line-through" : "text-slate-900"}`}>
            {fmtRupees(isPaid ? inv.totalPaise : inv.balancePaise)}
          </div>
          {!isPaid && inv.paidPaise > 0 && <div className="text-[10px] text-slate-500">{fmtRupees(inv.paidPaise)} paid</div>}
          <div className="text-[10px] text-slate-400">Due {new Date(inv.dueOn).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</div>
        </div>
      </div>
      {!isPaid && (
        <div className="mt-3 flex items-center gap-2">
          <input type="checkbox" checked={checked} onChange={onToggle} onClick={(e) => e.stopPropagation()} className="h-5 w-5 rounded border-slate-300 accent-emerald-600" />
          <span className="text-xs text-slate-600">{checked ? "Selected — will pay this" : "Tap to select"}</span>
        </div>
      )}
    </li>
  );
}

// ---- Success card --------------------------------------------------------

function SuccessCard({ academyName, paymentId, onView }: { academyName: string; paymentId: string; onView: () => void }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50 via-white to-emerald-50 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md text-center rounded-3xl bg-white px-6 py-10 shadow-xl ring-1 ring-emerald-200">
        <div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-3xl">✅</div>
        <h1 className="font-display text-3xl text-slate-900">Payment received</h1>
        <p className="mt-2 text-sm text-slate-500">{academyName} · Payment ID <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{paymentId.slice(-10)}</code></p>
        <p className="mt-4 text-sm text-slate-600">A receipt has been emailed to you. Balances will update on this page in a moment.</p>
        <button onClick={onView} className="mt-6 inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-slate-900 px-6 text-sm font-bold text-white">Back to invoices</button>
      </div>
    </div>
  );
}

// ---- Small shared --------------------------------------------------------

function EmptyState({ academyName }: { academyName: string }) {
  return (
    <div className="rounded-3xl bg-white px-6 py-10 text-center shadow-md ring-1 ring-slate-200">
      <div className="mx-auto mb-3 text-4xl">🎉</div>
      <h2 className="font-display text-xl text-slate-900">You're all caught up!</h2>
      <p className="mt-1 text-sm text-slate-500">No invoices are due for {academyName} right now.</p>
    </div>
  );
}

function Spinner() { return <div className="animate-spin h-8 w-8 rounded-full border-2 border-slate-200 border-t-slate-900" />; }

function ShellCentered({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen grid place-items-center bg-slate-50 p-6">{children}</div>;
}

function ErrorCard({ title, msg }: { title: string; msg: string }) {
  return (
    <div className="w-full max-w-md rounded-3xl bg-white px-6 py-8 text-center shadow-md ring-1 ring-red-200">
      <div className="mx-auto mb-3 text-3xl">😬</div>
      <h1 className="font-display text-xl text-slate-900">{title}</h1>
      <p className="mt-2 text-sm text-slate-500">{msg}</p>
      <p className="mt-4 text-xs text-slate-400">If you think this is wrong, ask your academy to resend the link.</p>
    </div>
  );
}

// ---- Razorpay Checkout invocation ---------------------------------------

function openRzpCheckout(order: CheckoutOrderResponse, cb: { onSuccess: (r: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => void; onDismiss: () => void; onFail: (msg: string) => void }) {
  const rzp = new window.Razorpay!({
    key: order.razorpayKeyId,
    order_id: order.razorpayOrderId,
    amount: order.amountPaise,
    currency: order.currency,
    name: order.academyName,
    description: `Fees payment · ${order.invoiceIds.length} invoice${order.invoiceIds.length === 1 ? "" : "s"}`,
    prefill: {
      name: order.guardianName ?? "",
      contact: order.guardianPhone ?? "",
    },
    theme: { color: "#4f46e5" },
    handler: (r: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => cb.onSuccess(r),
    modal: { ondismiss: () => cb.onDismiss() },
  });
  rzp.on("payment.failed", (resp: { error?: { description?: string } }) => cb.onFail(resp?.error?.description || "Payment failed. Please try again."));
  rzp.open();
}
