// Fees → Reports (W4f)
//
// Three charts on one page:
//   1. Collection by month (last 12) — dual bar: invoiced vs collected
//   2. Collection by head (Tuition/Exam/Book/Late/Other) — donut
//   3. Defaulters aged (0-30/30-60/60-90/90+) — horizontal stacked bar of
//      invoice count + outstanding
//
// Charts via recharts (~35 KB gzip). Numbers via Intl. Design keeps the
// dashboard's brand palette so the three surfaces feel like one family.

import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Bar, BarChart, Cell, Legend, Pie, PieChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis, CartesianGrid,
} from "recharts";
import { feesApi, fmtRupees, type DefaultersAgedResponse } from "../lib/fees-api";

const t = (s: string) => s;

// Colour palette (indices match the KIND order returned by the server).
const KIND_COLORS: Record<string, string> = {
  TUITION: "#6366f1",  // brand-500 indigo
  EXAM:    "#f59e0b",  // gold-500
  BOOK:    "#10b981",  // accent-500 emerald
  LATE:    "#ef4444",  // red-500
  OTHER:   "#9ca3af",  // ink-300 grey
};

const BUCKET_COLORS: Record<DefaultersAgedResponse["buckets"][number]["key"], string> = {
  "0-30":  "#6366f1",
  "30-60": "#f59e0b",
  "60-90": "#f97316",
  "90+":   "#ef4444",
};

