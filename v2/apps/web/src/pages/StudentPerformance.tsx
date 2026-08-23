// Coach-facing performance dashboard for a single student.
// Route: /academy/students/:studentId/performance
//
// Reuses the parent-report metric bundle (ReportData from
// /api/parent-reports/preview) but presents it as a live coach dashboard
// — no edit, no send, no save. The purpose is "who needs my attention
// this week": rating trend, attendance heatmap, top weaknesses, recent
// activity. When the coach decides to also send a parent writeup, the
// "Generate parent report" CTA jumps to /coach-board/reports/new/:id.
import { useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, get } from "../lib/api";
import { parentReportsApi, type ReportData } from "../lib/parent-reports-api";
import { PeriodPerformanceTable } from "../components/PeriodPerformanceTable";
import { TrainerStatsStrip } from "../components/TrainerStatsStrip";
import { getStudentTrainerRollup, type TrainerRollup } from "../lib/opening-trainer-api";
import { StudentMistakesPanel } from "../components/StudentMistakesPanel";
import { AchievementsGallery } from "../components/AchievementsGallery";

type Student = {
  _id: string;
  name?: string;
  username: string;
  email?: string;
  puzzleRating?: number | null;
  dailyStreakCurrent?: number | null;
  attendedTotal?: number | null;
  attendedThisWeek?: number | null;
  lastAttendedAt?: string | null;
  lastLogin?: string | null;
  // 30-day boolean array — index 0 = 30 days ago, index 29 = today.
  attendance30d?: boolean[];
  coachId?: string | null;
};

/** Absolute date → the 3 period presets we offer (30 / 90 / 365 days back). */
function periodDates(days: number): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  start.setHours(0, 0, 0, 0);
  return { start, end };
}
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }); }
  catch { return "—"; }
}
function daysAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return "never";
  const days = Math.floor((Date.now() - d) / (24 * 60 * 60 * 1000));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/** 90-day attendance calendar heatmap (GitHub-style grid). Each cell = one
 *  IST day, colored by status (present/late/absent/unmarked). Grouped into
 *  weeks (Mon-Sun columns), oldest week left → newest week right. Hover
 *  tooltip shows date + status + reason. Owner ask 2026-08-23. Fetches
 *  /api/academy/attendance/history/:studentId?days=90.
 *
 *  Fallback: if the fetch fails or the endpoint returns empty (fresh student),
 *  falls back to the simple 30-day boolean strip from listStudents. */
