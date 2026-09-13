// Academy → Billing (owner 2026-09-13). Plan by student count, pay once (1/3/6/12 months) or subscribe
// monthly with auto-renew, both through Razorpay Checkout; payment history; quotation above 500 students.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post } from "../lib/api";

type Billing = {
  academyId: string; academyName: string; state: "trialing" | "active" | "manual" | "grace" | "locked"; plan: string | null;
  students: number; monthlyPricePaise: number | null; yearlyPricePaise: number | null; quotation: boolean; customPrice?: boolean;
  trialEndsAt: string | null; paidUntil: string | null; periodEndsAt: string | null; daysLeft: number | null; graceEndsAt: string | null;
  razorpayConfigured: boolean; keyId: string | null;
  subscription: { id: string; status: string; amountPaise: number; period: "monthly" | "yearly"; nextChargeAt: string | null; cancelling: boolean } | null;
  payments: Array<{ id: string; at: string; amountPaise: number; months: number | null; method: string; status: string; paidUntil: string | null; note?: string }>;
  whatsapp: string;
};
declare global { interface Window { Razorpay?: any } }
const RZP = "https://checkout.razorpay.com/v1/checkout.js";
async function loadRazorpay() {
  if (window.Razorpay) return;
  await new Promise<void>((res, rej) => { const s = document.createElement("script"); s.src = RZP; s.async = true; s.onload = () => res(); s.onerror = () => rej(new Error("Couldn't load Razorpay — check your connection.")); document.head.appendChild(s); });
}
const inr = (p: number) => "₹" + Math.round(p / 100).toLocaleString("en-IN");
const amountFor = (monthly: number, months: number) => monthly * (months === 12 ? 10 : months); // yearly = 2 months free
const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const WA = (t: string) => `https://wa.me/918248353593?text=${encodeURIComponent(t)}`;

