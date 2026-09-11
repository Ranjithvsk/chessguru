import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, Link } from "react-router-dom";
import { api, adminAcademies, adminAcademyDetail } from "../lib/api";
import type { AcademyHealthBand, AdminAcademyFeature, AdminAcademyRow } from "../lib/api";

/* ── Every window on this page is the SAME window ──────────────────────────────
 * "This week" means the last 7 IST calendar days, today included — on the
 * roll-up card, in the sparkline, in the people table and inside every health
 * reason. It is stated in the UI (see WEEK_LABEL) because a number called
 * "this week" that nobody can pin down is worse than no number.
 * Puzzle solves and study solves are two different things and are shown as two
 * different things: the headline is their explicit sum and always carries the
 * breakdown underneath, and they have their own chips and their own bars.
 * ────────────────────────────────────────────────────────────────────────────*/
const WEEK_LABEL = "last 7 days (IST)";

function fmtDate(d?: string | null) {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" }); } catch { return "—"; }
}
function fmtAgo(d?: string | null) {
  if (!d) return "—";
  const t = new Date(d).getTime();
  if (isNaN(t)) return "—";
  const days = Math.floor((Date.now() - t) / 86400000);
  return days <= 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;
}
function fmtNum(n: number) { return n.toLocaleString("en-IN"); }
function fmtRupees(paise: number) { return "₹" + Math.round(paise / 100).toLocaleString("en-IN"); }
function fmtAge(days: number | null) {
  if (days == null) return "—";
  if (days < 31) return `${days}d old`;
  const m = Math.floor(days / 30.44);
  return `${m} month${m === 1 ? "" : "s"} old`;
}
function plural(n: number, one: string, many = one + "s") { return `${n} ${n === 1 ? one : many}`; }

function Card({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-900 p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">{label}</div>
      <div className={`mt-1 font-display text-2xl tabular-nums ${tone ?? "text-white"}`}>{value}</div>
      {sub && <div className="text-xs text-ink-500">{sub}</div>}
    </div>
  );
}

// Colour encodes the health state and nothing else — the same five hues are
// reused for the pill, the sparkline and the card's left edge, so a scan down
// the page reads as one signal rather than decoration.
const HEALTH: Record<AcademyHealthBand, { label: string; pill: string; bar: string; edge: string; ring: string }> = {
  thriving:  { label: "Thriving", pill: "border-emerald-500/40 bg-emerald-500/15 text-emerald-200", bar: "bg-emerald-400", edge: "border-l-emerald-500", ring: "ring-emerald-500/40" },
  growing:   { label: "Growing",  pill: "border-brand-500/40 bg-brand-500/15 text-brand-200",       bar: "bg-brand-400",   edge: "border-l-brand-500",   ring: "ring-brand-500/40" },
  starting:  { label: "Starting", pill: "border-sky-500/40 bg-sky-500/15 text-sky-200",             bar: "bg-sky-400",     edge: "border-l-sky-500",     ring: "ring-sky-500/40" },
  quiet:     { label: "Quiet",    pill: "border-amber-500/40 bg-amber-500/15 text-amber-200",       bar: "bg-amber-400",   edge: "border-l-amber-500",   ring: "ring-amber-500/40" },
  dormant:   { label: "Dormant",  pill: "border-rose-500/40 bg-rose-500/15 text-rose-200",          bar: "bg-rose-400",    edge: "border-l-rose-500",    ring: "ring-rose-500/40" },
  aggregate: { label: "All",      pill: "border-ink-700 bg-ink-800 text-ink-300",                   bar: "bg-ink-500",     edge: "border-l-ink-600",     ring: "ring-ink-600" },
};
const health = (l: AcademyHealthBand) => HEALTH[l] ?? HEALTH.aggregate;

const ROLE_LABEL: Record<string, string> = { academy_owner: "OWNER", coach: "COACH", parent: "PARENT", student: "STUDENT", user: "USER" };
const ROLE_CLASS: Record<string, string> = {
  academy_owner: "bg-brand-500/25 text-brand-200",
  coach: "bg-emerald-500/25 text-emerald-200",
  parent: "bg-amber-500/25 text-amber-200",
};

