// Fees → Program detail (W2)
//
// Single-program workspace: header + heads summary + plan config + enrollments
// table + "Enrol students" modal. This is where an owner does 80 % of the
// day-to-day fee-admin work — every action lives on this one page for W2/W3.
//
// Layout follows the world-class §Design Principles baked in from W1:
//   * All 4 states designed (loading, empty per-section, error, populated)
//   * Every string wrapped in t("…") for M4 react-intl.
//   * ≥ 44 × 44 px touch targets on primary CTAs.
//   * Currency via fmtRupees (Intl.NumberFormat en-IN).

import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type BulkEnrollInput,
  type EnrollmentResponse,
  type FeeBatchPickerRow,
  type PlanCadence,
  type PlanResponse,
  type UpsertPlanInput,
  feesApi,
  fmtRupees,
} from "../lib/fees-api";

const t = (s: string) => s;

const CADENCE_LABELS: Record<PlanCadence, { label: string; hint: string; emoji: string }> = {
  MONTHLY: { label: "Monthly",  hint: "One invoice per month on the day-of-month you pick.", emoji: "🗓️" },
  ONE_OFF: { label: "One-off",  hint: "Single invoice — e.g. summer camp, tournament entry.", emoji: "🎯" },
  TERM:    { label: "Term",     hint: "Fixed instalments across a term (V2).",                  emoji: "🎓" },
  CUSTOM:  { label: "Custom",   hint: "Manual per-invoice schedule (V2).",                       emoji: "✨" },
};

const KIND_META: Record<string, { label: string; emoji: string; ring: string }> = {
  TUITION:  { label: "Tuition",  emoji: "🎓", ring: "ring-brand-400/40 bg-brand-500/10 text-brand-200" },
  EXAM:     { label: "Exam",     emoji: "📝", ring: "ring-gold-400/40 bg-gold-500/10 text-gold-400" },
  BOOK:     { label: "Book",     emoji: "📘", ring: "ring-accent-400/40 bg-accent-500/10 text-accent-400" },
  LATE:     { label: "Late fee", emoji: "⏰", ring: "ring-red-400/40 bg-red-500/10 text-red-300" },
  OTHER:    { label: "Other",    emoji: "✨", ring: "ring-ink-500/40 bg-ink-800/60 text-ink-200" },
};

