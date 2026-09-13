// FeesProofsPanel — parent-uploaded UPI payment screenshots waiting for the
// owner's verification (owner 2026-09-13: "verify the screenshot → fees
// marked as paid"). Accept records a manual UPI payment against the proof's
// invoices (same path as cash); Reject asks for a one-line reason the parent
// sees on their pay page.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { feesApi, fmtRupees, type PaymentProofResponse } from "../lib/fees-api";

const t = (s: string) => s;

export default function FeesProofsPanel() {
  const { data, isLoading } = useQuery({ queryKey: ["fees.proofs", "PENDING"], queryFn: () => feesApi.proofs("PENDING"), refetchInterval: 60_000 });
  const rows = data?.proofs ?? [];
  const [zoom, setZoom] = useState<PaymentProofResponse | null>(null);
  if (isLoading || rows.length === 0) return null;
  return (
    <section className="rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-emerald-300">🧾 {t("Payment screenshots to verify")} <span className="ml-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px]">{rows.length}</span></h2>
          <p className="mt-1 text-[12px] text-ink-400">{t("Parents paid by UPI and uploaded the screenshot. Check it against your bank/UPI app, then Accept — the fee is marked paid and a receipt is issued.")}</p>
        </div>
      </div>
      <ul className="space-y-3">
        {rows.map((p) => <ProofRow key={p.id} p={p} onZoom={() => setZoom(p)} />)}
      </ul>
      {zoom && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4" onClick={() => setZoom(null)}>
          <img src={zoom.imageDataUrl} alt="" className="max-h-[92vh] max-w-full rounded-xl object-contain" />
        </div>
      )}
    </section>
  );
}

function ProofRow({ p, onZoom }: { p: PaymentProofResponse; onZoom: () => void }) {
  const qc = useQueryClient();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const done = () => { qc.invalidateQueries({ queryKey: ["fees.proofs"] }); qc.invalidateQueries({ queryKey: ["fees.students"] }); qc.invalidateQueries({ queryKey: ["fees.dashboard"] }); };
  const accept = useMutation({ mutationFn: () => feesApi.acceptProof(p.id), onSuccess: done, onError: (e) => setErr(e instanceof Error ? e.message : t("Couldn't accept.")) });
  const reject = useMutation({ mutationFn: () => feesApi.rejectProof(p.id, reason), onSuccess: done, onError: (e) => setErr(e instanceof Error ? e.message : t("Couldn't reject.")) });
  const mismatch = p.amountPaise !== p.outstandingPaise;
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-ink-800 bg-ink-900/60 p-3 sm:flex-row sm:items-start">
      <button onClick={onZoom} className="flex-none overflow-hidden rounded-lg border border-ink-700" title={t("Click to enlarge")}>
        <img src={p.imageDataUrl} alt="" className="h-28 w-20 object-cover" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-ink-100">{p.guardianName ?? t("(parent)")} <span className="font-normal text-ink-400">· {p.studentNames.join(", ")}</span></div>
        <div className="mt-0.5 text-[12px] text-ink-300">
          {t("Says paid")} <b className="text-ink-100">{fmtRupees(p.amountPaise)}</b>
          {mismatch && <span className="ml-1 text-gold-400">({t("open balance")} {fmtRupees(p.outstandingPaise)})</span>}
          {p.utr && <> · UTR <code className="rounded bg-ink-800 px-1">{p.utr}</code></>}
        </div>
        <div className="mt-0.5 text-[11px] text-ink-500">{p.invoiceNos.join(", ")} · {new Date(p.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}{p.guardianPhone && <> · 📞 {p.guardianPhone}</>}</div>
        {err && <div role="alert" className="mt-1 text-[11px] text-red-300">{err}</div>}
        {rejecting && (
          <form onSubmit={(e) => { e.preventDefault(); reject.mutate(); }} className="mt-2 flex flex-wrap items-center gap-2">
            <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("Reason the parent will see (e.g. amount not received)")} className="h-9 min-w-[260px] flex-1 rounded-lg border border-ink-700 bg-ink-950/60 px-2 text-sm text-ink-100 placeholder:text-ink-500" />
            <button type="submit" disabled={reject.isPending} className="h-9 rounded-lg bg-red-600 px-3 text-[12px] font-semibold text-white hover:bg-red-500 disabled:opacity-50">{reject.isPending ? t("…") : t("Reject")}</button>
            <button type="button" onClick={() => setRejecting(false)} className="h-9 px-2 text-[12px] text-ink-400">{t("Cancel")}</button>
          </form>
        )}
      </div>
      {!rejecting && (
        <div className="flex flex-none gap-2 sm:flex-col">
          <button onClick={() => accept.mutate()} disabled={accept.isPending} className="h-9 rounded-lg bg-emerald-600 px-3 text-[12px] font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">{accept.isPending ? t("Saving…") : t("✓ Accept · mark paid")}</button>
          <button onClick={() => setRejecting(true)} className="h-9 rounded-lg border border-ink-700 px-3 text-[12px] font-semibold text-ink-300 hover:text-white">{t("Reject")}</button>
        </div>
      )}
    </li>
  );
}