/** Week-on-week change. Grey inside ±5% so noise doesn't read as a trend. */
function Delta({ now, prev }: { now: number; prev: number }) {
  if (now === 0 && prev === 0) return <span className="text-ink-600">—</span>;
  if (prev === 0) return <span className="text-emerald-300">first week</span>;
  const pct = Math.round(((now - prev) / prev) * 100);
  const cls = pct > 5 ? "text-emerald-300" : pct < -5 ? "text-rose-300" : "text-ink-400";
  return <span className={`tabular-nums ${cls}`}>{pct > 0 ? "+" : ""}{pct}% vs the 7 days before</span>;
}

/** The point of the page: one chip per feature, lit when it has ever been
 *  touched, dim when it never has, and struck out when it cannot apply to this
 *  bucket at all. A row of one lit chip is an academy that bought the product
 *  and only ever opened the puzzle trainer. */
function FeatureStrip({ features }: { features: AdminAcademyFeature[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {features.map((f) => {
        const n = f.count >= 1000 ? Math.round(f.count / 100) / 10 + "k" : String(f.count);
        const extra = f.detail
          ? " · " + Object.entries(f.detail).map(([k, v]) => `${k} ${fmtNum(v)}`).join(", ")
          : "";
        const title = !f.applicable ? `${f.label} — an academy feature, so it does not apply here`
          : f.used ? `${f.label}: ${fmtNum(f.count)} · last used ${fmtAgo(f.lastUsedAt)}${extra}`
          : `${f.label} — never used`;
        return (
          <span key={f.key} title={title}
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${
              !f.applicable ? "bg-ink-900 text-ink-700 line-through"
                : f.used ? "bg-emerald-500/20 text-emerald-200"
                : "bg-ink-800 text-ink-600"}`}>
            {f.label}
            {f.applicable && f.used && f.count > 1 && <span className="ml-1 font-normal tabular-nums opacity-70">{n}</span>}
          </span>
        );
      })}
    </div>
  );
}

/** 30 IST days. Puzzle solves and study solves are stacked as two bars, never
 *  silently added together — the card's headline quotes the same two numbers. */
function Spark({ spark, bar }: { spark: AdminAcademyRow["spark"]; bar: string }) {
  const max = Math.max(1, ...spark.map((p) => p.puzzles + p.studySolves));
  return (
    <div className="flex items-end gap-px" style={{ height: 28 }}>
      {spark.map((p) => {
        const total = p.puzzles + p.studySolves;
        return (
          <div key={p.date} className="flex flex-1 flex-col justify-end"
            title={p.preSignup
              ? `${p.date}: before this academy existed`
              : `${p.date}: ${fmtNum(p.puzzles)} puzzle + ${fmtNum(p.studySolves)} study`}>
            <div className="w-full rounded-t bg-accent-400/70" style={{ height: `${(p.studySolves / max) * 26}px` }} />
            <div className={`w-full ${p.preSignup ? "bg-ink-800" : total > 0 ? bar : "bg-ink-800"}`}
              style={{ height: `${p.preSignup ? 2 : Math.max(p.puzzles > 0 ? 2 : 0, (p.puzzles / max) * 26)}px` }} />
          </div>
        );
      })}
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-ink-700 bg-ink-900 p-4">
      <div className="flex items-center justify-between">
        <div className="h-5 w-44 rounded bg-ink-800" />
        <div className="h-5 w-20 rounded-full bg-ink-800" />
      </div>
      <div className="mt-2 h-3 w-3/4 rounded bg-ink-800/70" />
      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className="h-9 rounded bg-ink-800/70" /><div className="h-9 rounded bg-ink-800/70" /><div className="h-9 rounded bg-ink-800/70" />
      </div>
      <div className="mt-4 h-7 rounded bg-ink-800/70" />
      <div className="mt-4 flex gap-1">
        {Array.from({ length: 9 }).map((_, i) => <div key={i} className="h-4 w-14 rounded bg-ink-800/70" />)}
      </div>
    </div>
  );
}

function AcademyCard({ a, selected, onOpen }: { a: AdminAcademyRow; selected: boolean; onOpen: () => void }) {
  const h = health(a.health.band);
  const staffSilence = a.activity.daysSinceStaffAction;
  const isStandalone = a.kind === "standalone";
  const billed = a.features.find((f) => f.key === "fees")?.detail?.billedPaise ?? 0;
  const exams = a.features.find((f) => f.key === "exams")?.detail;
  return (
    <button type="button" onClick={onOpen}
      className={`w-full rounded-xl border border-l-4 border-ink-700 bg-ink-900 p-4 text-left transition hover:bg-ink-800/40 ${h.edge} ${selected ? `ring-2 ${h.ring}` : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="font-display text-lg text-white">{a.name}</h3>
            {a.isTest && <span className="rounded bg-rose-500/25 px-1 py-0.5 text-[9px] font-bold tracking-wide text-rose-200" title={a.testReason ?? "Detected as a test academy. Shown, never silently dropped."}>TEST</span>}
            {a.isInternal && <span className="rounded bg-ink-700 px-1 py-0.5 text-[9px] font-bold tracking-wide text-ink-300" title="Owned by a platform admin — our own sandbox. Excluded from every customer total on this page and counted separately.">INTERNAL · NOT A CUSTOMER</span>}
            {isStandalone && <span className="rounded bg-ink-700 px-1 py-0.5 text-[9px] font-bold tracking-wide text-ink-300" title="Self-signups on chessguru.cc that belong to no tenant.">NOT AN ACADEMY</span>}
          </div>
          <div className="mt-0.5 text-[11px] text-ink-500">
            {!isStandalone ? <span className="text-ink-400">{a.id}</span> : "chessguru.cc"}
            {a.createdAt && <> · joined {fmtDate(a.createdAt)} · {fmtAge(a.ageDays)}</>}
            {a.plan && <> · {a.plan}</>}
            {a.ownerName && <> · owner {a.ownerName}</>}
          </div>
        </div>
        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${h.pill}`}>{h.label}</span>
      </div>

      <p className="mt-2 text-sm text-ink-300">{a.health.reason}</p>
      {a.dataError && (
        <p className="mt-1 rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-200">
          Partial data — {a.dataError}
        </p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">People</div>
          <div className="font-display text-lg text-white tabular-nums">{fmtNum(a.people.total)}</div>
          <div className="text-[11px] text-ink-500 tabular-nums">
            {isStandalone
              ? "accounts, no tenant"
              : [
                  plural(a.people.students, "student"),
                  `${a.people.coaches + a.people.owners} staff`,
                  a.people.parents ? plural(a.people.parents, "parent") : "",
                  a.people.other ? `${a.people.other} other` : "",
                ].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">Ever signed in</div>
          <div className="font-display text-lg text-white tabular-nums">
            {a.people.total ? `${Math.round((a.people.everLoggedIn / a.people.total) * 100)}%` : "—"}
          </div>
          <div className="text-[11px] text-ink-500 tabular-nums">
            {a.people.total ? `${a.people.neverLoggedIn} never have` : "no accounts"}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-500" title={`Puzzle solves plus study solves over the ${WEEK_LABEL}. The two are also reported separately, right below.`}>
            Solves · {WEEK_LABEL}
          </div>
          <div className="font-display text-lg text-white tabular-nums">{fmtNum(a.activity.solves7d)}</div>
          <div className="text-[11px] text-ink-500 tabular-nums">
            {fmtNum(a.activity.puzzles7d)} puzzle · {fmtNum(a.activity.studySolves7d)} study
          </div>
          <div className="text-[11px]"><Delta now={a.activity.solves7d} prev={a.activity.solvesPrev7d} /></div>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">Active · {WEEK_LABEL}</div>
          <div className="font-display text-lg text-white tabular-nums">{fmtNum(a.activity.activeUsers7d)}</div>
          <div className="text-[11px] text-ink-500 tabular-nums">{a.activity.activeUsersPrev7d} the 7 days before</div>
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">
            Last 30 days <span className="text-ink-600">· ▮ puzzle ▮ study</span>
          </span>
          <span className="text-[10px] text-ink-500 tabular-nums">{plural(a.activity.activeDays30, "active day")}</span>
        </div>
        <Spark spark={a.spark} bar={h.bar} />
      </div>

      <div className="mt-3">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-500">
          Feature adoption <span className="text-ink-600">· {a.featuresUsed} of {a.featuresApplicable} ever used · operational {a.operational.used}/{a.operational.applicable} · individual {a.individual.used}/{a.individual.applicable}</span>
        </div>
        <FeatureStrip features={a.features} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-ink-800 pt-2 text-[11px] text-ink-500">
        {isStandalone ? (
          <>
            <span>No staff, no classes — these accounts belong to no tenant.</span>
            {a.people.orphaned > 0 && (
              <span className="text-amber-300" title="Their academyId points at an academy row that no longer exists. Parked here so they stay visible instead of vanishing from the page.">
                {plural(a.people.orphaned, "account")} from a deleted academy
              </span>
            )}
          </>
        ) : (
          <>
            <span>
              Last staff action{" "}
              <b className={`tabular-nums ${staffSilence == null ? "text-rose-300" : staffSilence >= 14 ? "text-rose-300" : staffSilence >= 7 ? "text-amber-300" : "text-ink-300"}`}>
                {staffSilence == null ? "never" : staffSilence === 0 ? "today" : `${staffSilence}d ago`}
              </b>
            </span>
            <span className="tabular-nums" title="Distinct days with at least one staff-authored artefact, over a window shortened to the academy's own age so a week-old tenant isn't scored for days it did not exist.">
              Staff active {a.activity.staffActionDays}/{a.activity.staffActionWindowDays} days · {a.activity.activeStaff}/{a.activity.staffTotal} staff created something
            </span>
            {billed > 0 && <span className="tabular-nums">Billed <b className="text-ink-300">{fmtRupees(billed)}</b> (none collected yet)</span>}
            {a.people.joinedFromElsewhere > 0 && (
              <span className="text-amber-300 tabular-nums" title="These accounts transferred in from another academy. Everything they did before they arrived is credited to the academy where it happened, not here.">
                {a.people.joinedFromElsewhere} of {a.people.total} transferred in from another academy
              </span>
            )}
            {a.people.departed > 0 && (
              <span className="tabular-nums" title="Accounts that have since left. What they did while they were here still counts here.">
                {plural(a.people.departed, "account")} has left
              </span>
            )}
            {a.activity.vendorActions > 0 && (
              <span className="tabular-nums" title="Artefacts a platform admin (us) created inside this tenant. Excluded from every staff-habit number above.">
                {plural(a.activity.vendorActions, "action")} by us, excluded
              </span>
            )}
            {exams && (exams.attempts ?? 0) > 0 && (exams.attempts ?? 0) === (exams.attemptsByStaff ?? 0) && (
              <span className="text-amber-300 tabular-nums" title="Every attempt at this academy's exams was made by its own staff — a smoke test, not adoption.">
                exam attempts are all staff ({exams.attempts})
              </span>
            )}
            {a.activity.puzzlesBeforeJoining > 0 && (
              <span className="tabular-nums" title="Solves by current members from before they were members here — a personal account predating the academy, or history from the academy they transferred out of. Not counted as this academy's.">
                {fmtNum(a.activity.puzzlesBeforeJoining)} solves predate membership, excluded
              </span>
            )}
          </>
        )}
        <span className="ml-auto text-brand-300">{selected ? "Close ▴" : "Open ▾"}</span>
      </div>
    </button>
  );
}

export default function AdminAcademiesPage() {
  const { data: auth, isLoading: authLoading } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const isAdmin = !!auth?.admin;
  // ONE endpoint: /api/admin/academies. It is also the super-admin academy
  // picker, so it arrives as a bare array in the picker's own order, sentinels
  // first — the attention-first sort is this page's job, below.
  const { data, isLoading, error } = useQuery({ queryKey: ["admin-academies-rollup"], queryFn: adminAcademies, enabled: isAdmin });
  const [sel, setSel] = useState<string | null>(null);
  const { data: detail, isLoading: detailLoading, error: detailError } =
    useQuery({ queryKey: ["admin-academy", sel], queryFn: () => adminAcademyDetail(sel!, { peopleLimit: 500 }), enabled: !!sel && isAdmin });

  const rows = useMemo(() => {
    const list = (data ?? []).filter((r) => r.kind !== "all");
    // Attention first, never alphabetical: real customers ahead of our own
    // sandbox / test shells / the standalone bucket, then the most urgent
    // health, then the longest staff silence, then size.
    return [...list].sort((x, y) =>
      x.health.tier - y.health.tier ||
      x.health.severity - y.health.severity ||
      (y.activity.daysSinceStaffAction ?? 9999) - (x.activity.daysSinceStaffAction ?? 9999) ||
      y.people.total - x.people.total);
  }, [data]);

  // Headline totals are about CUSTOMERS. chess-guru is the vendor's own academy
  // and a test shell is not a tenant, so neither is counted here — both are
  // reported on their own, beside the number they would otherwise inflate.
  const totals = useMemo(() => {
    if (!data?.length) return null;
    const academies = rows.filter((r) => r.kind === "academy");
    const customers = academies.filter((r) => !r.isInternal && !r.isTest);
    const sum = (list: AdminAcademyRow[], f: (r: AdminAcademyRow) => number) => list.reduce((n, r) => n + f(r), 0);
    const standalone = rows.find((r) => r.kind === "standalone");
    return {
      customers: customers.length,
      internal: academies.filter((r) => r.isInternal).length,
      test: academies.filter((r) => r.isTest).length,
      activeThisWeek: customers.filter((r) => r.activity.solves7d > 0 || (r.activity.daysSinceStaffAction ?? 9999) <= 7).length,
      atRisk: customers.filter((r) => r.health.band === "quiet" || r.health.band === "dormant").length,
      students: sum(customers, (r) => r.people.students),
      standaloneUsers: standalone?.people.total ?? 0,
      solves7d: sum(customers, (r) => r.activity.solves7d),
      solvesPrev7d: sum(customers, (r) => r.activity.solvesPrev7d),
      puzzles7d: sum(customers, (r) => r.activity.puzzles7d),
      studySolves7d: sum(customers, (r) => r.activity.studySolves7d),
    };
  }, [data, rows]);

  if (authLoading) return <p className="text-ink-400">Loading…</p>;
  if (auth && !auth.loggedIn) return <Navigate to="/login" replace />;
  if (!isAdmin) return <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-6 text-rose-200">Not authorized — admin only.</div>;

  const maxDay = Math.max(1, ...((detail?.series ?? []).map((d) => d.puzzles + d.studySolves)));

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-2xl text-white">Academies</h1>
          <p className="text-sm text-ink-400">Who is using ChessGuru, and who signed up and went quiet.</p>
        </div>
        <Link to="/admin/users"
          className="inline-flex items-center gap-2 rounded-lg border border-brand-500/40 bg-brand-500/15 px-3 py-2 text-sm font-semibold text-brand-100 hover:bg-brand-500/25"
          title="The same activity broken out one row per user, across every academy">
          Per-user view →
        </Link>
      </div>

      {/* ── Platform totals — CUSTOMERS only ── */}
      <section className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {!totals && isLoading && Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[88px] animate-pulse rounded-xl border border-ink-700 bg-ink-900" />
          ))}
          {totals && <>
            <Card label="Customer academies" value={totals.customers}
              sub={[
                totals.internal ? `${totals.internal} internal (ours)` : "",
                totals.test ? `${totals.test} test` : "",
              ].filter(Boolean).join(" · ") || "no internal or test shells"} />
            <Card label={`Active · ${WEEK_LABEL}`} value={totals.activeThisWeek}
              tone={totals.atRisk > 0 ? "text-amber-200" : "text-white"}
              sub={`solved something or staff acted · ${totals.atRisk} quiet or dormant`} />
            <Card label="Students" value={fmtNum(totals.students)}
              sub={`customers only · +${fmtNum(totals.standaloneUsers)} standalone signups`} />
            <Card label={`Solves · ${WEEK_LABEL}`} value={fmtNum(totals.solves7d)}
              sub={`${fmtNum(totals.puzzles7d)} puzzle + ${fmtNum(totals.studySolves7d)} study · ${fmtNum(totals.solvesPrev7d)} the 7 days before`} />
          </>}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-500">
          <span className="font-semibold uppercase tracking-wide text-ink-400">Health</span>
          {(["dormant", "quiet", "starting", "growing", "thriving"] as AcademyHealthBand[]).map((l) => (
            <span key={l} className="flex items-center gap-1">
              <span className={`inline-block h-2 w-2 rounded-full ${health(l).bar}`} />{health(l).label}
            </span>
          ))}
          <span className="text-ink-600">
            · sorted by who needs attention, not alphabetically · every window is the {WEEK_LABEL} or the last 30 IST days
            · solves are clamped to the day each person joined, so nothing they did elsewhere counts here
          </span>
        </div>
      </section>

      {/* ── One card per academy ── */}
      <section className="space-y-3">
        {error && <p className="text-rose-300">Failed to load academies.</p>}
        <div className="grid gap-4 lg:grid-cols-2">
          {isLoading && Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} />)}
          {rows.map((a) => (
            <AcademyCard key={a.id} a={a} selected={sel === a.id}
              onOpen={() => setSel(sel === a.id ? null : a.id)} />
          ))}
        </div>
        {!isLoading && !error && rows.length === 0 && (
          <div className="rounded-xl border border-ink-700 bg-ink-900 p-8 text-center">
            <p className="text-ink-300">No academies yet.</p>
            <p className="mt-1 text-sm text-ink-500">An academy appears here as soon as someone completes the academy signup — one card per tenant, from their first day.</p>
          </div>
        )}
      </section>

      {/* ── Drill-down ── */}
      {sel && (
        <section className="rounded-xl border border-ink-700 bg-ink-900 p-5">
          {detailError && <p className="text-rose-300">Failed to load this academy.</p>}
          {detailLoading && !detail && (
            <div className="animate-pulse space-y-3">
              <div className="h-6 w-56 rounded bg-ink-800" />
              <div className="h-20 rounded bg-ink-800/70" />
              <div className="h-40 rounded bg-ink-800/70" />
            </div>
          )}
          {detail && (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-lg text-white">
                  {detail.academy.name}{" "}
                  <span className="text-sm text-ink-400">
                    · {plural(detail.people.current, "person", "people")}
                    {detail.people.departed > 0 ? ` + ${detail.people.departed} who left` : ""}
                    {detail.academy.createdAt ? ` · joined ${fmtDate(detail.academy.createdAt)}` : ""}
                    {detail.academy.ownerName ? ` · owner ${detail.academy.ownerName}` : ""}
                  </span>
                </h2>
                <button onClick={() => setSel(null)} className="text-sm text-ink-400 hover:text-white">close</button>
              </div>

              {/* 30-day chart */}
              <div className="rounded-xl border border-ink-700 bg-ink-950/40 p-4">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                  Activity — last 30 days (IST) <span className="text-ink-500">(▮ puzzle ▮ study)</span>
                </div>
                <div className="flex items-end gap-1" style={{ height: 80 }}>
                  {detail.series.map((d) => (
                    <div key={d.date} className="flex flex-1 flex-col justify-end"
                      title={d.preSignup
                        ? `${d.date}: before this academy existed`
                        : `${d.date}: ${d.puzzles} puzzle + ${d.studySolves} study · ${d.activeUsers} active · ${d.created} created (${d.staffActions} by staff)`}>
                      <div className="w-full rounded-t bg-accent-400/70" style={{ height: `${(d.studySolves / maxDay) * 72}px` }} />
                      <div className={`w-full ${d.preSignup ? "bg-ink-800" : "bg-brand-600"}`}
                        style={{ height: `${d.preSignup ? 2 : Math.max(d.puzzles > 0 ? 2 : 0, (d.puzzles / maxDay) * 72)}px` }} />
                    </div>
                  ))}
                </div>
                <div className="mt-1 flex justify-between text-[10px] text-ink-500">
                  <span>{detail.series[0]?.date.slice(5)}</span>
                  <span>today</span>
                </div>
                {detail.series.some((d) => d.preSignup) && (
                  <p className="mt-1 text-[10px] text-ink-600">Grey days are before this academy signed up — those solves belong to the students&apos; personal accounts.</p>
                )}
              </div>

              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                {/* People */}
                <div className="space-y-2">
                  <h3 className="font-display text-white">
                    People <span className="text-sm text-ink-400">({detail.people.current}{detail.people.departed ? ` + ${detail.people.departed} left` : ""})</span>
                  </h3>
                  <div className="max-h-96 overflow-auto rounded-xl border border-ink-700">
                    <table className="w-full text-left text-sm">
                      <thead className="sticky top-0 bg-ink-800 text-ink-300">
                        <tr>
                          <th className="px-3 py-2">Person</th>
                          <th className="px-3 py-2" title="Puzzle rating">Rating</th>
                          <th className="px-3 py-2" title={`Puzzle + study solves over the ${WEEK_LABEL} — the same window as the cards above`}>{WEEK_LABEL}</th>
                          <th className="px-3 py-2" title="Puzzles solved all-time on this account, wherever they were at the time">Lifetime</th>
                          <th className="px-3 py-2" title="Studies this person has created">Studies</th>
                          <th className="px-3 py-2" title="Newest of: a solve, something they created, lastSeen, lastLogin, or their last request (sessions, 30-day horizon)">Last active</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.people.rows.map((p) => (
                          <tr key={p.userId} className={`border-t border-ink-800 ${p.departed ? "opacity-60" : ""}`}>
                            <td className="px-3 py-2 font-medium text-white">
                              {p.username}
                              {p.role && p.role !== "student" && p.role !== "—" && (
                                <span className={`ml-1 rounded px-1 py-0.5 text-[9px] font-bold tracking-wide ${ROLE_CLASS[p.role] ?? "bg-ink-700 text-ink-300"}`}>
                                  {ROLE_LABEL[p.role] ?? p.role.toUpperCase()}
                                </span>
                              )}
                              {p.departed && (
                                <span className="ml-1 rounded bg-ink-700 px-1 py-0.5 text-[9px] font-bold tracking-wide text-ink-300"
                                  title={`Left this academy ${fmtDate(p.departedAt)}. What they did while they were here still counts here.`}>
                                  LEFT
                                </span>
                              )}
                              {!p.departed && p.joinedFromElsewhere && (
                                <span className="ml-1 rounded bg-amber-500/20 px-1 py-0.5 text-[9px] font-bold tracking-wide text-amber-200"
                                  title={`Transferred in from ${p.detachedFrom}. Their lifetime figure is their own account's — the part they earned before arriving is credited to ${p.detachedFrom}, not here.`}>
                                  FROM {p.detachedFrom}
                                </span>
                              )}
                              {p.orphanedAcademyId && (
                                <span className="ml-1 rounded bg-rose-500/20 px-1 py-0.5 text-[9px] font-bold tracking-wide text-rose-200"
                                  title={`Their academyId is "${p.orphanedAcademyId}", which no longer exists. Shown here rather than dropped from the page.`}>
                                  DELETED ACADEMY
                                </span>
                              )}
                              {!p.everLoggedIn && (
                                <span className="ml-1 rounded bg-amber-500/20 px-1 py-0.5 text-[9px] font-bold tracking-wide text-amber-200"
                                  title="Account created but never signed in — most often an undelivered password from a bulk import">
                                  NEVER SIGNED IN
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 tabular-nums text-white">{p.puzzleRating ?? "—"}</td>
                            <td className={`px-3 py-2 tabular-nums ${p.solves7d > 0 ? "text-emerald-300" : "text-ink-500"}`}
                              title={`${p.puzzles7d} puzzle + ${p.studySolves7d} study`}>{p.solves7d}</td>
                            <td className="px-3 py-2 tabular-nums text-ink-400">{fmtNum(p.puzzlesLifetime)}</td>
                            <td className="px-3 py-2 tabular-nums text-ink-400">{p.studiesCreated || "—"}</td>
                            <td className="px-3 py-2 text-ink-400" title={p.lastActivityAt ? fmtDate(p.lastActivityAt) : "no solve, no artefact, no login and no request in the last 30 days"}>
                              {fmtAgo(p.lastActivityAt)}
                            </td>
                          </tr>
                        ))}
                        {detail.people.rows.length === 0 && (
                          <tr><td colSpan={6} className="px-3 py-6 text-center text-ink-400">
                            No accounts. A person appears here once the owner adds them or an invite is accepted.
                          </td></tr>
                        )}
                        {detail.people.rows.length > 0 && detail.people.rows.length < detail.people.total && (
                          <tr><td colSpan={6} className="border-t border-ink-800 px-3 py-2 text-center text-[11px] text-amber-300">
                            Showing {fmtNum(detail.people.rows.length)} of {fmtNum(detail.people.total)} — this table is truncated by the server.
                          </td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* What has been created */}
                <div className="space-y-2">
                  <h3 className="font-display text-white">
                    Recently created{" "}
                    <span className="text-sm text-ink-400"
                      title="The total is every artefact this academy has ever created. Bulk rows written by one click are collapsed into one line.">
                      ({detail.createdLines > detail.created.length
                        ? `newest ${detail.created.length} lines of ${fmtNum(detail.createdLines)}`
                        : `${fmtNum(detail.created.length)} lines`} · {fmtNum(detail.createdTotal)} items)
                    </span>
                  </h3>
                  <div className="max-h-96 overflow-auto rounded-xl border border-ink-700">
                    <table className="w-full text-left text-sm">
                      <thead className="sticky top-0 bg-ink-800 text-ink-300">
                        <tr>
                          <th className="px-3 py-2">Kind</th>
                          <th className="px-3 py-2">Title</th>
                          <th className="px-3 py-2">By</th>
                          <th className="px-3 py-2">When</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.created.map((c, i) => (
                          <tr key={`${c.kind}-${c.at}-${i}`} className="border-t border-ink-800 align-top">
                            <td className="px-3 py-2 whitespace-nowrap text-[11px] text-ink-400">{c.kind}</td>
                            <td className="px-3 py-2 text-white">
                              {c.title}
                              {c.count > 1 && <span className="ml-1 rounded bg-ink-700 px-1 py-0.5 text-[10px] font-bold tabular-nums text-ink-300" title="One action that wrote this many rows">×{c.count}</span>}
                              {c.note && <div className="text-[11px] text-ink-500">{c.note}</div>}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap text-ink-400">{c.by ?? "—"}</td>
                            <td className="px-3 py-2 whitespace-nowrap text-ink-500" title={c.at ? fmtDate(c.at) : ""}>{fmtAgo(c.at)}</td>
                          </tr>
                        ))}
                        {detail.created.length === 0 && (
                          <tr><td colSpan={4} className="px-3 py-6 text-center text-ink-400">
                            Nothing has been created here yet — no studies, classes, homework, batches, exams, position packs or invoices.
                          </td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[10px] text-ink-600">
                    Newest first by the row&apos;s own date field. Counts are the real totals, not the size of this page.
                  </p>
                </div>
              </div>

              <p className="mt-3 text-[10px] text-ink-600">
                Built {fmtAgo(detail.generatedAt)} · all day buckets are {detail.timezone} · &quot;this week&quot; is the {WEEK_LABEL}
              </p>
            </>
          )}
        </section>
      )}
    </div>
  );
}
