// FeesStudentsTable — TKT-224 (owner 2026-09-13): "our fees build is not
// friendly and looks empty, show all students, name, and option to add
// WhatsApp number". Every student in the academy, one row each, whether or
// not they're enrolled in a fee programme, with the guardian's WhatsApp
// number editable inline. That number is what 🔔 Remind and the parent
// portal link use, so "no phone" rows are the ones to fix first.
//
// Used on /fees (landing, full list) and /fees/students (same table, own page).

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { feesApi, fmtRupees, type FeesStudentRow } from "../lib/fees-api";

const t = (s: string) => s;

type Filter = "ALL" | "NO_PHONE" | "NOT_ENROLLED" | "DUE";

export default function FeesStudentsTable({ compact = false }: { compact?: boolean }) {
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ["fees.students"], queryFn: () => feesApi.students() });
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");

  const rows = data?.students ?? [];
  const counts = useMemo(() => ({
    all: rows.length,
    noPhone: rows.filter((r) => !r.guardianPhone).length,
    notEnrolled: rows.filter((r) => r.enrolledActive === 0).length,
    due: rows.filter((r) => r.outstandingPaise > 0).length,
  }), [rows]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "NO_PHONE" && r.guardianPhone) return false;
      if (filter === "NOT_ENROLLED" && r.enrolledActive > 0) return false;
      if (filter === "DUE" && r.outstandingPaise === 0) return false;
      if (!needle) return true;
      return [r.name, r.username, r.guardianName, r.guardianPhone, r.coachName, ...r.batchNames, ...r.programNames].filter(Boolean).join(" ").toLowerCase().includes(needle);
    });
  }, [rows, q, filter]);

  return (
    <section className="rounded-2xl border border-ink-700 bg-ink-900/60 p-4 sm:p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-300">👦 {t("All students")} <span className="ml-1 rounded-full bg-ink-800 px-2 py-0.5 text-[11px] text-ink-300">{counts.all}</span></h2>
          <p className="mt-1 text-[12px] text-ink-400">{t("Every student in the academy. Add the parent's WhatsApp number so fee reminders and the pay link can reach them.")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search name, parent, phone…")}
            className="h-10 w-full rounded-xl border border-ink-700 bg-ink-950/60 px-3 text-sm text-ink-100 placeholder:text-ink-500 focus:border-brand-500 focus:outline-none sm:w-64"
          />
          {!compact && <Link to="/fees/students" className="h-10 inline-flex items-center rounded-xl border border-ink-700 px-3 text-xs font-semibold text-ink-300 hover:text-white">{t("Open full page")} →</Link>}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {([["ALL", t("All"), counts.all], ["NO_PHONE", t("No WhatsApp"), counts.noPhone], ["NOT_ENROLLED", t("Not enrolled"), counts.notEnrolled], ["DUE", t("Has dues"), counts.due]] as Array<[Filter, string, number]>).map(([k, label, n]) => (
          <button key={k} onClick={() => setFilter(k)}
            className={`h-8 rounded-full px-3 text-[12px] font-semibold ${filter === k ? "bg-brand-500 text-white" : "border border-ink-700 text-ink-300 hover:text-white"}`}>
            {label} <span className="opacity-70">{n}</span>
          </button>
        ))}
      </div>

      {isLoading && <div className="animate-pulse space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-12 rounded-xl bg-ink-800/50" />)}</div>}
      {isError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-center text-sm text-red-200">
          {error instanceof Error ? error.message : t("Couldn't load students.")}
          <button onClick={() => refetch()} className="ml-3 rounded-lg border border-red-500/50 px-2 py-1 text-xs">{t("Retry")}</button>
        </div>
      )}
      {data && rows.length === 0 && (
        <div className="py-8 text-center">
          <div className="mb-1 text-2xl">👋</div>
          <div className="text-sm font-medium text-ink-200">{t("No students yet.")}</div>
          <div className="mt-0.5 text-[12px] text-ink-400">{t("Add students from the Academy dashboard — they'll show up here with a place for the parent's WhatsApp number.")}</div>
          <Link to="/academy" className="mt-3 inline-flex h-9 items-center rounded-lg bg-brand-600 px-3 text-xs font-semibold text-white hover:bg-brand-500">{t("Go to Academy")} →</Link>
        </div>
      )}
      {data && rows.length > 0 && shown.length === 0 && (
        <div className="py-6 text-center text-sm text-ink-400">{t("No students match.")}</div>
      )}

      {shown.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-ink-500">
                <th className="py-2 pr-3 font-semibold">{t("Student")}</th>
                <th className="py-2 pr-3 font-semibold">{t("Batch · coach")}</th>
                <th className="py-2 pr-3 font-semibold">{t("Parent WhatsApp")}</th>
                <th className="py-2 pr-3 font-semibold">{t("Fee programme")}</th>
                <th className="py-2 pr-3 text-right font-semibold">{t("Dues")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => <StudentRow key={r.id} r={r} />)}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function StudentRow({ r }: { r: FeesStudentRow }) {
  return (
    <tr className="border-t border-ink-800/80 align-top hover:bg-ink-900/40">
      <td className="py-3 pr-3">
        <div className="font-semibold text-ink-100">{r.name}</div>
        {r.username && r.username.toLowerCase() !== r.name.toLowerCase() && <div className="text-[11px] text-ink-500">@{r.username}</div>}
      </td>
      <td className="py-3 pr-3 text-[12px] text-ink-300">
        {r.batchNames.length ? r.batchNames.join(", ") : <span className="text-ink-500">{t("No batch")}</span>}
        {r.coachName && <div className="text-[11px] text-ink-500">{t("Coach")} {r.coachName}</div>}
      </td>
      <td className="py-3 pr-3"><WhatsAppCell r={r} /></td>
      <td className="py-3 pr-3 text-[12px]">
        {r.programNames.length
          ? <span className="text-ink-200">{r.programNames.join(", ")}</span>
          : <Link to="/fees/programs" className="rounded-lg border border-ink-700 px-2 py-1 text-[11px] font-semibold text-ink-300 hover:border-brand-500/60 hover:text-white">{t("Enrol")} →</Link>}
      </td>
      <td className="py-3 pr-3 text-right tabular-nums">
        {r.outstandingPaise > 0
          ? <div>
              <div className={`font-semibold ${r.overdueCount > 0 ? "text-red-300" : "text-gold-400"}`}>{fmtRupees(r.outstandingPaise)}</div>
              {r.overdueCount > 0 && <div className="text-[11px] text-red-300/80">{r.overdueCount} {t("overdue")}</div>}
              <div className="mt-1 flex flex-wrap justify-end gap-1"><RequestOnWhatsApp r={r} /><MarkPaid r={r} /></div>
            </div>
          : <span className="text-[12px] text-emerald-300/80">{r.enrolledActive > 0 ? t("Paid up") : "—"}</span>}
      </td>
    </tr>
  );
}

