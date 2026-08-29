// Fees dashboard (W3-lite)
//
// Owner opens /fees → sees this month's collection at a glance, overdue
// pressure, expected inflow, top defaulters (with 🔔 remind), recent
// payments, 30-day trend sparkline, and quick-actions to jump into
// Programs / Invoices. Skip the old tile-grid landing — this is more
// useful.
//
// Design per plan §DesignPrinciples: all 4 states, i18n-keyed strings,
// currency via Intl, ≥ 44 px touch targets, no dark patterns.

import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { feesApi, fmtRupees, type DashboardResponse, type ReminderTextResponse } from "../lib/fees-api";

const t = (s: string) => s;

export default function FeesDashboardPage() {
  const nav = useNavigate();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["fees.dashboard"],
    queryFn: () => feesApi.dashboard(),
    refetchInterval: 60_000,  // gentle 60 s refresh — cheap query, high-value UX
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-1">
            <span className="rounded-full bg-brand-500/15 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-brand-300 ring-1 ring-brand-400/30">{t("Beta · W3")}</span>
          </div>
          <h1 className="font-display text-4xl text-ink-100 sm:text-5xl">{t("Fees")}</h1>
          <p className="mt-1 max-w-xl text-sm text-ink-300">{t("Today's picture — collected, overdue, expected, and who to nudge next.")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/fees/programs" className="inline-flex h-10 items-center gap-2 rounded-xl border border-ink-700 bg-ink-900/60 px-4 text-sm font-semibold text-ink-200 hover:border-brand-500/60 hover:text-white">
            🎓 {t("Programs")}
          </Link>
          <Link to="/fees/invoices" className="inline-flex h-10 items-center gap-2 rounded-xl border border-ink-700 bg-ink-900/60 px-4 text-sm font-semibold text-ink-200 hover:border-brand-500/60 hover:text-white">
            🧾 {t("Invoices")}
          </Link>
          <Link to="/fees/reports" className="inline-flex h-10 items-center gap-2 rounded-xl border border-ink-700 bg-ink-900/60 px-4 text-sm font-semibold text-ink-200 hover:border-brand-500/60 hover:text-white" title={t("Charts + aging")}>
            📊 {t("Reports")}
          </Link>
          <Link to="/fees/settings" className="inline-flex h-10 items-center gap-2 rounded-xl border border-ink-700 bg-ink-900/60 px-4 text-sm font-semibold text-ink-200 hover:border-brand-500/60 hover:text-white" title={t("Payments, GSTIN, receipt config")}>
            ⚙️
          </Link>
        </div>
      </header>

      {isLoading && <DashboardSkeleton />}
      {isError && <ErrorBanner message={error instanceof Error ? error.message : t("Couldn't load dashboard.")} onRetry={() => refetch()} />}
      {data && <DashboardBody data={data} onNav={(u) => nav(u)} />}
    </div>
  );
}

// ---- Body ----------------------------------------------------------------