export default function FeesReportsPage() {
  const byMonth = useQuery({ queryKey: ["fees.reports.byMonth"], queryFn: () => feesApi.collectionByMonth(12) });
  const byHead  = useQuery({ queryKey: ["fees.reports.byHead"],  queryFn: () => feesApi.collectionByHead() });
  const aged    = useQuery({ queryKey: ["fees.reports.aged"],    queryFn: () => feesApi.defaultersAged() });

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="mb-2 flex items-center gap-2 text-xs">
        <Link to="/fees" className="text-ink-300 hover:text-white">← {t("Fees")}</Link>
        <span className="text-ink-500">/</span>
        <span className="text-ink-300">{t("Reports")}</span>
      </div>

      <header className="mb-6">
        <div className="mb-1">
          <span className="rounded-full bg-brand-500/15 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-brand-300 ring-1 ring-brand-400/30">{t("Beta · W4")}</span>
        </div>
        <h1 className="font-display text-3xl text-ink-100 sm:text-4xl">{t("Fees reports")}</h1>
        <p className="mt-1 max-w-lg text-sm text-ink-300">{t("Where the money went, where it's coming from, and who's behind.")}</p>
      </header>

      <div className="grid grid-cols-1 gap-6">
        {/* Collection by month */}
        <section className="rounded-2xl border border-ink-700 bg-ink-900/60 p-5">
          <SectionHead title={t("Collection by month")} sub={t("Last 12 months — invoiced (light) vs actually collected (bright).")} />
          {byMonth.isLoading && <SkeletonChart />}
          {byMonth.isError && <ChartError msg={t("Couldn't load monthly totals.")} onRetry={() => byMonth.refetch()} />}
          {byMonth.data && (
            <div className="mt-4 h-72">
              <ResponsiveContainer>
                <BarChart data={byMonth.data.months} margin={{ top: 4, right: 8, left: -8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
                  <XAxis dataKey="label" stroke="#9ca3af" fontSize={11} tickMargin={4} />
                  <YAxis stroke="#9ca3af" fontSize={11} tickFormatter={(v) => fmtRupeesCompact(v)} />
                  <Tooltip
                    cursor={{ fill: "#111827aa" }}
                    contentStyle={{ background: "#0b0f19", border: "1px solid #1f2937", borderRadius: 12, color: "#f1f5f9", fontSize: 12 }}
                    formatter={((v: number, k: string) => [fmtRupees(v), k === "invoicedPaise" ? "Invoiced" : "Collected"]) as unknown as never}
                    labelStyle={{ color: "#a5b4fc" }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 11, color: "#9ca3af" }}
                    formatter={(v) => v === "invoicedPaise" ? "Invoiced" : "Collected"}
                  />
                  <Bar dataKey="invoicedPaise" name="invoicedPaise" fill="#818cf8" radius={[6, 6, 0, 0]} opacity={0.4} />
                  <Bar dataKey="collectedPaise" name="collectedPaise" fill="#6366f1" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Collection by head */}
          <section className="rounded-2xl border border-ink-700 bg-ink-900/60 p-5">
            <SectionHead title={t("Collection by head")} sub={t("Where the money's going. Amounts allocated proportionally per invoice.")} />
            {byHead.isLoading && <SkeletonChart />}
            {byHead.isError && <ChartError msg={t("Couldn't load head breakdown.")} onRetry={() => byHead.refetch()} />}
            {byHead.data && byHead.data.breakdown.length === 0 && (
              <EmptyMini emoji="📊" title={t("No collection yet")} sub={t("Once payments start rolling in, this chart lights up.")} />
            )}
            {byHead.data && byHead.data.breakdown.length > 0 && (
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="h-56">
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie
                        data={byHead.data.breakdown}
                        dataKey="collectedPaise"
                        nameKey="label"
                        innerRadius={40}
                        outerRadius={80}
                        stroke="#0b0f19"
                        strokeWidth={2}
                      >
                        {byHead.data.breakdown.map((row) => (
                          <Cell key={row.kind} fill={KIND_COLORS[row.kind] ?? "#9ca3af"} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ background: "#0b0f19", border: "1px solid #1f2937", borderRadius: 12, color: "#f1f5f9", fontSize: 12 }}
                        formatter={((v: number) => fmtRupees(v)) as unknown as never}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="flex flex-col justify-center gap-2">
                  {byHead.data.breakdown.map((row) => {
                    const pct = byHead.data!.totalCollectedPaise > 0
                      ? Math.round((row.collectedPaise / byHead.data!.totalCollectedPaise) * 100)
                      : 0;
                    return (
                      <li key={row.kind} className="flex items-center gap-2 text-sm">
                        <span className="inline-block h-3 w-3 rounded-sm" style={{ background: KIND_COLORS[row.kind] ?? "#9ca3af" }} />
                        <span className="flex-1 text-ink-100">{row.label}</span>
                        <span className="tabular-nums text-ink-100">{fmtRupees(row.collectedPaise)}</span>
                        <span className="w-10 text-right text-[11px] text-ink-400 tabular-nums">{pct}%</span>
                      </li>
                    );
                  })}
                  <li className="mt-1 flex items-center gap-2 border-t border-ink-800 pt-2 text-sm">
                    <span className="flex-1 font-semibold text-ink-200">{t("Total collected")}</span>
                    <span className="font-display text-lg tabular-nums text-ink-100">{fmtRupees(byHead.data.totalCollectedPaise)}</span>
                  </li>
                </ul>
              </div>
            )}
          </section>

          {/* Defaulters aged */}
          <section className="rounded-2xl border border-ink-700 bg-ink-900/60 p-5">
            <SectionHead title={t("Defaulters aged")} sub={t("How overdue the money is — older buckets need calls, not emails.")} />
            {aged.isLoading && <SkeletonChart />}
            {aged.isError && <ChartError msg={t("Couldn't load aging.")} onRetry={() => aged.refetch()} />}
            {aged.data && aged.data.totalOutstandingPaise === 0 && (
              <EmptyMini emoji="🎉" title={t("No overdue money")} sub={t("Every open invoice is inside its grace window.")} />
            )}
            {aged.data && aged.data.totalOutstandingPaise > 0 && (
              <div className="mt-4">
                <div className="mb-3 text-[11px] uppercase tracking-wider text-ink-400">
                  {t("Total outstanding")} · <b className="text-ink-100">{fmtRupees(aged.data.totalOutstandingPaise)}</b>
                </div>
                {/* Horizontal proportional bar */}
                <div className="flex h-8 overflow-hidden rounded-xl border border-ink-800">
                  {aged.data.buckets.map((b) => {
                    const pct = (b.outstandingPaise / aged.data!.totalOutstandingPaise) * 100;
                    if (pct <= 0) return null;
                    return (
                      <div
                        key={b.key}
                        title={`${b.label}: ${fmtRupees(b.outstandingPaise)}`}
                        style={{ width: `${pct}%`, background: BUCKET_COLORS[b.key] }}
                        className="grid place-items-center text-[10px] font-semibold text-white/90"
                      >
                        {pct >= 8 ? `${Math.round(pct)}%` : ""}
                      </div>
                    );
                  })}
                </div>
                <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {aged.data.buckets.map((b) => (
                    <li key={b.key} className="flex items-center gap-2 rounded-xl border border-ink-800 bg-ink-900/40 px-3 py-2 text-sm">
                      <span className="inline-block h-3 w-3 rounded-sm" style={{ background: BUCKET_COLORS[b.key] }} />
                      <div className="min-w-0 flex-1">
                        <div className="text-ink-100">{b.label}</div>
                        <div className="text-[11px] text-ink-400">
                          {b.invoiceCount} {b.invoiceCount === 1 ? "invoice" : "invoices"}
                          {" · "}{b.guardianCount} {b.guardianCount === 1 ? "guardian" : "guardians"}
                        </div>
                      </div>
                      <div className="text-right font-display text-lg tabular-nums text-ink-100">{fmtRupees(b.outstandingPaise)}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// ---- small shared ---------------------------------------------------------

function SectionHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-300">{title}</h2>
      <p className="mt-0.5 text-xs text-ink-400">{sub}</p>
    </div>
  );
}
function SkeletonChart() { return <div className="mt-4 h-72 animate-pulse rounded-xl bg-ink-800/40" />; }
function ChartError({ msg, onRetry }: { msg: string; onRetry: () => void }) {
  return (
    <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-8 text-center">
      <div className="mb-2 text-2xl">😬</div>
      <div className="text-sm text-ink-200">{msg}</div>
      <button onClick={onRetry} className="mt-3 h-9 rounded-lg border border-red-500/40 bg-red-500/10 px-3 text-xs font-semibold text-red-200 hover:bg-red-500/20">Retry</button>
    </div>
  );
}
function EmptyMini({ emoji, title, sub }: { emoji: string; title: string; sub: string }) {
  return (
    <div className="mt-4 py-10 text-center">
      <div className="mb-2 text-3xl">{emoji}</div>
      <div className="text-sm font-medium text-ink-200">{title}</div>
      <div className="mt-1 text-[11px] text-ink-400">{sub}</div>
    </div>
  );
}

// Compact ₹ (1.2K, 3.4L) for axis labels; the tooltip uses full formatting.
function fmtRupeesCompact(paise: number): string {
  const r = paise / 100;
  if (r >= 1e7) return `₹${(r / 1e7).toFixed(1)}Cr`;
  if (r >= 1e5) return `₹${(r / 1e5).toFixed(1)}L`;
  if (r >= 1e3) return `₹${(r / 1e3).toFixed(1)}K`;
  return `₹${Math.round(r)}`;
}