export default function FeesProgramDetailPage() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [enrolOpen, setEnrolOpen] = useState(false);

  const programQ = useQuery({
    queryKey: ["fees.program", id],
    queryFn: () => feesApi.getProgram(id!),
    enabled: !!id,
  });
  const planQ = useQuery({
    queryKey: ["fees.plan", id],
    queryFn: () => feesApi.getPlan(id!),
    enabled: !!id,
  });
  const enrolQ = useQuery({
    queryKey: ["fees.enrollments", { planId: planQ.data?.plan?.id }],
    queryFn: () => feesApi.listEnrollments({ planId: planQ.data!.plan!.id }),
    enabled: !!planQ.data?.plan?.id,
  });

  if (!id) return null;
  if (programQ.isLoading) return <div className="mx-auto max-w-6xl px-6 py-10"><SkeletonHeader /></div>;
  if (programQ.isError)   return <ErrorBanner message={programQ.error instanceof Error ? programQ.error.message : t("Couldn't load program.")} />;
  const p = programQ.data!;

  const plan = planQ.data?.plan ?? null;
  const enrollments = enrolQ.data?.enrollments ?? [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      {/* ---- Header ---- */}
      <div className="mb-2 flex items-center gap-2 text-xs">
        <button onClick={() => nav("/fees/programs")} className="text-ink-300 hover:text-white">← {t("Programs")}</button>
        <span className="text-ink-500">/</span>
        <span className="text-ink-300 truncate">{p.name}</span>
      </div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ring-1 ${p.status === "ACTIVE" ? "bg-accent-500/15 text-accent-400 ring-accent-400/30" : "bg-ink-800 text-ink-400 ring-ink-700"}`}>
              {p.status === "ACTIVE" ? t("Active") : t("Archived")}
            </span>
            <BatchLink program={p} onSaved={() => qc.invalidateQueries({ queryKey: ["fees.program", id] })} />
          </div>
          <h1 className="font-display text-3xl text-ink-100 sm:text-4xl">{p.name}</h1>
          {p.description && <p className="mt-1 max-w-2xl text-sm text-ink-300">{p.description}</p>}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatChip label={t("Per bill")} value={p.totalPaise > 0 ? fmtRupees(p.totalPaise) : "—"} accent="brand" />
          <StatChip label={t("Heads")}    value={String(p.headCount)}                                 accent="gold" />
          <StatChip label={t("Enrolled")} value={String(enrollments.length)}                          accent="accent" />
        </div>
      </div>

      {/* ---- Heads panel ---- */}
      <section className="mb-6 rounded-2xl border border-ink-700 bg-ink-900/60 p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-300">{t("Fee heads")}</h2>
          <span className="text-xs text-ink-400">{t("Total per bill")} · <b className="text-ink-100">{fmtRupees(p.totalPaise)}</b></span>
        </div>
        {(p.heads ?? []).length === 0 ? (
          <div className="rounded-xl border border-dashed border-ink-700 py-8 text-center text-sm text-ink-400">
            {t("No heads yet — edit this program to add Tuition, Exam etc.")}
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {(p.heads ?? []).map((h) => (
              <li key={h.id} className={`flex items-center gap-2 rounded-xl border border-ink-700 bg-ink-900/40 p-2 pl-3 ${KIND_META[h.kind]?.ring ?? ""}`}>
                <span className="text-lg" aria-hidden>{KIND_META[h.kind]?.emoji ?? "•"}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-ink-100 truncate">{h.name}</div>
                  <div className="text-[11px] uppercase tracking-wider text-ink-400">{KIND_META[h.kind]?.label ?? h.kind}</div>
                </div>
                <div className="font-display text-lg text-ink-100">{fmtRupees(h.amountPaise)}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- Plan config ---- */}
      <PlanPanel programId={p.id} plan={plan} isLoading={planQ.isLoading} onSaved={() => qc.invalidateQueries({ queryKey: ["fees.plan", id] })} />

      {/* ---- Enrollments ---- */}
      <section className="mt-6 rounded-2xl border border-ink-700 bg-ink-900/60 p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-300">{t("Enrolled students")}</h2>
          <div className="flex flex-wrap items-center gap-2">
            {plan && enrollments.length > 0 && (
              <GenerateInvoicesButton planId={plan.id} programId={p.id} />
            )}
            {plan && p.batchId && (
              <BulkEnrolFromBatchButton
                programId={p.id}
                batchName={p.batchName}
                onDone={() => qc.invalidateQueries({ queryKey: ["fees.enrollments"] })}
              />
            )}
            <button
              onClick={() => setEnrolOpen(true)}
              disabled={!plan}
              title={plan ? "" : t("Save a plan first")}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 px-4 text-sm font-semibold text-white shadow-glow transition hover:brightness-110 disabled:opacity-50"
            >
              <span aria-hidden>＋</span>{t("Enrol students")}
            </button>
          </div>
        </div>
        {!plan && (
          <div className="rounded-xl border border-dashed border-ink-700 py-8 text-center text-sm text-ink-400">
            {t("Save a plan above (cadence + start date) before enrolling students.")}
          </div>
        )}
        {plan && enrolQ.isLoading && <div className="py-8 text-center text-sm text-ink-400">{t("Loading…")}</div>}
        {plan && !enrolQ.isLoading && enrollments.length === 0 && (
          <div className="rounded-xl border border-dashed border-ink-700 py-10 text-center">
            <div className="mb-2 text-3xl" aria-hidden>👨‍👩‍👧</div>
            <div className="text-sm font-medium text-ink-200">{t("No one enrolled yet")}</div>
            <div className="mt-1 text-xs text-ink-400">{t("Enrol students in bulk from your academy roster.")}</div>
            <button onClick={() => setEnrolOpen(true)} className="mt-4 inline-flex h-10 items-center rounded-xl bg-brand-500/20 px-4 text-xs font-semibold text-brand-200 hover:bg-brand-500/30">
              {t("Enrol your first students")}
            </button>
          </div>
        )}
        {enrollments.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-ink-400">
                  <th className="pb-2 pr-3 font-medium">{t("Student")}</th>
                  <th className="pb-2 pr-3 font-medium">{t("Parent")}</th>
                  <th className="pb-2 pr-3 font-medium">{t("Discount")}</th>
                  <th className="pb-2 pr-3 font-medium">{t("Since")}</th>
                  <th className="pb-2 font-medium">{t("Status")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {enrollments.map((e) => <EnrollmentRow key={e.id} e={e} onChange={() => qc.invalidateQueries({ queryKey: ["fees.enrollments"] })} />)}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {enrolOpen && plan && (
        <EnrolModal
          planId={plan.id}
          onClose={() => setEnrolOpen(false)}
          onDone={() => { setEnrolOpen(false); qc.invalidateQueries({ queryKey: ["fees.enrollments"] }); }}
        />
      )}
    </div>
  );
}

// ---- Stat chip (mini KPI card) -------------------------------------------

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

// ---- Plan panel (upsert) -------------------------------------------------

function PlanPanel({ programId, plan, isLoading, onSaved }: { programId: string; plan: PlanResponse | null; isLoading: boolean; onSaved: () => void }) {
  const [cadence, setCadence] = useState<PlanCadence>(plan?.cadence ?? "MONTHLY");
  const [dayOfMonth, setDayOfMonth] = useState<number>(plan?.dayOfMonth ?? 1);
  const [dueOffset, setDueOffset] = useState<number>(plan?.dueOffsetDays ?? 10);
  const [startOn, setStartOn] = useState<string>(plan?.startOn ? plan.startOn.slice(0, 10) : todayISO());
  const [endOn, setEndOn] = useState<string>(plan?.endOn ? plan.endOn.slice(0, 10) : "");
  const [lateGrace, setLateGrace] = useState<number>(plan?.lateFeeGraceDays ?? 7);
  const [lateFeeRupees, setLateFeeRupees] = useState<string>(plan?.lateFeeAmountPaise ? String(plan.lateFeeAmountPaise / 100) : "");
  const [err, setErr] = useState<string | null>(null);

  const lateFeePaise = (() => {
    const cleaned = lateFeeRupees.replace(/[₹,\s]/g, "").trim();
    if (!cleaned) return 0;
    const n = Number(cleaned);
    if (!Number.isFinite(n) || n < 0) return -1;
    return Math.round(n * 100);
  })();

  const dirty = useMemo(() => {
    if (!plan) return cadence !== "MONTHLY" || dayOfMonth !== 1 || dueOffset !== 10 || !!endOn || lateGrace !== 7 || startOn !== todayISO() || lateFeePaise > 0;
    return (
      plan.cadence !== cadence ||
      (plan.dayOfMonth ?? 1) !== dayOfMonth ||
      plan.dueOffsetDays !== dueOffset ||
      plan.startOn.slice(0, 10) !== startOn ||
      (plan.endOn?.slice(0, 10) ?? "") !== endOn ||
      plan.lateFeeGraceDays !== lateGrace ||
      (plan.lateFeeAmountPaise ?? 0) !== Math.max(0, lateFeePaise)
    );
  }, [plan, cadence, dayOfMonth, dueOffset, startOn, endOn, lateGrace, lateFeePaise]);

  const save = useMutation({
    mutationFn: (body: UpsertPlanInput) => feesApi.upsertPlan(programId, body),
    onSuccess: () => { setErr(null); onSaved(); },
    onError: (e) => setErr(e instanceof Error ? e.message : t("Couldn't save the plan.")),
  });

  return (
    <section className="rounded-2xl border border-ink-700 bg-ink-900/60 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-300">{t("Plan")}</h2>
        {plan && <span className="text-[11px] text-ink-400">{t("Last updated")} · {new Date(plan.updatedAt).toLocaleDateString()}</span>}
      </div>
      {isLoading ? (
        <div className="py-6 text-center text-sm text-ink-400">{t("Loading…")}</div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {/* Cadence picker */}
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-ink-300">{t("Cadence")}</span>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(Object.keys(CADENCE_LABELS) as PlanCadence[]).map((c) => {
                  const meta = CADENCE_LABELS[c];
                  const on = c === cadence;
                  const soon = c === "TERM" || c === "CUSTOM";
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => !soon && setCadence(c)}
                      disabled={soon}
                      className={`flex flex-col items-start rounded-xl border p-3 text-left transition ${on ? "border-brand-500 bg-brand-500/10 shadow-glow" : "border-ink-700 bg-ink-900/40 hover:border-ink-600"} ${soon ? "opacity-40" : ""}`}
                    >
                      <span className="mb-1 text-lg" aria-hidden>{meta.emoji}</span>
                      <span className="text-sm font-semibold text-ink-100">{meta.label}</span>
                      <span className="text-[11px] text-ink-400">{meta.hint}</span>
                      {soon && <span className="mt-1 text-[10px] uppercase tracking-wider text-ink-500">{t("soon")}</span>}
                    </button>
                  );
                })}
              </div>
            </label>

            {cadence === "MONTHLY" && (
              <label className="block">
                <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-ink-300">{t("Bill on day of month")}</span>
                <input
                  type="number" min={1} max={28}
                  value={dayOfMonth}
                  onChange={(e) => setDayOfMonth(clamp(parseInt(e.target.value || "1", 10), 1, 28))}
                  className="h-11 w-full rounded-xl border border-ink-700 bg-ink-900 px-4 text-sm text-ink-100 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                />
                <span className="mt-1 block text-[11px] text-ink-500">{t("1–28. Feb / short months roll to the last valid day at generation.")}</span>
              </label>
            )}

            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-ink-300">{t("Due days after bill")}</span>
              <input
                type="number" min={0} max={30}
                value={dueOffset}
                onChange={(e) => setDueOffset(clamp(parseInt(e.target.value || "0", 10), 0, 30))}
                className="h-11 w-full rounded-xl border border-ink-700 bg-ink-900 px-4 text-sm text-ink-100 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
              <span className="mt-1 block text-[11px] text-ink-500">{t("Grace before we consider it overdue.")}</span>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-ink-300">{t("Start date")}</span>
              <input type="date" value={startOn} onChange={(e) => setStartOn(e.target.value)} className="h-11 w-full rounded-xl border border-ink-700 bg-ink-900 px-4 text-sm text-ink-100 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-ink-300">{t("End date")} <span className="normal-case text-ink-500">({t("optional")})</span></span>
              <input type="date" value={endOn} onChange={(e) => setEndOn(e.target.value)} className="h-11 w-full rounded-xl border border-ink-700 bg-ink-900 px-4 text-sm text-ink-100 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-ink-300">{t("Late-fee grace")} <span className="normal-case text-ink-500">({t("days")})</span></span>
              <input type="number" min={0} max={30} value={lateGrace} onChange={(e) => setLateGrace(clamp(parseInt(e.target.value || "0", 10), 0, 30))} className="h-11 w-full rounded-xl border border-ink-700 bg-ink-900 px-4 text-sm text-ink-100 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-ink-300">{t("Late fee amount")} <span className="normal-case text-ink-500">({t("optional")})</span></span>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-4 grid place-items-center text-xs text-ink-400">₹</span>
                <input
                  value={lateFeeRupees}
                  onChange={(e) => setLateFeeRupees(e.target.value.replace(/[^\d.,]/g, ""))}
                  inputMode="decimal"
                  placeholder="0"
                  className="h-11 w-full rounded-xl border border-ink-700 bg-ink-900 pl-8 pr-4 text-sm text-ink-100 placeholder:text-ink-500 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                />
              </div>
              <span className="mt-1 block text-[11px] text-ink-500">
                {lateFeePaise > 0
                  ? t(`Auto-added after ${lateGrace} day${lateGrace === 1 ? "" : "s"} past due.`)
                  : t("Leave blank to disable auto late-fee.")}
              </span>
            </label>
          </div>

          {err && <div role="alert" className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{err}</div>}

          <div className="mt-4 flex items-center justify-end gap-2">
            {!plan && <span className="mr-auto text-[11px] text-gold-400">{t("No plan yet — save one before enrolling students.")}</span>}
            <button
              onClick={() => {
                if (lateFeePaise < 0) { setErr(t("Late fee amount must be a positive number.")); return; }
                save.mutate({
                  cadence,
                  dayOfMonth: cadence === "MONTHLY" ? dayOfMonth : undefined,
                  dueOffsetDays: dueOffset,
                  startOn,
                  endOn: endOn || undefined,
                  lateFeeGraceDays: lateGrace,
                  lateFeeAmountPaise: lateFeePaise > 0 ? lateFeePaise : 0,
                });
              }}
              disabled={save.isPending || !dirty && !!plan}
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 px-5 text-sm font-semibold text-white shadow-glow transition hover:brightness-110 disabled:opacity-50"
            >
              {save.isPending ? t("Saving…") : plan ? t("Update plan") : t("Save plan")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

// ---- Enrolment row --------------------------------------------------------

function EnrollmentRow({ e, onChange }: { e: EnrollmentResponse; onChange: () => void }) {
  const pause  = useMutation({ mutationFn: () => feesApi.pauseEnrollment(e.id),  onSuccess: onChange });
  const resume = useMutation({ mutationFn: () => feesApi.resumeEnrollment(e.id), onSuccess: onChange });
  const end    = useMutation({ mutationFn: () => feesApi.endEnrollment(e.id),    onSuccess: onChange });

  const statusChip = e.status === "ACTIVE"
    ? "bg-accent-500/15 text-accent-400 ring-accent-400/30"
    : e.status === "PAUSED"
      ? "bg-gold-500/15 text-gold-400 ring-gold-400/30"
      : "bg-ink-800 text-ink-400 ring-ink-700";

  return (
    <tr className="border-t border-ink-800 text-ink-100">
      <td className="py-2 pr-3">{e.studentName ?? <span className="text-ink-500">—</span>}</td>
      <td className="py-2 pr-3">
        <div>{e.guardianName ?? <span className="text-ink-500">{t("(no parent linked)")}</span>}</div>
        {e.guardianPhone && <div className="text-[11px] text-ink-400">{e.guardianPhone}</div>}
      </td>
      <td className="py-2 pr-3">
        {e.discountPct ? `${e.discountPct}%` : e.discountFlatPaise ? fmtRupees(e.discountFlatPaise) : <span className="text-ink-500">—</span>}
      </td>
      <td className="py-2 pr-3 text-ink-300">{new Date(e.startsOn).toLocaleDateString()}</td>
      <td className="py-2 pr-3"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ring-1 ${statusChip}`}>{e.status.toLowerCase()}</span></td>
      <td className="py-2">
        <div className="flex justify-end gap-1">
          {e.status === "ACTIVE" && (
            <button title={t("Pause")} onClick={() => pause.mutate()} disabled={pause.isPending} className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 hover:bg-ink-800 hover:text-gold-300">⏸</button>
          )}
          {e.status === "PAUSED" && (
            <button title={t("Resume")} onClick={() => resume.mutate()} disabled={resume.isPending} className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 hover:bg-ink-800 hover:text-accent-400">▶</button>
          )}
          {e.status !== "ENDED" && (
            <button title={t("End enrolment")} onClick={() => { if (confirm(t("End this enrolment? Future invoices will not be generated for this student."))) end.mutate(); }} disabled={end.isPending} className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 hover:bg-ink-800 hover:text-red-300">✕</button>
          )}
        </div>
      </td>
    </tr>
  );
}

