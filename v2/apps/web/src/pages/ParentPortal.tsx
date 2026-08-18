// /parent — the family portal. Shows this parent's linked children, their
// current puzzle rating + 30-day progress snapshot, and every invoice
// (paid + pending) across their kids. Owner ask 2026-08-18: "parent portal
// with billing and progress reports".
//
// Auth: session-scoped only — an authenticated user with childrenIds
// populated sees their family; others get a friendly empty state and a
// pointer to their coach.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate } from "react-router-dom";
import { api, get } from "../lib/api";

type WeaknessRow = { tag: string; label: string; count: number };
type Snapshot = {
  period: { start: string; end: string };
  rating: { current: number | null; change: number | null; historyPoints: number };
  games: { played: number; won: number; drawn: number; lost: number };
  puzzles: { solved: number; inPeriod?: number; wonInPeriod?: number; lostInPeriod?: number };
  revision: { longestStreak: number; totalCards: number };
  topWeaknesses: WeaknessRow[];
};
type Child = {
  _id: string; username: string; name: string;
  academyId: string | null; coachId: string | null;
  dailyStreakCurrent: number;
  puzzleRating: number | null; puzzleTotal: number;
  snapshot: Snapshot | null;
};
type Invoice = {
  _id: string; studentId: string; studentUsername: string;
  period: string; amountPaise: number; status: "pending" | "paid" | "waived";
  generatedAt: string; paidAt: string | null; paymentMethod: string | null;
};
type MePayload = {
  me: { _id: string; username: string; name: string; email: string; role: string | null };
  children: Child[];
  invoices: Invoice[];
  totalPendingPaise: number;
};