export default function AcademyBillingPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["academy-billing"], queryFn: () => get<Billing>("/api/academy/billing"), staleTime: 30_000 });
  const [months, setMonths] = useState<1 | 3 | 6 | 12>(1);
  const [subPeriod, setSubPeriod] = useState<"monthly" | "yearly">("monthly");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { document.title = "Billing · ChessGuru"; }, []);
  const b = q.data;

  async function payOnce() {
    if (!b) return; setBusy("order"); setMsg(null);
    try {
      await loadRazorpay();
      const o = await post<{ orderId: string; amountPaise: number; keyId: string; academyName: string; prefill: any }>("/api/academy/billing/order", { months });
      const rzp = new window.Razorpay({
        key: o.keyId, order_id: o.orderId, amount: o.amountPaise, currency: "INR", name: "ChessGuru", description: `${o.academyName} · ${months} month${months === 1 ? "" : "s"}`,
        prefill: o.prefill, theme: { color: "#f59e0b" },
        handler: async (r: any) => {
          try { const c = await post<{ ok: boolean; paidUntil?: string }>("/api/academy/billing/confirm", { orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature }); setMsg({ kind: "ok", text: `Payment received. ${b.academyName} is active until ${fmt(c.paidUntil ?? null)}.` }); }
          catch (e: any) { setMsg({ kind: "err", text: e?.message || "Could not confirm the payment." }); }
          qc.invalidateQueries({ queryKey: ["academy-billing"] }); qc.invalidateQueries({ queryKey: ["academy-meta"] }); setBusy(null);
        },
        modal: { ondismiss: () => setBusy(null) },
      });
      rzp.on("payment.failed", (resp: any) => { setMsg({ kind: "err", text: resp?.error?.description || "Payment failed. Please try again." }); setBusy(null); });
      rzp.open();
    } catch (e: any) { setMsg({ kind: "err", text: e?.message || "Could not start the payment." }); setBusy(null); }
  }
  async function subscribe() {
    if (!b) return; setBusy("sub"); setMsg(null);
    try {
      await loadRazorpay();
      const s = await post<{ subscriptionId: string; amountPaise: number; period: "monthly" | "yearly"; keyId: string; academyName: string; prefill: any }>("/api/academy/billing/subscribe", { period: subPeriod });
      const rzp = new window.Razorpay({
        key: s.keyId, subscription_id: s.subscriptionId, name: "ChessGuru", description: `${s.academyName} · ${inr(s.amountPaise)} every ${s.period === "yearly" ? "year" : "month"}`, prefill: s.prefill, theme: { color: "#f59e0b" },
        handler: async (r: any) => {
          try { await post("/api/academy/billing/subscribe/confirm", { subscriptionId: r.razorpay_subscription_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature }); setMsg({ kind: "ok", text: s.period === "yearly" ? "Auto-renew is on. This year is paid (12 months for the price of 10) and it renews each year on its own." : "Auto-renew is on. The first month is paid and each month renews on its own." }); }
          catch (e: any) { setMsg({ kind: "err", text: e?.message || "Could not confirm the subscription." }); }
          qc.invalidateQueries({ queryKey: ["academy-billing"] }); qc.invalidateQueries({ queryKey: ["academy-meta"] }); setBusy(null);
        },
        modal: { ondismiss: () => setBusy(null) },
      });
      rzp.on("payment.failed", (resp: any) => { setMsg({ kind: "err", text: resp?.error?.description || "Payment failed. Please try again." }); setBusy(null); });
      rzp.open();
    } catch (e: any) { setMsg({ kind: "err", text: e?.message || "Could not start the subscription." }); setBusy(null); }
  }
  const cancel = useMutation({
    mutationFn: () => post("/api/academy/billing/subscribe/cancel", {}),
    onSuccess: () => { setMsg({ kind: "ok", text: "Auto-renew will stop at the end of the paid month. Nothing you have paid for is lost." }); qc.invalidateQueries({ queryKey: ["academy-billing"] }); },
    onError: (e: any) => setMsg({ kind: "err", text: e?.message || "Could not cancel." }),
  });

  const stateChip = b && ({
    trialing: ["Free trial", "bg-emerald-500/15 text-emerald-200 border-emerald-400/30"],
    active: ["Active", "bg-emerald-500/15 text-emerald-200 border-emerald-400/30"],
    manual: ["Active · managed by ChessGuru", "bg-sky-500/15 text-sky-200 border-sky-400/30"],
    grace: ["Payment due · grace period", "bg-amber-500/15 text-amber-200 border-amber-400/30"],
    locked: ["Paused · payment needed", "bg-rose-500/15 text-rose-200 border-rose-400/30"],
  } as const)[b.state];

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-brand-200">🏛️ Academy · Billing</div>
          <h1 className="mt-1 font-display text-3xl font-bold text-white">{b?.academyName ?? "Billing"}</h1>
        </div>
        <Link to="/academy" className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs font-medium text-ink-300 hover:text-white">← Academy</Link>
      </div>
      {q.isLoading && <div className="text-sm text-ink-400">Loading…</div>}
      {q.error && <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-200">{(q.error as any)?.message || "Could not load billing."}</div>}
      {msg && <div className={`rounded-xl border p-4 text-sm ${msg.kind === "ok" ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-100" : "border-rose-400/30 bg-rose-500/10 text-rose-200"}`}>{msg.text}</div>}
      {b && (
        <>
          {/* status */}
          <div className="grid gap-4">
            <div className="rounded-2xl border border-white/10 bg-ink-900/60 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${stateChip?.[1]}`}>{stateChip?.[0]}</span>
                {b.subscription && <span className="rounded-full border border-brand-400/30 bg-brand-500/15 px-3 py-1 text-xs font-semibold text-brand-100">🔁 Auto-renew {b.subscription.cancelling ? "stopping at cycle end" : b.subscription.status}</span>}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div><div className="text-[11px] uppercase tracking-wide text-ink-400">Students</div><div className="font-display text-2xl font-bold text-white tabular-nums">{b.students}</div></div>
                <div><div className="text-[11px] uppercase tracking-wide text-ink-400">Your price</div><div className="font-display text-2xl font-bold text-white tabular-nums">{b.quotation ? "Quotation" : inr(b.monthlyPricePaise!)}<span className="text-sm font-normal text-ink-400">{b.quotation ? "" : " / month"}</span></div></div>
                <div><div className="text-[11px] uppercase tracking-wide text-ink-400">{b.state === "trialing" ? "Trial ends" : b.state === "manual" ? "Period" : "Paid until"}</div><div className="font-display text-2xl font-bold text-white">{b.state === "manual" ? "Open" : fmt(b.periodEndsAt)}</div></div>
                <div><div className="text-[11px] uppercase tracking-wide text-ink-400">Days left</div><div className={`font-display text-2xl font-bold tabular-nums ${b.daysLeft == null ? "text-white" : b.daysLeft > 7 ? "text-emerald-200" : b.daysLeft > 0 ? "text-amber-200" : "text-rose-200"}`}>{b.daysLeft == null ? "—" : Math.max(0, b.daysLeft)}</div></div>
              </div>
              <p className="mt-4 text-xs text-ink-400">
                {b.customPrice ? `Your academy has a special price of ${inr(b.monthlyPricePaise!)} / month agreed with ChessGuru, whatever your student count. ` : "Up to 50 students ₹1,000 / month · up to 100 ₹1,500 · then ₹500 for every extra 50 · coaches unlimited · more than 500 students on quotation. "}Pay for a year and get 2 months free{b.yearlyPricePaise != null ? ` (${inr(b.yearlyPricePaise)} / year)` : ""}.
                {b.state === "grace" && ` Your period ended on ${fmt(b.periodEndsAt)}. Pay by ${fmt(b.graceEndsAt)} to keep managing the academy without a pause.`}
                {b.state === "locked" && ` Academy management is paused since ${fmt(b.graceEndsAt)}. Coaches can still teach and students are not affected — pay below to resume.`}
              </p>
            </div>
          </div>

          {/* pay */}
          {b.quotation ? (
            <div className="rounded-2xl border border-teal-400/30 bg-teal-500/10 p-5 text-sm text-teal-100">
              You have more than 500 students — that is quotation territory. <a href={WA(`Hi Ranjith, ${b.academyName} has ${b.students} students — please send a ChessGuru quotation.`)} target="_blank" rel="noreferrer" className="underline">Ask for a quotation on WhatsApp</a>.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-amber-400/30 bg-gradient-to-br from-amber-500/10 to-transparent p-5">
                <div className="text-xs font-semibold uppercase tracking-widest text-amber-200">Pay once</div>
                <h2 className="mt-1 font-display text-xl font-bold text-white">Choose how many months</h2>
                <div className="mt-3 flex gap-2">
                  {([1, 3, 6, 12] as const).map((m) => (
                    <button key={m} onClick={() => setMonths(m)} className={`relative rounded-full px-3 py-1.5 text-sm font-semibold ${months === m ? "bg-amber-400 text-black" : "bg-ink-800 text-ink-200 hover:bg-ink-700"}`}>{m === 12 ? "1 year" : `${m} mo`}{m === 12 && <span className="absolute -top-2 -right-2 rounded-full bg-emerald-400 px-1.5 py-0.5 text-[9px] font-bold text-black">2 free</span>}</button>
                  ))}
                </div>
                <div className="mt-4 font-display text-3xl font-bold text-white tabular-nums">{inr(amountFor(b.monthlyPricePaise!, months))}{months === 12 && <span className="ml-2 align-middle text-sm font-semibold text-emerald-300 line-through decoration-emerald-300/60">{inr(b.monthlyPricePaise! * 12)}</span>}</div>
                <div className="text-xs text-ink-400">{months === 12 ? `${inr(b.monthlyPricePaise!)} × 10 — you pay for 10 months and get 12` : `${inr(b.monthlyPricePaise!)} × ${months}`} · adds {months} month{months === 1 ? "" : "s"} after {b.state === "trialing" ? "your trial ends" : b.paidUntil && b.state === "active" ? "your current paid period" : "today"}</div>
                <button onClick={payOnce} disabled={!!busy || !b.razorpayConfigured} className="mt-4 w-full rounded-full bg-gradient-to-r from-amber-400 to-amber-500 py-3 text-sm font-bold text-black disabled:opacity-50">{busy === "order" ? "Opening Razorpay…" : `Pay ${inr(amountFor(b.monthlyPricePaise!, months))} with Razorpay`}</button>
                <div className="mt-2 text-[11px] text-ink-500">UPI · cards · net banking · wallets. Razorpay secured.</div>
              </div>
              <div className="rounded-2xl border border-brand-400/30 bg-gradient-to-br from-brand-500/10 to-transparent p-5">
                <div className="text-xs font-semibold uppercase tracking-widest text-brand-200">Subscribe</div>
                <h2 className="mt-1 font-display text-xl font-bold text-white">Auto-renew</h2>
                {!(b.subscription && !b.subscription.cancelling) && (
                  <div className="mt-3 flex gap-2">
                    <button onClick={() => setSubPeriod("monthly")} className={`rounded-full px-3 py-1.5 text-sm font-semibold ${subPeriod === "monthly" ? "bg-brand-400 text-black" : "bg-ink-800 text-ink-200 hover:bg-ink-700"}`}>Monthly</button>
                    <button onClick={() => setSubPeriod("yearly")} className={`relative rounded-full px-3 py-1.5 text-sm font-semibold ${subPeriod === "yearly" ? "bg-brand-400 text-black" : "bg-ink-800 text-ink-200 hover:bg-ink-700"}`}>Yearly<span className="absolute -top-2 -right-2 rounded-full bg-emerald-400 px-1.5 py-0.5 text-[9px] font-bold text-black">2 free</span></button>
                  </div>
                )}
                <div className="mt-4 font-display text-3xl font-bold text-white tabular-nums">{subPeriod === "yearly" ? inr(amountFor(b.monthlyPricePaise!, 12)) : inr(b.monthlyPricePaise!)}<span className="text-sm font-normal text-ink-400"> / {subPeriod === "yearly" ? "year" : "month"}</span></div>
                <div className="text-xs text-ink-400">{subPeriod === "yearly" ? "12 months for the price of 10, charged now and then automatically each year." : "First month charged now, then automatically each month."} Cancel any time — what is paid stays paid.</div>
                {b.subscription && !b.subscription.cancelling ? (
                  <>
                    <div className="mt-4 rounded-xl border border-white/10 bg-ink-900/60 p-3 text-xs text-ink-200">Active · {inr(b.subscription.amountPaise)} / {b.subscription.period === "yearly" ? "year" : "month"}{b.subscription.nextChargeAt ? ` · next charge ${fmt(b.subscription.nextChargeAt)}` : ""}</div>
                    <button onClick={() => { if (confirm(`Stop auto-renew at the end of the paid ${b.subscription!.period === "yearly" ? "year" : "month"}?`)) cancel.mutate(); }} disabled={cancel.isPending} className="mt-3 w-full rounded-full border border-rose-400/40 py-2.5 text-sm font-semibold text-rose-200 hover:bg-rose-500/10">Stop auto-renew</button>
                  </>
                ) : (
                  <button onClick={subscribe} disabled={!!busy || !b.razorpayConfigured} className="mt-4 w-full rounded-full bg-gradient-to-r from-brand-500 to-purple-500 py-3 text-sm font-bold text-white disabled:opacity-50">{busy === "sub" ? "Opening Razorpay…" : "Subscribe with Razorpay"}</button>
                )}
              </div>
            </div>
          )}

          {/* history */}
          <div className="rounded-2xl border border-white/10 bg-ink-900/60 p-5">
            <div className="text-xs font-semibold uppercase tracking-widest text-ink-400">Payments</div>
            {b.payments.length === 0 ? <div className="mt-2 text-sm text-ink-400">No payments yet.</div> : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-[11px] uppercase tracking-wide text-ink-500"><tr><th className="py-1 text-left">Date</th><th className="py-1 text-right">Amount</th><th className="py-1 text-left pl-4">Months</th><th className="py-1 text-left">Method</th><th className="py-1 text-left">Paid until</th></tr></thead>
                  <tbody>{b.payments.map((p) => (
                    <tr key={p.id} className="border-t border-ink-800"><td className="py-1.5">{fmt(p.at)}</td><td className="py-1.5 text-right tabular-nums">{inr(p.amountPaise)}</td><td className="py-1.5 pl-4">{p.months ?? "—"}</td><td className="py-1.5">{p.method === "manual" ? `ChessGuru${p.note ? ` · ${p.note}` : ""}` : p.method === "razorpay-subscription" ? "Razorpay auto-renew" : "Razorpay"}</td><td className="py-1.5">{fmt(p.paidUntil)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
