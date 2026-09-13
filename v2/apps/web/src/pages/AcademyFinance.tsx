import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  EXPENSE_CATEGORIES, INCOME_CATEGORIES, financeCoaches, financeCreate, financeDelete, financeEntries, financeSummary, financeUpdate,
} from "../lib/api";
import type { FinanceCoach, FinanceSummary, LedgerDirection, LedgerEntry } from "../lib/api";

/* ── Academy accounting (2026-09-13) ────────────────────────────────────────────
 * One ledger per academy: income and expenses (rent, coach salary, utilities…),
 * plus the fees collected online, rolled into a monthly profit/loss. Owner only;
 * every call is scoped to the owner's academy server-side. Theme `ink-*` tokens so
 * it reads in light and dark mode.
 * ───────────────────────────────────────────────────────────────────────────── */

const CAT_LABEL: Record<string, string> = {
  rent: "Rent", coach_salary: "Coach salary", utilities: "Utilities", materials: "Materials", marketing: "Marketing",
  software: "Software", travel: "Travel", maintenance: "Maintenance", misc: "Miscellaneous",
  fees_manual: "Fees (manual)", coaching_camp: "Camp / workshop", tournament: "Tournament", merchandise: "Merchandise", other: "Other",
  fees_collected: "Fees collected online",
};
const INPUT = "rounded-lg border border-ink-600 bg-ink-950 px-2 py-1 text-sm text-ink-100 outline-none focus:border-accent-500";
function rupees(paise: number) { return "₹" + (paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 }); }
function thisMonthKey() { const d = new Date(Date.now() + 330 * 60000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; }
function monthLabel(k: string) { const p = k.split("-"); return new Date(Date.UTC(+(p[0] ?? "0"), +(p[1] ?? "1") - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric" }); }
function fmtDate(d: string) { const t = new Date(d); return isNaN(t.getTime()) ? "—" : t.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); }

export default function AcademyFinancePage() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(thisMonthKey());
  const [adding, setAdding] = useState<LedgerDirection | null>(null);

  const summary = useQuery({ queryKey: ["finance-summary", month], queryFn: () => financeSummary(month), retry: false });
  const entries = useQuery({ queryKey: ["finance-entries", month], queryFn: () => financeEntries(month), retry: false });
  const coaches = useQuery({ queryKey: ["finance-coaches"], queryFn: financeCoaches, retry: false });
  const invalidate = () => { qc.invalidateQueries({ queryKey: ["finance-summary"] }); qc.invalidateQueries({ queryKey: ["finance-entries"] }); };
  const create = useMutation({ mutationFn: (b: Partial<LedgerEntry>) => financeCreate(b), onSuccess: () => { setAdding(null); invalidate(); } });
  const del = useMutation({ mutationFn: (id: string) => financeDelete(id), onSuccess: invalidate });

  const months = useMemo(() => {
    const out: string[] = []; const d = new Date(Date.now() + 330 * 60000);
    for (let i = 0; i < 15; i++) { out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`); d.setUTCMonth(d.getUTCMonth() - 1); }
    return out;
  }, []);

  if (summary.isError) {
    const msg = String((summary.error as Error)?.message ?? "");
    return <div className="mx-auto max-w-3xl p-6 text-ink-300">{/401|login/i.test(msg) ? <>Sign in as the academy owner. <Link className="text-brand-300 underline" to="/login">Login</Link></> : /403|owner/i.test(msg) ? "Academy owner only." : `Could not load: ${msg}`}</div>;
  }
  const s: FinanceSummary | undefined = summary.data;

  return (
    <div className="mx-auto max-w-[1200px] p-4 text-ink-300">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-black text-white">Accounts</h1>
          <p className="text-sm text-ink-400">Income, expenses, rent and coach salary for your academy — monthly profit and loss. Fees collected online are counted automatically.</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={month} onChange={(e) => setMonth(e.target.value)} className={INPUT}>
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
          <button className="rounded-lg bg-rose-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-600" onClick={() => setAdding("expense")}>+ Expense</button>
          <button className="rounded-lg bg-accent-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-500" onClick={() => setAdding("income")}>+ Income</button>
        </div>
      </div>

      {s && (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Card label="Income" value={rupees(s.totalIncome)} sub={s.feesCollected > 0 ? `incl. ${rupees(s.feesCollected)} fees online` : "manual + fees online"} tone="text-emerald-400" />
          <Card label="Expenses" value={rupees(s.totalExpense)} sub={`${s.expensesByCategory.length} categories`} tone="text-rose-400" />
          <Card label={s.netPaise >= 0 ? "Profit" : "Loss"} value={rupees(Math.abs(s.netPaise))} sub={monthLabel(s.month)} tone={s.netPaise >= 0 ? "text-emerald-400" : "text-rose-400"} />
        </div>
      )}

      {s && (
        <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Breakdown title="Income" rows={s.incomeByCategory} total={s.totalIncome} tone="bg-emerald-600" />
          <Breakdown title="Expenses" rows={s.expensesByCategory} total={s.totalExpense} tone="bg-rose-600" />
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-ink-700">
        <table className="w-full text-sm">
          <thead className="bg-ink-900 text-left text-[11px] uppercase tracking-wide text-ink-400">
            <tr><th className="p-2">Date</th><th className="p-2">Type</th><th className="p-2">Category</th><th className="p-2">Payee / note</th><th className="p-2 text-right">Amount</th><th className="p-2"></th></tr>
          </thead>
          <tbody>
            {(entries.data ?? []).map((e) => (
              <tr key={e.id} className="border-t border-ink-800 hover:bg-ink-900/60">
                <td className="whitespace-nowrap p-2 text-ink-300">{fmtDate(e.date)}</td>
                <td className="p-2"><span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold text-white ${e.direction === "income" ? "bg-emerald-600" : "bg-rose-600"}`}>{e.direction}</span></td>
                <td className="p-2 text-ink-300">{CAT_LABEL[e.category] ?? e.category}{e.recurring === "monthly" && <span className="ml-1 rounded bg-ink-700 px-1 text-[10px] text-ink-300">monthly</span>}</td>
                <td className="max-w-[360px] p-2 text-ink-400"><span className="text-ink-300">{e.payeeName}</span>{e.payeeName && e.note ? " · " : ""}{e.note}</td>
                <td className={`whitespace-nowrap p-2 text-right font-semibold ${e.direction === "income" ? "text-emerald-400" : "text-rose-400"}`}>{e.direction === "income" ? "+" : "−"}{rupees(e.amountPaise)}</td>
                <td className="p-2 text-right"><button className="text-[11px] text-ink-500 underline hover:text-rose-400" onClick={() => { if (confirm("Delete this entry?")) del.mutate(e.id); }}>delete</button></td>
              </tr>
            ))}
            {(entries.data ?? []).length === 0 && !entries.isLoading && <tr><td className="p-4 text-ink-400" colSpan={6}>No entries for {monthLabel(month)}. Add an expense or income to start the ledger.</td></tr>}
          </tbody>
        </table>
      </div>

      {adding && <AddEntry direction={adding} coaches={coaches.data ?? []} busy={create.isPending} onClose={() => setAdding(null)} onSave={(b) => create.mutate(b)} />}
    </div>
  );
}

