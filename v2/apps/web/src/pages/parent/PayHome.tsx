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
import QRCode from "qrcode";

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

        {/* Owner 2026-09-13: QR + UPI ID on the pay page, and a place to upload
            the payment screenshot; the academy verifies it and marks the fee paid. */}
        {totals.allBalance > 0 && (
          <UpiPanel upiId={data.upiId} payee={data.upiPayeeName ?? data.academyName} amountPaise={totals.picked > 0 ? totals.picked : totals.allBalance} academyName={data.academyName} />
        )}
        {(totals.allBalance > 0 || data.proofs.length > 0) && (
          <ProofUpload token={token} g={g} a={a} invoices={data.invoices.filter((i) => i.balancePaise > 0)} picked={picked} defaultAmountPaise={totals.picked > 0 ? totals.picked : totals.allBalance} proofs={data.proofs} onDone={() => { void refresh(); }} />
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
              <div className="text-xs text-slate-500 text-right">{data.upiId ? <>Pay by UPI above, then<br/>upload your screenshot.</> : <>Online payment isn't set up yet.<br/>Please pay the academy directly.</>}</div>
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

// ---- UPI: QR + ID + open-in-app ------------------------------------------

function UpiPanel({ upiId, payee, amountPaise, academyName }: { upiId?: string; payee: string; amountPaise: number; academyName: string }) {
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const rupees = (amountPaise / 100).toFixed(2);
  const upiUrl = upiId ? `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(payee)}&am=${rupees}&cu=INR&tn=${encodeURIComponent(`Fees ${academyName}`.slice(0, 40))}` : "";
  useEffect(() => {
    if (!upiUrl) { setQr(null); return; }
    QRCode.toDataURL(upiUrl, { width: 260, margin: 1, errorCorrectionLevel: "M" }).then(setQr).catch(() => setQr(null));
  }, [upiUrl]);
  if (!upiId) return null;
  async function copy() {
    try { await navigator.clipboard.writeText(upiId!); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  }
  return (
    <section className="mt-5 rounded-3xl bg-white p-5 shadow-md ring-1 ring-slate-200">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">Pay by UPI</div>
      <h2 className="mt-1 font-display text-xl text-slate-900">Scan or tap to pay {fmtRupees(amountPaise)}</h2>
      <div className="mt-3 flex flex-col items-center gap-3 sm:flex-row sm:items-start">
        {qr ? <img src={qr} alt="UPI QR code" className="h-44 w-44 rounded-xl ring-1 ring-slate-200" /> : <div className="h-44 w-44 animate-pulse rounded-xl bg-slate-100" />}
        <div className="min-w-0 flex-1 text-sm text-slate-700">
          <div className="text-[11px] uppercase tracking-wider text-slate-500">UPI ID</div>
          <div className="mt-0.5 flex items-center gap-2">
            <code className="rounded-lg bg-slate-100 px-2 py-1 text-base font-semibold text-slate-900">{upiId}</code>
            <button onClick={copy} className="h-8 rounded-lg border border-slate-300 px-2 text-xs font-semibold">{copied ? "Copied ✓" : "Copy"}</button>
          </div>
          <div className="mt-1 text-xs text-slate-500">Payee: {payee}</div>
          <a href={upiUrl} className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-2xl bg-slate-900 px-5 text-sm font-bold text-white sm:w-auto">Open in GPay / PhonePe / Paytm →</a>
          <p className="mt-2 text-[11px] text-slate-500">On a phone the button opens your UPI app with the amount filled in. On a computer, scan the QR with any UPI app. Then upload the payment screenshot below so the academy can mark it paid.</p>
        </div>
      </div>
    </section>
  );
}

// ---- Upload a payment screenshot for verification -------------------------

async function fileToJpegDataUrl(file: File, maxSide = 1280, quality = 0.8): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  c.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
  return c.toDataURL("image/jpeg", quality);
}

function ProofUpload({ token, g, a, invoices, picked, defaultAmountPaise, proofs, onDone }: {
  token: string; g: string; a: string; invoices: PortalInvoiceLine[]; picked: Set<string>; defaultAmountPaise: number;
  proofs: PortalResponse["proofs"]; onDone: () => void;
}) {
  const [img, setImg] = useState<string | null>(null);
  const [rupees, setRupees] = useState(String(Math.round(defaultAmountPaise / 100)));
  const [utr, setUtr] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { setRupees(String(Math.round(defaultAmountPaise / 100))); }, [defaultAmountPaise]);
  const pending = proofs.filter((p) => p.status === "PENDING");

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    setMsg(null);
    try { setImg(await fileToJpegDataUrl(f)); } catch { setMsg({ ok: false, text: "Couldn't read that image — try a JPG or PNG screenshot." }); }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!img) { setMsg({ ok: false, text: "Attach the payment screenshot first." }); return; }
    const ids = invoices.filter((i) => picked.has(i.id)).map((i) => i.id);
    const invoiceIds = ids.length ? ids : invoices.map((i) => i.id);
    setBusy(true); setMsg(null);
    try {
      await portalApi.submitProof(token, g, a, { invoiceIds, amountPaise: Math.round(Number(rupees) * 100), utr: utr.trim() || undefined, imageDataUrl: img });
      setImg(null); setUtr("");
      setMsg({ ok: true, text: "Screenshot sent. The academy will verify it and your fee will show as paid — usually the same day." });
      onDone();
    } catch (e2) { setMsg({ ok: false, text: e2 instanceof Error ? e2.message : "Couldn't upload. Please try again." }); }
    finally { setBusy(false); }
  }

  return (
    <section className="mt-5 rounded-3xl bg-white p-5 shadow-md ring-1 ring-slate-200">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-brand-600">Already paid?</div>
      <h2 className="mt-1 font-display text-xl text-slate-900">Upload the payment screenshot</h2>
      <p className="mt-1 text-sm text-slate-500">Paid by UPI, cash or bank transfer? Send the screenshot here and the academy will mark your fee as paid after checking it.</p>
      {invoices.length > 0 && (
        <form onSubmit={submit} className="mt-4 space-y-3">
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">Screenshot</span>
            <input type="file" accept="image/*" onChange={onFile} className="mt-1 block w-full text-sm text-slate-600 file:mr-3 file:rounded-xl file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white" />
          </label>
          {img && <img src={img} alt="Payment screenshot preview" className="max-h-56 rounded-xl ring-1 ring-slate-200" />}
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="text-xs font-semibold text-slate-600">Amount paid (₹)</span>
              <input type="number" min={1} step={1} value={rupees} onChange={(e) => setRupees(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm tabular-nums" /></label>
            <label className="block"><span className="text-xs font-semibold text-slate-600">UPI reference / UTR (optional)</span>
              <input value={utr} onChange={(e) => setUtr(e.target.value)} placeholder="12-digit number" className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" /></label>
          </div>
          {msg && <div role="alert" className={`rounded-2xl px-4 py-3 text-sm ${msg.ok ? "border border-emerald-200 bg-emerald-50 text-emerald-800" : "border border-red-200 bg-red-50 text-red-700"}`}>{msg.text}</div>}
          <button type="submit" disabled={busy || !img} className="inline-flex h-12 w-full items-center justify-center rounded-2xl bg-gradient-to-r from-brand-600 to-brand-500 text-sm font-bold text-white shadow-lg disabled:opacity-50">{busy ? "Uploading…" : "Send screenshot for verification →"}</button>
        </form>
      )}
      {proofs.length > 0 && (
        <ul className="mt-4 space-y-2">
          {proofs.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="font-semibold text-slate-900">{fmtRupees(p.amountPaise)} <span className="font-normal text-slate-500">· {new Date(p.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}{p.utr ? ` · UTR ${p.utr}` : ""}</span></div>
                {p.status === "REJECTED" && p.rejectReason && <div className="text-xs text-red-600">{p.rejectReason}</div>}
              </div>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${p.status === "ACCEPTED" ? "bg-emerald-100 text-emerald-800" : p.status === "REJECTED" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>{p.status === "PENDING" ? "checking" : p.status === "ACCEPTED" ? "paid ✓" : "rejected"}</span>
            </li>
          ))}
        </ul>
      )}
      {pending.length > 0 && invoices.length > 0 && <p className="mt-2 text-[11px] text-slate-500">{pending.length} screenshot{pending.length === 1 ? "" : "s"} waiting for the academy to verify.</p>}
    </section>
  );
}