function AttendanceCalendar({ studentId, fallback }: { studentId: string; fallback?: boolean[] }) {
  const q = useQuery({
    queryKey: ["attendance-history", studentId, 90],
    queryFn: () => get<{
      ok: boolean;
      days: Array<{ day: string; status: "present" | "late" | "absent" | "unmarked"; source: string; reason: string | null; lateMinutes: number | null; excused?: boolean }>;
      summary30: { present: number; late: number; absent: number; unmarked: number };
      summary: { present: number; late: number; absent: number; unmarked: number };
      currentStreak: number;
    }>(`/api/academy/attendance/history/${encodeURIComponent(studentId)}?days=90`),
    staleTime: 60_000,
  });

  // Fallback to old strip if no data available
  if (!q.data?.ok || !q.data.days?.length) {
    return <AttendanceHeatmap30 days={fallback} />;
  }
  const { days, summary30, summary, currentStreak } = q.data;

  // Group cells into columns of 7 (Mon-Sun). Pad the first column with empty
  // cells so weeks align (day-of-week alignment across the whole grid).
  // Grid renders left→right = oldest week → newest week.
  const firstDate = new Date(days[0]!.day + "T12:00:00");
  const firstDow = (firstDate.getDay() + 6) % 7;   // 0=Mon..6=Sun
  const padded: Array<typeof days[number] | null> = [
    ...Array.from({ length: firstDow }, () => null),
    ...days,
  ];
  const weeks: Array<Array<typeof days[number] | null>> = [];
  for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7));

  const cellColor = (cell: { status: string; excused?: boolean } | undefined | null) => {
    if (!cell) return "bg-ink-800";
    if (cell.status === "present") return "bg-emerald-500";
    if (cell.status === "late") return "bg-amber-400";
    if (cell.status === "absent" && cell.excused) return "bg-purple-500";
    if (cell.status === "absent") return "bg-rose-500";
    return "bg-ink-800";
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-xs font-medium text-ink-400">Last 90 days · attendance calendar</div>
        <div className="flex items-center gap-2 text-xs tabular-nums">
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-300">✅ {summary.present}</span>
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-300">⏰ {summary.late}</span>
          <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-rose-300">❌ {summary.absent}</span>
          {currentStreak > 0 && <span className="rounded-full bg-orange-500/20 px-2 py-0.5 text-orange-300">🔥 {currentStreak}</span>}
        </div>
      </div>
      {/* Grid — weeks are columns (left oldest, right newest) */}
      <div className="flex gap-[3px] overflow-x-auto pb-1">
        {/* Day-of-week labels (Mon Wed Fri) */}
        <div className="flex flex-col gap-[3px] pr-1 pt-[2px] text-[9px] text-ink-500">
          {["", "M", "", "W", "", "F", ""].map((l, i) => (
            <div key={i} className="grid h-3 w-3 place-items-center leading-none">{l}</div>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-[3px]">
            {Array.from({ length: 7 }, (_, di) => {
              const cell = week[di];
              if (!cell) return <div key={di} className="h-3 w-3" />;
              const tip = `${cell.day} · ${cell.excused && cell.status === "absent" ? "excused" : cell.status}${cell.reason ? ` (${cell.reason})` : ""}${cell.lateMinutes ? ` · ${cell.lateMinutes}m` : ""}`;
              return (
                <div key={di} title={tip}
                     className={`h-3 w-3 rounded-sm ${cellColor(cell)}`} />
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] text-ink-500">
        <div className="flex items-center gap-2">
          <span>90d ago</span>
          <span className="text-ink-700">→</span>
          <span>today</span>
        </div>
        <div>
          Last 30d: <b className="text-white tabular-nums">{summary30.present + summary30.late}/{summary30.present + summary30.late + summary30.absent}</b> classes
        </div>
      </div>
    </div>
  );
}

/** Fallback 30-day strip — kept for cases where the /attendance/history
 *  endpoint doesn't yet have data (fresh student, network hiccup). */
function AttendanceHeatmap30({ days }: { days: boolean[] | undefined }) {
  const cells = Array.from({ length: 30 }, (_, i) => (days ?? [])[i] ?? false);
  const attendedCount = cells.filter(Boolean).length;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-medium text-ink-400">Last 30 days · classes attended</div>
        <div className="text-xs tabular-nums text-white">{attendedCount} / 30 days</div>
      </div>
      <div className="flex gap-[3px]">
        {cells.map((on, i) => (
          <div key={i} title={`${29 - i} day${29 - i === 1 ? "" : "s"} ago${on ? " · attended" : ""}`}
            className={`h-6 flex-1 rounded-sm ${on ? "bg-emerald-500/80" : "bg-ink-800"}`} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-ink-500">
        <span>30d ago</span><span>today</span>
      </div>
    </div>
  );
}

// Backwards-compat alias — existing call sites still use <AttendanceHeatmap />
const AttendanceHeatmap = AttendanceHeatmap30;

/** Rating sparkline from the perf.puzzle.re history (oldest→newest).
 *  glicko.ts caps re[] at 12 entries so this is a compact trend, not a
 *  full history — perfect for at-a-glance "is this student climbing?".
 *  Pure inline SVG so the bundle doesn't grow. */
function RatingSparkline({ history, current }: { history: number[] | undefined; current: number | null }) {
  const pts = (history || []).filter((n) => typeof n === "number" && !Number.isNaN(n));
  if (pts.length < 2) {
    return (
      <div className="rounded-lg border border-dashed border-ink-700 bg-ink-900/40 p-3 text-center text-xs text-ink-500">
        {pts.length === 0
          ? "No rating history yet — puzzles need to be solved before a trend appears."
          : "Only one rating point logged — solve more puzzles to see the trend."}
      </div>
    );
  }
  const W = 480, H = 90, PAD = 6;
  const min = Math.min(...pts), max = Math.max(...pts);
  const span = Math.max(1, max - min);
  const stepX = (W - PAD * 2) / (pts.length - 1);
  const yFor = (v: number) => H - PAD - ((v - min) / span) * (H - PAD * 2);
  const path = pts.map((v, i) => `${i === 0 ? "M" : "L"}${(PAD + i * stepX).toFixed(1)},${yFor(v).toFixed(1)}`).join(" ");
  const areaPath = `${path} L${(PAD + (pts.length - 1) * stepX).toFixed(1)},${H - PAD} L${PAD},${H - PAD} Z`;
  const trend = pts[pts.length - 1]! - pts[0]!;
  const trendClr = trend > 0 ? "text-emerald-300" : trend < 0 ? "text-rose-300" : "text-ink-300";
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="text-ink-400">last {pts.length} solves</span>
        <span className={`font-semibold tabular-nums ${trendClr}`}>
          {min} → {max} · {trend >= 0 ? "+" : ""}{trend}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-24 w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="rating-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(99 102 241)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="rgb(99 102 241)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#rating-grad)" />
        <path d={path} fill="none" stroke="rgb(129 140 248)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((v, i) => (
          <circle key={i} cx={PAD + i * stepX} cy={yFor(v)} r={i === pts.length - 1 ? 3 : 1.8}
            fill={i === pts.length - 1 ? "rgb(255 255 255)" : "rgb(165 180 252)"}
            stroke={i === pts.length - 1 ? "rgb(99 102 241)" : "none"} strokeWidth="1.5">
            <title>{v}</title>
          </circle>
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-ink-500">
        <span>oldest</span>
        <span>now {current != null && ` · ${current}`}</span>
      </div>
    </div>
  );
}

/** Big-number stat card. Used across the two grid columns. */
function Stat({ label, value, sub, tone = "brand" }: { label: string; value: string | number; sub?: string; tone?: "brand" | "accent" | "amber" | "rose" | "ink" }) {
  const toneCls: Record<string, string> = {
    brand: "text-brand-200",
    accent: "text-accent-400",
    amber: "text-amber-200",
    rose: "text-rose-200",
    ink: "text-white",
  };
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-900 p-4">
      <div className="text-[11px] font-medium uppercase tracking-wide text-ink-400">{label}</div>
      <div className={`mt-1 font-display text-2xl tabular-nums ${toneCls[tone]}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-500">{sub}</div>}
    </div>
  );
}

/** Top-N horizontal bars. Bar width ∝ count. Used for weaknesses. */
function BarList({ items }: { items: { label: string; count: number }[] }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div className="space-y-2">
      {items.map((i) => (
        <div key={i.label}>
          <div className="mb-0.5 flex items-baseline justify-between text-xs">
            <span className="text-white">{i.label}</span>
            <span className="tabular-nums text-ink-400">{i.count}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-ink-800">
            <div className="h-full rounded-full bg-rose-500/70" style={{ width: `${(i.count / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function StudentPerformancePage() {
  const { studentId = "" } = useParams<{ studentId: string }>();
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const canManage = auth?.loggedIn && (auth.role === "academy_owner" || auth.role === "coach");
  const [periodDays, setPeriodDays] = useState<30 | 90 | 365>(30);

  // Full metric bundle — same shape ParentReport uses. Refetch when the
  // period toggle changes so the numbers actually move.
  const period = useMemo(() => periodDates(periodDays), [periodDays]);
  const reportQ = useQuery({
    queryKey: ["student-perf", studentId, periodDays],
    queryFn: () => parentReportsApi.preview({
      studentId,
      periodStart: period.start.toISOString(),
      periodEnd: period.end.toISOString(),
    }),
    enabled: !!canManage && !!studentId,
  });

  // Roster row for attendance stats + heatmap. Cached so navigating between
  // students doesn't re-hit the endpoint.
  const rosterQ = useQuery({
    queryKey: ["academy-students"],
    queryFn: () => get<Student[]>("/api/academy/students"),
    enabled: !!canManage,
    staleTime: 30_000,
  });
  const student: Student | undefined = rosterQ.data?.find((s) => s._id === studentId);

  // Opening Trainer rollup for this student (rollout step 3 — coach view).
  const trainerRollupQ = useQuery<TrainerRollup | null>({
    queryKey: ["opening-trainer-rollup-for", studentId],
    queryFn: async () => { try { return await getStudentTrainerRollup(studentId); } catch { return null; } },
    enabled: !!canManage && !!studentId,
    staleTime: 60_000,
  });

  if (auth && !auth.loggedIn) return <Navigate to={`/login?back=/academy/students/${encodeURIComponent(studentId)}/performance`} replace />;
  if (auth && !canManage) return (
    <div className="mx-auto max-w-3xl space-y-3 px-3 py-8">
      <div className="rounded border border-amber-500/40 bg-amber-500/10 p-4">
        <div className="text-sm font-semibold text-amber-100">Coach or owner only</div>
        <p className="mt-1 text-xs text-amber-200">Per-student performance dashboards are for academy owners and coaches. Your account is signed in as <b>{auth.role || "a student"}</b>.</p>
      </div>
      <Link to="/dashboard" className="inline-block text-sm text-brand-300 hover:underline">← Your dashboard</Link>
    </div>
  );
  if (reportQ.isLoading) return <div className="mx-auto max-w-5xl px-3 py-8 text-sm text-ink-400">Loading performance…</div>;
  if (reportQ.error || !reportQ.data) {
    const msg = (reportQ.error as any)?.message || "Could not load this student's performance.";
    return (
      <div className="mx-auto max-w-5xl px-3 py-8 space-y-3">
        <div className="rounded border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{String(msg)}</div>
        <Link to="/academy" className="inline-block text-sm text-brand-300 hover:underline">← Academy</Link>
      </div>
    );
  }
  const r: ReportData = reportQ.data;
  const totalGames = r.games.played;
  const winRate = totalGames === 0 ? 0 : Math.round((r.games.won / totalGames) * 100);
  const weaknessesTop = r.weaknesses.slice(0, 6);
  const attendanceCount = (student?.attendance30d ?? []).filter(Boolean).length;
  const flagged =
    (student && attendanceCount === 0) ||
    (r.puzzles.solved === 0 && periodDays >= 30) ||
    ((r.rating.change ?? 0) < -50);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-3 py-6">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-400">Student · performance</div>
          <h1 className="font-display text-2xl text-white">{r.student.name || r.student.username}</h1>
          <div className="mt-1 text-sm text-ink-400">
            @{r.student.username}
            {student?.email && <> · <a href={`mailto:${student.email}`} className="hover:text-brand-300">{student.email}</a></>}
            {flagged && <span className="ml-3 rounded-full bg-rose-500/20 px-2 py-0.5 text-[10px] font-semibold text-rose-200">⚠ Needs attention</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-ink-700 text-xs">
            {[30, 90, 365].map((d) => (
              <button key={d} type="button" onClick={() => setPeriodDays(d as 30 | 90 | 365)}
                className={`px-3 py-1.5 font-medium ${periodDays === d ? "bg-brand-500 text-white" : "bg-ink-900 text-ink-300 hover:bg-ink-800"}`}>
                {d === 365 ? "1 year" : `${d} days`}
              </button>
            ))}
          </div>
          <Link to={`/dashboard?as=${encodeURIComponent(studentId)}`}
            className="rounded-lg border border-brand-500/40 bg-brand-500/10 px-3 py-1.5 text-xs font-semibold text-brand-200 hover:bg-brand-500 hover:text-white"
            title="Open this student's full performance dashboard">
            📊 My performance
          </Link>
          <Link to={`/history?as=${encodeURIComponent(studentId)}`}
            className="rounded-lg border border-fuchsia-500/40 bg-fuchsia-500/10 px-3 py-1.5 text-xs font-semibold text-fuchsia-200 hover:bg-fuchsia-500 hover:text-white"
            title="Open this student's puzzle history">
            🧩 Puzzle history
          </Link>
          <Link to={`/coach-board/reports/new/${encodeURIComponent(studentId)}`}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-500">
            📝 Generate parent report
          </Link>
          <Link to="/academy" className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs font-medium text-ink-300 hover:text-white">← Academy</Link>
        </div>
      </header>

      {/* Top-line stats */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Puzzle rating" value={r.rating.current ?? "—"} sub={r.rating.change != null ? `${r.rating.change >= 0 ? "+" : ""}${r.rating.change} in period` : "no change data"} tone="brand" />
        <Stat label="Puzzles solved" value={r.puzzles.solved} sub={`Streak ${student?.dailyStreakCurrent ?? 0}d`} tone="brand" />
        <Stat label="Games (W-D-L)" value={`${r.games.won}-${r.games.drawn}-${r.games.lost}`} sub={totalGames === 0 ? "no games in period" : `${winRate}% win`} tone="accent" />
        <Stat label="Attendance" value={`${attendanceCount}/30`} sub={`Last: ${daysAgo(student?.lastAttendedAt)}`} tone={attendanceCount === 0 ? "rose" : "accent"} />
      </div>

      {/* Opening Trainer — coach view of the student's drill activity +
          coach-assigned compliance %. Rollout step 3 of the Openings
          Dashboard plan. Hidden when the student has no drills yet AND no
          coach-assigned openings, to keep the page tidy on new students. */}
      {trainerRollupQ.data && (trainerRollupQ.data.totals.allSessions > 0 || trainerRollupQ.data.forcedCompliance) && (
        <TrainerStatsStrip rollup={trainerRollupQ.data} title="Opening Trainer — last 30 days" />
      )}

      {/* Two-col detail grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left column */}
        <div className="space-y-6">
          <section className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
            <h2 className="mb-3 text-sm font-semibold text-white">Attendance calendar</h2>
            <AttendanceCalendar studentId={studentId} fallback={student?.attendance30d} />
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <div className="rounded bg-ink-800 p-2 text-center">
                <div className="text-[10px] text-ink-500">This week</div>
                <div className="mt-0.5 font-semibold text-emerald-200 tabular-nums">{student?.attendedThisWeek ?? 0}</div>
              </div>
              <div className="rounded bg-ink-800 p-2 text-center">
                <div className="text-[10px] text-ink-500">Total ever</div>
                <div className="mt-0.5 font-semibold text-white tabular-nums">{student?.attendedTotal ?? 0}</div>
              </div>
              <div className="rounded bg-ink-800 p-2 text-center">
                <div className="text-[10px] text-ink-500">Last active</div>
                <div className="mt-0.5 font-semibold text-white">{daysAgo(student?.lastLogin || student?.lastAttendedAt)}</div>
              </div>
            </div>
          </section>

          <section className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
            <h2 className="mb-3 text-sm font-semibold text-white">Rating trend</h2>
            <RatingSparkline history={r.rating.history} current={r.rating.current} />
          </section>

          <section className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
            <h2 className="mb-3 text-sm font-semibold text-white">Top weaknesses (from game analyses)</h2>
            {weaknessesTop.length === 0
              ? <div className="text-xs text-ink-500">No analysed games in this period — ask them to run Stockfish analysis on recent games.</div>
              : <BarList items={weaknessesTop.map((w) => ({ label: w.label, count: w.count }))} />}
          </section>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          <section className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
            <h2 className="mb-3 text-sm font-semibold text-white">Studies edited</h2>
            {r.studies.length === 0
              ? <div className="text-xs text-ink-500">No studies touched in this period.</div>
              : (
                <ul className="space-y-1.5 text-sm">
                  {r.studies.slice(0, 8).map((s) => (
                    <li key={s.studyId} className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-white">{s.title || "Untitled"}</span>
                      <span className="shrink-0 tabular-nums text-xs text-ink-400">{s.chapterCount} ch</span>
                    </li>
                  ))}
                  {r.studies.length > 8 && <li className="text-[11px] text-ink-500">+{r.studies.length - 8} more</li>}
                </ul>
              )}
          </section>

          <section className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
            <h2 className="mb-3 text-sm font-semibold text-white">Books in progress</h2>
            {r.books.length === 0
              ? <div className="text-xs text-ink-500">No book activity — assign one from the Books tab.</div>
              : (
                <div className="space-y-2 text-sm">
                  {r.books.map((b) => {
                    const pct = b.totalChapters === 0 ? 0 : Math.round((b.totalDone / b.totalChapters) * 100);
                    return (
                      <div key={b.bookId}>
                        <div className="mb-0.5 flex items-baseline justify-between gap-3">
                          <span className="truncate text-white">{b.title}</span>
                          <span className="shrink-0 tabular-nums text-xs text-ink-400">{b.totalDone}/{b.totalChapters}</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-ink-800"><div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} /></div>
                      </div>
                    );
                  })}
                </div>
              )}
          </section>

          <section className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
            <h2 className="mb-3 text-sm font-semibold text-white">Exam attempts</h2>
            {r.exams.length === 0
              ? <div className="text-xs text-ink-500">No exams taken in this period.</div>
              : (
                <ul className="space-y-1.5 text-sm">
                  {r.exams.map((e) => (
                    <li key={e.examId} className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-white">{e.title}</span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${e.passed ? "bg-emerald-500/20 text-emerald-200" : "bg-rose-500/20 text-rose-200"}`}>
                        {e.scorePct}%
                      </span>
                    </li>
                  ))}
                </ul>
              )}
          </section>

          <section className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
            <h2 className="mb-3 text-sm font-semibold text-white">Revision (spaced repetition)</h2>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><div className="text-[11px] text-ink-400">Longest streak</div><div className="mt-0.5 font-semibold text-amber-200 tabular-nums">{r.revision.longestStreak} days</div></div>
              <div><div className="text-[11px] text-ink-400">Total cards</div><div className="mt-0.5 font-semibold text-white tabular-nums">{r.revision.totalCards}</div></div>
            </div>
          </section>
        </div>
      </div>

      {/* Per-period breakdown — Weekly / Monthly / 3mo / 6mo / 1y / YTD /
          Lifetime. Same metric bundle rendered per row (owner ask 2026-08-18). */}
      <section className="space-y-3">
        <div>
          <h2 className="font-display text-lg text-white">Performance by period</h2>
          <p className="text-xs text-ink-400">Rating, puzzles, games and revision streak for each time window. Δ is the rating change since the earliest of the last 100 solves that fall in the window.</p>
        </div>
        <PeriodPerformanceTable scope={{ kind: "student", studentId }} />
      </section>

      {/* Achievement gallery — real chess-skill milestones. Each unlocked
          badge means the student has trained a pattern (fork/pin/mate) to
          the point it should fire in a real game. */}
      <AchievementsGallery studentId={studentId} />

      {/* Coach reteach queue — puzzles the student got wrong in the same
          period as the top-line stats. Newest miss first with links to
          board editor + trainer. */}
      <StudentMistakesPanel studentId={studentId} studentUsername={r.student.username} periodDays={periodDays} />

      <div className="text-center text-[11px] text-ink-500">
        Period toggle above scopes the top-line stats · the per-period table is fixed to weekly through lifetime.
      </div>
    </div>
  );
}