function Card({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-900 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">{label}</div>
      <div className={`font-display text-2xl font-black ${tone ?? "text-white"}`}>{value}</div>
      {sub && <div className="text-[11px] text-ink-400">{sub}</div>}
    </div>
  );
}

function Breakdown({ title, rows, total, tone }: { title: string; rows: { category: string; label: string; amountPaise: number }[]; total: number; tone: string }) {
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-900 p-3">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-400">{title} by category</div>
      {rows.length === 0 ? <div className="text-sm text-ink-500">Nothing yet.</div> : rows.map((r) => (
        <div key={r.category} className="mb-1.5">
          <div className="flex justify-between text-sm"><span className="text-ink-300">{r.label}</span><span className="text-ink-200">{rupees(r.amountPaise)}</span></div>
          <div className="mt-0.5 h-1.5 overflow-hidden rounded bg-ink-800"><div className={`h-full ${tone}`} style={{ width: `${total ? Math.max(3, Math.round((r.amountPaise / total) * 100)) : 0}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

function AddEntry({ direction, coaches, onClose, onSave, busy }: { direction: LedgerDirection; coaches: FinanceCoach[]; onClose: () => void; onSave: (b: Partial<LedgerEntry>) => void; busy: boolean }) {
  const cats = direction === "expense" ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
  const [category, setCategory] = useState<string>(cats[0]);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10));
  const [payeeName, setPayeeName] = useState("");
  const [coachUserId, setCoachUserId] = useState("");
  const [note, setNote] = useState("");
  const [recurring, setRecurring] = useState(false);
  const isSalary = direction === "expense" && category === "coach_salary";
  const amountPaise = Math.round(parseFloat(amount || "0") * 100);
  const save = () => {
    if (!amountPaise || amountPaise < 1) return;
    onSave({
      direction, category, amountPaise, date: new Date(date + "T09:00:00+05:30").toISOString(), note,
      payeeName: isSalary && coachUserId ? (coaches.find((c) => c.userId === coachUserId)?.name ?? payeeName) : payeeName,
      ...(isSalary && coachUserId ? { coachUserId, payeeType: "coach" } : category === "rent" ? { payeeType: "vendor" } : {}),
      recurring: recurring ? "monthly" : null,
    } as Partial<LedgerEntry>);
  };
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-ink-700 bg-ink-900 p-4 text-ink-200 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 font-display text-lg font-black text-white">Add {direction}</div>
        <div className="grid gap-2">
          <label className="grid gap-1 text-xs"><span className="text-ink-400">Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={INPUT}>
              {cats.map((c) => <option key={c} value={c}>{CAT_LABEL[c] ?? c}</option>)}
            </select></label>
          {isSalary && (
            <label className="grid gap-1 text-xs"><span className="text-ink-400">Coach</span>
              <select value={coachUserId} onChange={(e) => setCoachUserId(e.target.value)} className={INPUT}>
                <option value="">— pick a coach —</option>
                {coaches.map((c) => <option key={c.userId} value={c.userId}>{c.name}{c.isOwner ? " (owner)" : ""}</option>)}
              </select></label>
          )}
          {!isSalary && (
            <label className="grid gap-1 text-xs"><span className="text-ink-400">{direction === "expense" ? "Paid to (optional)" : "Received from (optional)"}</span>
              <input value={payeeName} onChange={(e) => setPayeeName(e.target.value)} className={INPUT} placeholder={category === "rent" ? "Landlord / property" : ""} /></label>
          )}
          <label className="grid gap-1 text-xs"><span className="text-ink-400">Amount (₹)</span>
            <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" className={INPUT} placeholder="e.g. 15000" /></label>
          <label className="grid gap-1 text-xs"><span className="text-ink-400">Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={INPUT} /></label>
          <label className="grid gap-1 text-xs"><span className="text-ink-400">Note</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} className={INPUT} /></label>
          <label className="flex items-center gap-2 text-xs text-ink-400"><input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} /> recurring every month (rent, salary…)</label>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button className="rounded border border-ink-600 px-3 py-1.5 text-sm text-ink-300" onClick={onClose}>Cancel</button>
          <button disabled={busy || !amountPaise || (isSalary && !coachUserId)} className="rounded bg-accent-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}