/** "Mark paid" — owner records a cash / UPI / bank payment by hand for this
 *  student's open invoices (owner 2026-09-13). Same endpoint the Invoices page
 *  uses; FIFO allocation, receipt number, invoice → PAID. */
function MarkPaid({ r }: { r: FeesStudentRow }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [rupees, setRupees] = useState(String(Math.round(r.outstandingPaise / 100)));
  const [method, setMethod] = useState<"CASH" | "UPI" | "BANK">("UPI");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => feesApi.recordManualPayment({ invoiceIds: r.openInvoiceIds, amountPaise: Math.round(Number(rupees) * 100), method, note: note.trim() || undefined }),
    onSuccess: () => { setOpen(false); setErr(null); qc.invalidateQueries({ queryKey: ["fees.students"] }); qc.invalidateQueries({ queryKey: ["fees.dashboard"] }); },
    onError: (e) => setErr(e instanceof Error ? e.message : t("Couldn't record the payment.")),
  });
  if (!r.openInvoiceIds.length) return null;
  if (!open) {
    return <button onClick={() => setOpen(true)} className="inline-flex h-7 items-center gap-1 rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-2 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/20" title={t("Record a payment received in cash, UPI or bank transfer")}>✓ {t("Mark paid")}</button>;
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (Number(rupees) > 0) m.mutate(); }} onClick={(e) => e.stopPropagation()} className="mt-1 w-56 rounded-xl border border-ink-700 bg-ink-950/80 p-2 text-left">
      <div className="text-[10px] uppercase tracking-wider text-ink-500">{t("Payment received")}</div>
      <div className="mt-1 flex items-center gap-1">
        <span className="text-sm text-ink-300">₹</span>
        <input type="number" min={1} step={1} value={rupees} onChange={(e) => setRupees(e.target.value)} className="h-8 w-full rounded-lg border border-ink-700 bg-ink-900 px-2 text-sm text-ink-100 tabular-nums" />
      </div>
      <div className="mt-1.5 flex gap-1">
        {(["UPI", "CASH", "BANK"] as const).map((k) => (
          <button key={k} type="button" onClick={() => setMethod(k)} className={`h-7 flex-1 rounded-lg text-[11px] font-semibold ${method === k ? "bg-brand-500 text-white" : "border border-ink-700 text-ink-300"}`}>{k === "UPI" ? "📱" : k === "CASH" ? "💵" : "🏦"} {k}</button>
        ))}
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("Note / UTR (optional)")} className="mt-1.5 h-8 w-full rounded-lg border border-ink-700 bg-ink-900 px-2 text-[12px] text-ink-100 placeholder:text-ink-500" />
      <div className="mt-1.5 flex items-center gap-1.5">
        <button type="submit" disabled={m.isPending || !(Number(rupees) > 0)} className="h-8 flex-1 rounded-lg bg-emerald-600 text-[12px] font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">{m.isPending ? t("Saving…") : t("Save · mark paid")}</button>
        <button type="button" onClick={() => { setOpen(false); setErr(null); }} className="h-8 px-2 text-[12px] text-ink-400 hover:text-white">{t("Cancel")}</button>
      </div>
      {err && <div role="alert" className="mt-1 text-[11px] text-red-300">{err}</div>}
    </form>
  );
}