// ---- Enrol modal ---------------------------------------------------------

function EnrolModal({ planId, onClose, onDone }: { planId: string; onClose: () => void; onDone: (res: { enrolled: number; skipped: number }) => void }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [discountPct, setDiscountPct] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);

  const listQ = useQuery({
    queryKey: ["fees.students-for-enroll", planId],
    queryFn: () => feesApi.studentsForEnroll(planId),
  });

  const students = listQ.data?.students ?? [];
  const filtered = q.trim()
    ? students.filter((s) => `${s.name} ${s.username ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()))
    : students;

  const enrolable = filtered.filter((s) => !s.alreadyEnrolled);
  const allChecked = enrolable.length > 0 && enrolable.every((s) => picked.has(s.id));

  function toggle(id: string) {
    setPicked((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    setPicked((prev) => {
      const n = new Set(prev);
      if (allChecked) enrolable.forEach((s) => n.delete(s.id));
      else            enrolable.forEach((s) => n.add(s.id));
      return n;
    });
  }

  const enrol = useMutation({
    mutationFn: (body: BulkEnrollInput) => feesApi.bulkEnroll(body),
    onSuccess: (res) => onDone(res),
    onError: (e) => setErr(e instanceof Error ? e.message : t("Couldn't enrol.")),
  });

  function submit() {
    setErr(null);
    if (picked.size === 0) { setErr(t("Pick at least one student.")); return; }
    const pct = discountPct.trim() ? Number(discountPct) : undefined;
    if (pct !== undefined && (!Number.isFinite(pct) || pct < 0 || pct > 100)) {
      setErr(t("Discount must be between 0 and 100.")); return;
    }
    enrol.mutate({ planId, studentUserIds: Array.from(picked), discountPct: pct });
  }

  return (
    <div role="dialog" aria-modal className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="relative flex w-full max-w-2xl flex-col rounded-2xl border border-ink-700 bg-ink-950 p-6 shadow-2xl max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="font-display text-xl text-ink-100">{t("Enrol students")}</h2>
            <p className="mt-1 text-sm text-ink-400">{t("Pick from your academy roster. Students already on this plan are greyed out.")}</p>
          </div>
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg bg-ink-800 text-ink-300 hover:bg-ink-700 hover:text-white">✕</button>
        </div>

        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("Search students…")}
            className="h-11 flex-1 rounded-xl border border-ink-700 bg-ink-900 px-4 text-sm text-ink-100 placeholder:text-ink-500 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          />
          <label className="flex items-center gap-2 rounded-xl border border-ink-700 bg-ink-900 px-3 py-2 text-xs text-ink-300 sm:w-56">
            {t("Discount %")}
            <input type="number" min={0} max={100} value={discountPct} onChange={(e) => setDiscountPct(e.target.value)} placeholder="0" className="ml-auto w-16 rounded bg-ink-950/60 px-2 py-1 text-right text-sm text-ink-100 focus:outline-none" />
          </label>
        </div>

        <div className="mb-2 flex items-center justify-between text-xs text-ink-400">
          <label className="inline-flex cursor-pointer items-center gap-2 select-none">
            <input type="checkbox" checked={allChecked} onChange={toggleAll} className="h-4 w-4 rounded border-ink-600 bg-ink-900 accent-brand-500" />
            {allChecked ? t("Unselect all visible") : t("Select all visible")}
          </label>
          <span><b className="text-ink-200">{picked.size}</b> {t("picked")} · {enrolable.length} {t("eligible")}</span>
        </div>

        <div className="mb-4 flex-1 overflow-y-auto rounded-xl border border-ink-700 bg-ink-900/40">
          {listQ.isLoading && <div className="py-10 text-center text-sm text-ink-400">{t("Loading students…")}</div>}
          {listQ.isError && <div className="py-10 text-center text-sm text-red-300">{t("Couldn't load students.")}</div>}
          {!listQ.isLoading && filtered.length === 0 && <div className="py-10 text-center text-sm text-ink-400">{t("No matching students.")}</div>}
          <ul>
            {filtered.map((s) => {
              const checked = picked.has(s.id);
              return (
                <li key={s.id} className={`flex items-center gap-3 border-b border-ink-800 px-3 py-2 last:border-none ${s.alreadyEnrolled ? "opacity-60" : "hover:bg-ink-800/40"}`}>
                  <input type="checkbox" checked={checked} disabled={s.alreadyEnrolled} onChange={() => !s.alreadyEnrolled && toggle(s.id)} className="h-4 w-4 rounded border-ink-600 bg-ink-900 accent-brand-500" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-ink-100 truncate">{s.name}</div>
                    <div className="text-[11px] text-ink-400">{s.username ?? "—"}{s.parentPhone ? ` · 📞 ${s.parentPhone}` : ""}</div>
                  </div>
                  {s.alreadyEnrolled && <span className="rounded-full bg-ink-800 px-2 py-0.5 text-[10px] uppercase tracking-wider text-ink-400">{t("enrolled")}</span>}
                </li>
              );
            })}
          </ul>
        </div>

        {err && <div role="alert" className="mb-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{err}</div>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="h-11 rounded-xl px-4 text-sm font-semibold text-ink-300 hover:bg-ink-800">{t("Cancel")}</button>
          <button onClick={submit} disabled={enrol.isPending} className="inline-flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 px-5 text-sm font-semibold text-white shadow-glow transition hover:brightness-110 disabled:opacity-60">
            {enrol.isPending ? t("Enrolling…") : t("Enrol")}{picked.size > 0 ? ` ${picked.size}` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Small shared bits ---------------------------------------------------

function SkeletonHeader() {
  return (
    <div className="animate-pulse">
      <div className="mb-3 h-4 w-32 rounded bg-ink-700" />
      <div className="mb-2 h-10 w-96 rounded bg-ink-700" />
      <div className="h-4 w-64 rounded bg-ink-800" />
    </div>
  );
}
function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-6 text-center">
        <div className="mb-2 text-3xl">😬</div>
        <h3 className="text-lg font-semibold text-ink-100">{message}</h3>
        <Link to="/fees/programs" className="mt-4 inline-block text-sm text-brand-300 hover:text-white">← {t("back to programs")}</Link>
      </div>
    </div>
  );
}

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

// ---- Generate invoices --------------------------------------------------

function GenerateInvoicesButton({ planId, programId }: { planId: string; programId: string }) {
  const nav = useNavigate();
  const [toast, setToast] = useState<string | null>(null);
  const gen = useMutation({
    mutationFn: () => feesApi.generateInvoices(planId),
    onSuccess: (r) => {
      if (r.created === 0 && r.skipped === 0) {
        setToast(t("Nothing to generate — try again after the plan's start date."));
      } else if (r.created === 0) {
        setToast(t(`Already generated (${r.skipped} skipped as duplicates).`));
      } else {
        setToast(t(`Generated ${r.created} invoice(s)${r.skipped > 0 ? ` · ${r.skipped} already existed` : ""}. Opening…`));
        setTimeout(() => nav(`/fees/invoices?programId=${encodeURIComponent(programId)}`), 900);
      }
    },
    onError: (e) => setToast(e instanceof Error ? e.message : t("Couldn't generate.")),
  });
  return (
    <>
      <button
        onClick={() => gen.mutate()}
        disabled={gen.isPending}
        className="inline-flex h-10 items-center gap-2 rounded-xl border border-accent-500/50 bg-accent-500/10 px-4 text-sm font-semibold text-accent-300 transition hover:bg-accent-500/20 disabled:opacity-50"
        title={t("Generate this period's invoices for every active enrolment")}
      >
        {gen.isPending ? "⏳" : "🧾"} {t("Generate invoices")}
      </button>
      {toast && (
        <div role="status" className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-accent-500/40 bg-ink-950 px-4 py-2 text-sm text-accent-200 shadow-2xl">
          {toast}
          <button onClick={() => setToast(null)} className="ml-2 text-ink-400 hover:text-white">✕</button>
        </div>
      )}
    </>
  );
}

// ---- Batch link chip + inline editor -----------------------------------
// Shown in the page header. Click to attach / change / remove the batch.
// A program's batch is the source-of-students for the one-click "bulk enrol"
// button; changing it doesn't retro-modify existing enrolments.
function BatchLink({ program, onSaved }: { program: { id: string; batchId?: string; batchName?: string }; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {program.batchId ? (
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-full bg-brand-500/10 px-2.5 py-0.5 text-[11px] font-medium text-brand-200 ring-1 ring-brand-400/30 hover:bg-brand-500/20"
          title={t("Click to change the linked batch")}
        >
          <span aria-hidden>👥</span>
          <span className="truncate">{program.batchName ?? t("Batch")}</span>
          <span aria-hidden className="ml-1 text-ink-400">✎</span>
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-ink-600 px-2.5 py-0.5 text-[11px] font-medium text-ink-400 hover:border-brand-400 hover:text-brand-200"
        >
          <span aria-hidden>👥</span>{t("Attach a batch")}
        </button>
      )}
      {open && <BatchPickerModal program={program} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); onSaved(); }} />}
    </>
  );
}

function BatchPickerModal({ program, onClose, onSaved }: { program: { id: string; batchId?: string }; onClose: () => void; onSaved: () => void }) {
  const [batchId, setBatchId] = useState<string>(program.batchId ?? "");
  const [err, setErr] = useState<string | null>(null);
  const batchesQ = useQuery({ queryKey: ["fees.batches"], queryFn: () => feesApi.listBatches(), staleTime: 60_000 });
  const batches: FeeBatchPickerRow[] = batchesQ.data?.batches ?? [];
  const save = useMutation({
    mutationFn: () => feesApi.updateProgram(program.id, { batchId: batchId || null }),
    onSuccess: () => onSaved(),
    onError: (e) => setErr(e instanceof Error ? e.message : t("Couldn't save.")),
  });
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose} role="dialog" aria-modal>
      <div className="w-full max-w-md rounded-2xl border border-ink-700 bg-ink-950 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="font-display text-lg text-ink-100">{t("Link a batch")}</h3>
            <p className="mt-1 text-xs text-ink-400">{t("The program will inherit the batch's roster for one-click enrolment.")}</p>
          </div>
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg bg-ink-800 text-ink-300 hover:bg-ink-700 hover:text-white">✕</button>
        </div>
        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-ink-300">{t("Batch")}</span>
          <select
            value={batchId}
            onChange={(e) => setBatchId(e.target.value)}
            className="h-11 w-full rounded-xl border border-ink-700 bg-ink-900 px-4 text-sm text-ink-100 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          >
            <option value="">{t("— None (academy-wide)")}</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {typeof b.studentCount === "number" ? ` · ${b.studentCount} ${b.studentCount === 1 ? t("student") : t("students")}` : ""}
                {b.coachName ? ` · ${b.coachName}` : ""}
              </option>
            ))}
          </select>
        </label>
        {err && <div role="alert" className="mb-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{err}</div>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="h-11 rounded-xl px-4 text-sm font-semibold text-ink-300 hover:bg-ink-800">{t("Cancel")}</button>
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending || batchId === (program.batchId ?? "")}
            className="inline-flex h-11 items-center rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 px-5 text-sm font-semibold text-white shadow-glow disabled:opacity-50"
          >
            {save.isPending ? t("Saving…") : t("Save")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Bulk enrol from batch (one-click) ---------------------------------
// Only shown when the program has a batch attached. Every student in the
// batch is enrolled in the program's plan; already-enrolled students are
// skipped (idempotent), which is what makes it safe to click even if a
// student was added ad-hoc first.
function BulkEnrolFromBatchButton({ programId, batchName, onDone }: { programId: string; batchName?: string; onDone: () => void }) {
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const bulk = useMutation({
    mutationFn: () => feesApi.bulkEnrollFromBatch(programId, {}),
    onSuccess: (r) => {
      setToast({
        kind: "ok",
        text: r.enrolled > 0
          ? t(`Enrolled ${r.enrolled} from ${r.batchName}${r.skipped > 0 ? ` (${r.skipped} already enrolled)` : ""}.`)
          : r.skipped > 0
            ? t(`Everyone in ${r.batchName} is already enrolled.`)
            : t(`No students in ${r.batchName} yet.`),
      });
      onDone();
    },
    onError: (e) => setToast({ kind: "err", text: e instanceof Error ? e.message : t("Bulk enrolment failed.") }),
  });
  return (
    <>
      <button
        onClick={() => {
          if (!window.confirm(t(`Enrol every student from "${batchName ?? "batch"}" into this program's plan? Already-enrolled students will be skipped.`))) return;
          bulk.mutate();
        }}
        disabled={bulk.isPending}
        className="inline-flex h-10 items-center gap-2 rounded-xl border border-brand-500/50 bg-brand-500/10 px-4 text-sm font-semibold text-brand-200 transition hover:bg-brand-500/20 disabled:opacity-50"
        title={batchName ? t(`One-click: enrol everyone in ${batchName}`) : t("Enrol everyone in the linked batch")}
      >
        {bulk.isPending ? "⏳" : "👥"} {t("Enrol from batch")}
      </button>
      {toast && (
        <div role="status" className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl border px-4 py-2 text-sm shadow-2xl ${toast.kind === "ok" ? "border-accent-500/40 bg-ink-950 text-accent-200" : "border-red-500/40 bg-ink-950 text-red-200"}`}>
          {toast.text}
          <button onClick={() => setToast(null)} className="ml-2 text-ink-400 hover:text-white">✕</button>
        </div>
      )}
    </>
  );
}