const rupees = (paise: number) => "₹" + (paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 });
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export default function ParentPortalPage() {
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const q = useQuery({
    queryKey: ["parent-me"],
    queryFn: () => get<MePayload>("/api/parent/me"),
    enabled: !!auth?.loggedIn,
    staleTime: 60_000,
  });

  if (auth && !auth.loggedIn) return <Navigate to="/login?back=/parent" replace />;
  if (q.isLoading) return <div className="mx-auto max-w-5xl px-3 py-8 text-sm text-ink-400">Loading your family portal…</div>;
  if (q.error || !q.data) {
    return (
      <div className="mx-auto max-w-3xl px-3 py-8 space-y-3">
        <div className="rounded border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{String((q.error as any)?.message || "Could not load portal.")}</div>
      </div>
    );
  }
  const d = q.data;
  const children = d.children;
  const invoicesByChild = useMemo(() => {
    const m = new Map<string, Invoice[]>();
    for (const inv of d.invoices) {
      const list = m.get(inv.studentId) || [];
      list.push(inv);
      m.set(inv.studentId, list);
    }
    return m;
  }, [d.invoices]);

  if (children.length === 0) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-3 py-8">
        <header>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-400">Family portal</div>
          <h1 className="font-display text-2xl text-white">Welcome, {d.me.name || d.me.username}</h1>
        </header>
        <div className="rounded-xl2 border border-amber-500/40 bg-amber-500/10 p-5">
          <div className="text-sm font-semibold text-amber-100">No children linked yet</div>
          <p className="mt-2 text-xs text-amber-200">
            Ask your child's coach to link you to their account. Once linked, this page shows their puzzle rating, monthly progress, and any pending fees.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-3 py-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-400">Family portal</div>
          <h1 className="font-display text-2xl text-white">Welcome, {d.me.name || d.me.username}</h1>
          <p className="mt-1 text-sm text-ink-400">{children.length} child{children.length === 1 ? "" : "ren"} linked · {d.invoices.length} invoice{d.invoices.length === 1 ? "" : "s"}</p>
        </div>
        {d.totalPendingPaise > 0 && (
          <div className="rounded-xl border-2 border-rose-500/40 bg-rose-500/10 px-4 py-2 text-center">
            <div className="text-[10px] uppercase text-rose-300">Pending fees</div>
            <div className="text-lg font-bold tabular-nums text-rose-100">{rupees(d.totalPendingPaise)}</div>
          </div>
        )}
      </header>

      {/* ── Children ── */}
      <section className="space-y-3">
        <h2 className="font-display text-lg text-white">👨‍👩‍👦 My children</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {children.map((c) => {
            const s = c.snapshot;
            const pending = (invoicesByChild.get(c._id) || []).filter((i) => i.status === "pending");
            const pendingSum = pending.reduce((n, i) => n + i.amountPaise, 0);
            return (
              <div key={c._id} className="rounded-xl2 border border-ink-700 bg-ink-900 p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <div>
                    <div className="font-display text-lg text-white">{c.name}</div>
                    <div className="text-[11px] text-ink-500">@{c.username}</div>
                  </div>
                  {c.puzzleRating != null && (
                    <div className="text-right">
                      <div className="text-[10px] uppercase text-ink-500">Rating</div>
                      <div className="font-bold tabular-nums text-brand-200">{c.puzzleRating}</div>
                    </div>
                  )}
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                  <div className="rounded bg-ink-800 p-2 text-center">
                    <div className="text-ink-500">Solved</div>
                    <div className="mt-0.5 font-semibold text-white tabular-nums">{c.puzzleTotal}</div>
                  </div>
                  <div className="rounded bg-ink-800 p-2 text-center">
                    <div className="text-ink-500">Streak</div>
                    <div className="mt-0.5 font-semibold text-amber-200 tabular-nums">{c.dailyStreakCurrent}d</div>
                  </div>
                  <div className="rounded bg-ink-800 p-2 text-center">
                    <div className="text-ink-500">30d</div>
                    <div className="mt-0.5 font-semibold text-emerald-200 tabular-nums">{s?.puzzles.inPeriod ?? 0}</div>
                  </div>
                </div>
                {s && (s.games.played > 0 || s.topWeaknesses.length > 0) && (
                  <div className="mt-3 space-y-1 text-[11px] text-ink-400">
                    {s.games.played > 0 && (
                      <div>Games <b className="text-white">{s.games.won}-{s.games.drawn}-{s.games.lost}</b></div>
                    )}
                    {s.topWeaknesses.length > 0 && (
                      <div>Focus areas: {s.topWeaknesses.map((w) => w.label).join(", ")}</div>
                    )}
                    {s.rating.change != null && (
                      <div>Rating change (30d): <span className={s.rating.change >= 0 ? "text-emerald-300" : "text-rose-300"}>{s.rating.change >= 0 ? "+" : ""}{s.rating.change}</span></div>
                    )}
                  </div>
                )}
                {pendingSum > 0 && (
                  <div className="mt-3 rounded border border-rose-500/30 bg-rose-500/5 px-2 py-1.5 text-[11px] text-rose-200">
                    ₹{(pendingSum / 100).toLocaleString("en-IN")} pending · {pending.length} unpaid invoice{pending.length === 1 ? "" : "s"}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Billing ── */}
      <section className="space-y-3">
        <h2 className="font-display text-lg text-white">💳 Billing</h2>
        {d.invoices.length === 0 ? (
          <p className="text-sm text-ink-400">No invoices yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-ink-700">
            <table className="min-w-full text-sm">
              <thead className="bg-ink-800/70 text-xs uppercase tracking-wide text-ink-400">
                <tr>
                  <th className="px-3 py-2 text-left">Student</th>
                  <th className="px-3 py-2 text-left">Period</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Generated</th>
                  <th className="px-3 py-2 text-left">Paid</th>
                </tr>
              </thead>
              <tbody>
                {d.invoices.map((i) => {
                  const student = children.find((c) => c._id === i.studentId);
                  return (
                    <tr key={i._id} className={`border-t border-ink-800 ${i.status === "pending" ? "bg-rose-500/5" : ""}`}>
                      <td className="px-3 py-2 text-white">{student?.name || i.studentUsername}</td>
                      <td className="px-3 py-2 text-ink-300">{i.period}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-white">{rupees(i.amountPaise)}</td>
                      <td className="px-3 py-2">
                        {i.status === "pending" && <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-[10px] font-semibold text-rose-200">Pending</span>}
                        {i.status === "paid" && <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-200">Paid</span>}
                        {i.status === "waived" && <span className="rounded-full bg-ink-700 px-2 py-0.5 text-[10px] font-semibold text-ink-300">Waived</span>}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-ink-400">{fmtDate(i.generatedAt)}</td>
                      <td className="px-3 py-2 text-[11px] text-ink-400">{i.paidAt ? fmtDate(i.paidAt) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="text-center text-[11px] text-ink-500">
        Want a detailed monthly report? Ask your child's coach — they can generate one from <Link to="/coach-board/reports" className="text-brand-300 hover:underline">Parent Reports</Link>.
      </div>
    </div>
  );
}