/** "Request on WhatsApp" — the CoFee-style fee request from the ticket's
 *  screenshot: opens WhatsApp to the parent with the server-composed text
 *  (student, amount, academy, UPI pay link). Needs a parent with a number. */
function RequestOnWhatsApp({ r }: { r: FeesStudentRow }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!r.guardianUserId || !r.guardianPhone) return <div className="text-[11px] text-ink-500">{t("add WhatsApp to request")}</div>;
  async function onClick(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const x = await feesApi.reminderTextGuardian(r.guardianUserId!, "WHATSAPP");
      if (!x.waLink) { setErr(t("No phone on file.")); return; }
      void feesApi.logReminder({ guardianUserId: r.guardianUserId!, channel: "WHATSAPP", template: x.template }).catch(() => { /* best-effort */ });
      qc.invalidateQueries({ queryKey: ["fees.dashboard"] });
      window.open(x.waLink, "_blank", "noopener,noreferrer");
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : t("Couldn't build the request.")); }
    finally { setBusy(false); }
  }
  return (
    <>
      <a href="#" onClick={onClick} aria-disabled={busy} title={t("Open WhatsApp with the fee request + UPI pay link")}
         className="mt-1 inline-flex h-7 items-center gap-1 rounded-lg border border-accent-500/50 bg-accent-500/10 px-2 text-[11px] font-semibold text-accent-300 hover:bg-accent-500/20">
        💬 {busy ? t("Opening…") : t("Request on WhatsApp")}
      </a>
      {err && <div role="alert" className="text-[10px] text-red-300">{err}</div>}
    </>
  );
}

/** Inline "Add WhatsApp" → number + optional parent name → link-parent. */
function WhatsAppCell({ r }: { r: FeesStudentRow }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [mobile, setMobile] = useState("");
  const [parentName, setParentName] = useState(r.guardianName ?? "");
  const [err, setErr] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => feesApi.addStudentWhatsApp(r.id, mobile.trim(), parentName.trim()),
    onSuccess: (j) => {
      if (!j.ok) { setErr(j.error || t("Couldn't save.")); return; }
      setEditing(false); setErr(null);
      qc.invalidateQueries({ queryKey: ["fees.students"] });
      qc.invalidateQueries({ queryKey: ["fees.dashboard"] });
      qc.invalidateQueries({ queryKey: ["academy-students"] });
    },
    onError: (e) => setErr(e instanceof Error ? e.message : t("Couldn't save.")),
  });

  if (editing) {
    return (
      <form onSubmit={(e) => { e.preventDefault(); if (mobile.trim()) m.mutate(); }} className="flex flex-col gap-1.5">
        <input autoFocus type="tel" inputMode="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="+91 98765 43210"
          className="h-9 w-44 rounded-lg border border-ink-700 bg-ink-950/60 px-2 text-sm text-ink-100 placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
        {!r.guardianName && (
          <input value={parentName} onChange={(e) => setParentName(e.target.value)} placeholder={t("Parent name (optional)")}
            className="h-9 w-44 rounded-lg border border-ink-700 bg-ink-950/60 px-2 text-sm text-ink-100 placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
        )}
        <div className="flex items-center gap-1.5">
          <button type="submit" disabled={m.isPending || !mobile.trim()} className="h-8 rounded-lg bg-brand-600 px-3 text-[12px] font-semibold text-white hover:bg-brand-500 disabled:opacity-50">{m.isPending ? t("Saving…") : t("Save")}</button>
          <button type="button" onClick={() => { setEditing(false); setErr(null); }} className="h-8 rounded-lg px-2 text-[12px] text-ink-400 hover:text-white">{t("Cancel")}</button>
        </div>
        {err && <div role="alert" className="text-[11px] text-red-300">{err}</div>}
      </form>
    );
  }

  if (r.guardianPhone) {
    const digits = r.guardianPhone.replace(/[^\d]/g, "");
    return (
      <div className="flex flex-col gap-0.5">
        <a href={`https://wa.me/${digits}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-300 hover:underline" title={t("Open WhatsApp chat")}>
          <span aria-hidden>💬</span> {r.guardianPhone}
        </a>
        {r.guardianName && <div className="text-[11px] text-ink-500">{r.guardianName}</div>}
      </div>
    );
  }

  return (
    <button onClick={() => setEditing(true)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-2.5 text-[12px] font-semibold text-emerald-300 hover:bg-emerald-500/20" title={t("Add the parent's WhatsApp number so reminders can reach them")}>
      ＋ {t("Add WhatsApp")}
    </button>
  );
}
