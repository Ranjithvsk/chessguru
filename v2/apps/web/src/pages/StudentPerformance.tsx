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

/** 30-day attendance strip. Green square = attended a class that day.
 *  Left = 30 days ago; right = today. Renders 30 fixed slots so the row
 *  aligns even when the boolean array is short/missing. */
function AttendanceHeatmap({ days }: { days: boolean[] | undefined }) {
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
    enabled: !!auth?.loggedIn && !!studentId,
  });

  // Roster row for attendance stats + heatmap. Cached so navigating between
  // students doesn't re-hit the endpoint.
  const rosterQ = useQuery({
    queryKey: ["academy-students"],
    queryFn: () => get<Student[]>("/api/academy/students"),
    enabled: !!auth?.loggedIn,
    staleTime: 30_000,
  });
  const student: Student | undefined = rosterQ.data?.find((s) => s._id === studentId);

  if (auth && !auth.loggedIn) return <Navigate to={`/login?back=/academy/students/${encodeURIComponent(studentId)}/performance`} replace />;
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

      {/* Two-col detail grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left column */}
        <div className="space-y-6">
          <section className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
            <h2 className="mb-3 text-sm font-semibold text-white">Attendance heatmap</h2>
            <AttendanceHeatmap days={student?.attendance30d} />
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

      <div className="text-center text-[11px] text-ink-500">
        Period: {fmtDate(r.period.start)} → {fmtDate(r.period.end)} · Data live from your academy's collections.
      </div>
    </div>
  );
}