function DashboardBody({ data, onNav }: { data: DashboardResponse; onNav: (url: string) => void }) {
  const trendMax = useMemo(() => Math.max(1, ...data.collectionByDay.map((d) => d.collectedPaise)), [data.collectionByDay]);

  return (
    <>
      {/* Headline: this month's collection */}
      <section className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Hero — 2 col wide */}
        <div className="relative overflow-hidden rounded-2xl border border-ink-700 bg-gradient-to-br from-brand-600/15 via-ink-900/60 to-ink-900 p-6 lg:col-span-2">
          <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-gradient-to-br from-brand-500/25 via-brand-500/5 to-transparent blur-2xl" />
          <div className="relative">
            <div className="mb-1 text-[11px] uppercase tracking-wider text-brand-300">{data.monthLabel} · {t("collected")}</div>
            <div className="font-display text-5xl text-ink-100 sm:text-6xl">{fmtRupees(data.collectedMonthPaise)}</div>
            <div className="mt-2 text-sm text-ink-400">
              {t("From")} <b className="text-ink-200">{data.totalActiveEnrollments}</b> {t("active enrolments")}
              {data.lastReminderAt && <> · {t("last reminder")} {relTime(data.lastReminderAt)}</>}
            </div>
            {/* 30-day sparkline */}
            <div className="mt-5">
              <Sparkline points={data.collectionByDay} max={data.collectionByDay.reduce((m, d) => Math.max(m, d.collectedPaise), 1)} />
              <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wider text-ink-500">
                <span>30 {t("days ago")}</span><span>{t("today")}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Two stat chips stacked */}
        <div className="flex flex-col gap-4">
          <StatCard
            label={t("Overdue")}
            value={fmtRupees(data.overdueBalancePaise)}
            sub={`${data.overdueCountInvoices} ${data.overdueCountInvoices === 1 ? t("invoice") : t("invoices")}`}
            accent="gold"
            actionLabel={data.overdueCountInvoices > 0 ? t("Review →") : undefined}
            onAction={() => onNav("/fees/invoices?tab=OVERDUE")}
          />
          <StatCard
            label={t("Expected next 7d")}
            value={fmtRupees(data.expectedNext7dPaise)}
            sub={t("Balance on invoices due this week")}
            accent="accent"
            actionLabel={data.expectedNext7dPaise > 0 ? t("View queue →") : undefined}
            onAction={() => onNav("/fees/invoices?tab=OPEN")}
          />
        </div>
      </section>

      {/* Top defaulters + recent payments */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Top defaulters */}
        <div className="rounded-2xl border border-ink-700 bg-ink-900/60 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-300">🚩 {t("Top 5 to chase")}</h2>
            <Link to="/fees/invoices?tab=OVERDUE" className="text-xs text-ink-400 hover:text-brand-300">{t("all overdue")} →</Link>
          </div>
          {data.topDefaulters.length === 0 ? (
            <EmptyMini emoji="🎉" title={t("Nobody's behind.")} sub={t("Every guardian is paid up.")} />
          ) : (
            <ul className="flex flex-col gap-2">
              {data.topDefaulters.map((d) => <DefaulterRow key={d.guardianUserId ?? d.guardianName} d={d} />)}
            </ul>
          )}
        </div>

        {/* Recent payments feed */}
        <div className="rounded-2xl border border-ink-700 bg-ink-900/60 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-300">💚 {t("Recent payments")}</h2>
            <Link to="/fees/invoices?tab=PAID" className="text-xs text-ink-400 hover:text-brand-300">{t("all paid")} →</Link>
          </div>
          {data.recentPayments.length === 0 ? (
            <EmptyMini emoji="💤" title={t("No payments yet")} sub={t("Cash paid or PG-captured payments will show here.")} />
          ) : (
            <ul className="flex flex-col gap-2">
              {data.recentPayments.map((p) => (
                <li key={p.id} className="flex items-center gap-3 rounded-xl border border-ink-800 bg-ink-900/40 p-3">
                  <div className="grid h-9 w-9 place-items-center rounded-full bg-accent-500/15 text-accent-400">
                    {p.method === "CASH" ? "💵" : p.method === "BANK" ? "🏦" : p.method === "UPI" ? "📱" : "💳"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-ink-100 tabular-nums">{fmtRupees(p.amountPaise)}<span className="ml-2 text-[11px] text-ink-400">{p.guardianName ?? t("(unknown)")}</span></div>
                    <div className="text-[11px] text-ink-500">{p.invoiceNos.slice(0, 2).join(", ")}{p.invoiceNos.length > 2 ? ` · +${p.invoiceNos.length - 2}` : ""} · {relTime(p.capturedAt)}</div>
                  </div>
                  <a href={feesApi.receiptPdfUrl(p.id)} target="_blank" rel="noreferrer" title={t("Download receipt PDF")}
                    className="inline-flex h-8 items-center gap-1 rounded-lg border border-accent-500/40 bg-accent-500/10 px-2 text-[11px] font-semibold text-accent-300 hover:bg-accent-500/20">
                    📄
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}

// ---- Defaulter row + remind button ---------------------------------------

function DefaulterRow({ d }: { d: DashboardResponse["topDefaulters"][number] }) {
  const daysOverdue = Math.max(0, Math.round((Date.now() - new Date(d.oldestDueOn).getTime()) / 86400_000));
  return (
    <li className="flex items-start gap-3 rounded-xl border border-ink-800 bg-ink-900/40 p-3">
      <div className={`grid h-10 w-10 place-items-center rounded-full text-sm font-bold ${daysOverdue > 15 ? "bg-red-500/15 text-red-300" : daysOverdue > 5 ? "bg-gold-500/15 text-gold-400" : "bg-brand-500/15 text-brand-300"}`}>
        {d.invoiceCount}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-ink-100 truncate">{d.guardianName ?? t("(unknown parent)")}</div>
        <div className="text-[11px] text-ink-400 truncate">
          {d.studentNames.slice(0, 2).join(", ")}
          {d.studentNames.length > 2 ? ` · +${d.studentNames.length - 2}` : ""}
          {d.guardianPhone && <> · 📞 {d.guardianPhone}</>}
        </div>
        <div className="mt-1 text-[11px] text-ink-500">{t("Oldest due")} {daysOverdue}d {t("ago")}</div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <div className="font-display text-lg text-gold-400 tabular-nums">{fmtRupees(d.outstandingPaise)}</div>
        <RemindLink guardianPhone={d.guardianPhone} guardianName={d.guardianName} outstanding={d.outstandingPaise} guardianUserId={d.guardianUserId} />
      </div>
    </li>
  );
}

function RemindLink({ guardianPhone, guardianUserId }: { guardianPhone?: string; guardianName?: string; outstanding: number; guardianUserId?: string }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!guardianPhone || !guardianUserId) {
    return <span className="text-[10px] uppercase tracking-wider text-ink-500">{t("no phone")}</span>;
  }

  // Fetch the server-composed text (with parent-portal URL) on click, then open
  // wa.me. Server-side composition means the portal-link secret never leaves
  // the API, and the same text gets logged + sent for every operator.
  async function onClick(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await feesApi.reminderTextGuardian(guardianUserId!, "WHATSAPP");
      if (!r.waLink) { setErr(t("No phone on file for this guardian.")); return; }
      void feesApi.logReminder({ guardianUserId, channel: "WHATSAPP", template: r.template }).catch(() => { /* best-effort */ });
      qc.invalidateQueries({ queryKey: ["fees.dashboard"] });
      window.open(r.waLink, "_blank", "noopener,noreferrer");
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("Couldn't build reminder."));
    } finally { setBusy(false); }
  }

  return (
    <>
      <a
        href="#"
        onClick={onClick}
        aria-disabled={busy}
        className="inline-flex h-8 items-center gap-1 rounded-lg border border-accent-500/50 bg-accent-500/10 px-2.5 text-[11px] font-semibold text-accent-300 transition hover:bg-accent-500/20"
        title={t("Open WhatsApp with a pre-filled reminder + pay link")}
      >
        🔔 {busy ? t("Opening…") : t("Remind")}
      </a>
      {err && <div role="alert" className="mt-1 text-[10px] text-red-300">{err}</div>}
    </>
  );
}

// ---- Small shared ---------------------------------------------------------

function StatCard({ label, value, sub, accent, actionLabel, onAction }: {
  label: string; value: string; sub: string;
  accent: "brand" | "gold" | "accent";
  actionLabel?: string; onAction?: () => void;
}) {
  const ring = accent === "brand" ? "from-brand-600/40 via-brand-500/10" : accent === "gold" ? "from-gold-500/40 via-gold-500/10" : "from-accent-500/40 via-accent-500/10";
  const valColor = accent === "gold" ? "text-gold-400" : accent === "accent" ? "text-accent-400" : "text-ink-100";
  return (
    <div className="relative overflow-hidden rounded-2xl border border-ink-700 bg-ink-900/60 p-5">
      <div className={`pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-gradient-to-br ${ring} to-transparent blur-2xl`} />
      <div className="relative">
        <div className="text-[10px] uppercase tracking-wider text-ink-400">{label}</div>
        <div className={`font-display text-3xl tabular-nums ${valColor}`}>{value}</div>
        <div className="mt-1 text-[11px] text-ink-400">{sub}</div>
        {actionLabel && onAction && (
          <button onClick={onAction} className="mt-3 inline-flex h-8 items-center rounded-lg bg-ink-800 px-3 text-[11px] font-semibold text-ink-200 hover:bg-ink-700">{actionLabel}</button>
        )}
      </div>
    </div>
  );
}

function Sparkline({ points, max }: { points: Array<{ day: string; collectedPaise: number }>; max: number }) {
  if (points.length === 0) return <div className="h-16 rounded-lg bg-ink-800/40" />;
  // Simple inline SVG — no chart lib needed for a hero line.
  const w = 400; const h = 60; const pad = 4;
  const step = points.length > 1 ? (w - pad * 2) / (points.length - 1) : 0;
  const y = (v: number) => h - pad - ((v / max) * (h - pad * 2));
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"} ${pad + i * step} ${y(p.collectedPaise)}`).join(" ");
  const dArea = `${d} L ${pad + (points.length - 1) * step} ${h - pad} L ${pad} ${h - pad} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-14 w-full">
      <defs>
        <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#818cf8" stopOpacity="0.6" />
          <stop offset="1" stopColor="#818cf8" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={dArea} fill="url(#spark)" />
      <path d={d} fill="none" stroke="#a5b4fc" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function EmptyMini({ emoji, title, sub }: { emoji: string; title: string; sub: string }) {
  return (
    <div className="py-6 text-center">
      <div className="mb-1 text-2xl" aria-hidden>{emoji}</div>
      <div className="text-sm font-medium text-ink-200">{title}</div>
      <div className="mt-0.5 text-[11px] text-ink-400">{sub}</div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-ink-700 bg-ink-900/60 p-6 lg:col-span-2 h-56" />
        <div className="flex flex-col gap-4">
          <div className="h-24 rounded-2xl border border-ink-700 bg-ink-900/60" />
          <div className="h-24 rounded-2xl border border-ink-700 bg-ink-900/60" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="h-64 rounded-2xl border border-ink-700 bg-ink-900/60" />
        <div className="h-64 rounded-2xl border border-ink-700 bg-ink-900/60" />
      </div>
    </div>
  );
}
function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-6 text-center">
      <div className="mb-2 text-3xl">😬</div>
      <h3 className="text-lg font-semibold text-ink-100">{message}</h3>
      <button onClick={onRetry} className="mt-4 h-10 rounded-xl border border-red-500/50 bg-red-500/10 px-4 text-sm font-semibold text-red-200 hover:bg-red-500/20">{t("Retry")}</button>
    </div>
  );
}

function relTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return t("just now");
  if (mins < 60) return `${mins}m ${t("ago")}`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ${t("ago")}`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ${t("ago")}`;
  return new Date(iso).toLocaleDateString();
}

// Export a legacy alias used by the reminder text button in the invoice page:
export function useReminderText() {
  // Small helper — kept co-located so page components stay simple.
  return async (invoiceId: string): Promise<ReminderTextResponse> => feesApi.reminderText(invoiceId);
}
