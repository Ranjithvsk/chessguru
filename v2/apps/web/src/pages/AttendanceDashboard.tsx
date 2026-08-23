// Coach + owner attendance dashboard — fleet overview, per-batch table,
// watchlist of kids needing attention. Owner ask 2026-08-23. Route:
// /academy/attendance/dashboard.
//
// Owner sees byCoach breakdown too; coach sees only their own batches +
// students. Watchlist flags kids with >=3 absences this week, 2 consecutive
// misses, or rate dropped >=20 pts vs prior period.
import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, get } from "../lib/api";

type BatchRow = {
  batchId: string;
  name: string;
  coachId: string;
  coachName: string | null;
  studentCount: number;
  rate: number | null;
  prevRate: number | null;
  delta: number | null;
};
type CoachRow = { coachId: string; coachName: string; studentCount: number; rate: number | null };
type WatchRow = {
  studentId: string;
  name: string;
  coachName: string | null;
  batchNames: string[];
  currentRate: number | null;
  prevRate: number | null;
  rateDelta: number | null;
  recentAbsent: number;
  consecutiveMiss: boolean;
  reasons: string[];
};
type Resp = {
  ok: boolean;
  period: { days: number; from: string; to: string };
  fleet: { totalStudents: number; totalClassDays: number; overallRate: number; perfectCount: number; avgAttended: number };
  byBatch: BatchRow[];
  byCoach: CoachRow[];
  watchlist: WatchRow[];
};

const PERIODS: Array<{ label: string; days: number }> = [
  { label: "7d",   days: 7 },
  { label: "30d",  days: 30 },
  { label: "90d",  days: 90 },
  { label: "365d", days: 365 },
];

function rateColor(rate: number | null): string {
  if (rate == null) return "text-ink-500";
  if (rate >= 90) return "text-emerald-300";
  if (rate >= 75) return "text-lime-300";
  if (rate >= 60) return "text-amber-300";
  return "text-rose-300";
}

function deltaBadge(delta: number | null) {
  if (delta == null || delta === 0) return <span className="text-ink-500">·</span>;
  if (delta > 0) return <span className="text-emerald-300 tabular-nums">↑ {delta}</span>;
  return <span className="text-rose-300 tabular-nums">↓ {Math.abs(delta)}</span>;
}

export default function AttendanceDashboardPage() {
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const [days, setDays] = useState<number>(30);

  const q = useQuery({
    queryKey: ["attendance-dashboard", days],
    queryFn: () => get<Resp>(`/api/academy/attendance/dashboard?days=${days}`),
    enabled: !!auth?.loggedIn && !!auth?.academyId,
    staleTime: 60_000,
  });

  if (auth && !auth.loggedIn) return <Navigate to="/login?back=/academy/attendance/dashboard" replace />;
  if (auth && !auth.academyId) return (
    <div className="mx-auto max-w-lg py-10 text-center">
      <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-6">
        <div className="text-3xl">🏛️</div>
        <h1 className="mt-2 font-display text-xl text-white">Not in an academy</h1>
      </div>
    </div>
  );

  const d = q.data;
  const isOwner = auth?.role === "academy_owner";

  return (
    <div className="relative mx-auto max-w-6xl space-y-5 px-3 py-5">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-3xl">
        <div className="absolute -top-16 left-1/4 h-72 w-72 rounded-full bg-emerald-500/10 blur-[110px]" />
        <div className="absolute top-40 right-0 h-80 w-80 rounded-full bg-teal-500/10 blur-[130px]" />
        <div className="absolute bottom-20 left-0 h-64 w-64 rounded-full bg-fuchsia-500/10 blur-[110px]" />
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-400">Academy · attendance</div>
          <h1 className="font-display text-3xl bg-gradient-to-r from-emerald-300 via-teal-300 to-fuchsia-300 bg-clip-text text-transparent">
            📊 Attendance Dashboard
          </h1>
          <div className="mt-1 text-sm text-ink-400">Fleet trends, per-batch rates, and kids who need a check-in.</div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-ink-700 text-xs">
            {PERIODS.map((p) => (
              <button key={p.days} type="button" onClick={() => setDays(p.days)}
                className={`px-2.5 py-1.5 font-medium transition ${days === p.days ? "bg-emerald-500 text-white" : "bg-ink-900 text-ink-300 hover:bg-ink-800"}`}>
                {p.label}
              </button>
            ))}
          </div>
          <Link to="/academy/attendance" className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500">📋 Mark today →</Link>
          <Link to="/academy" className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs font-medium text-ink-300 hover:text-white">← Academy</Link>
        </div>
      </header>

      {q.isLoading && <div className="py-8 text-center text-sm text-ink-500">Loading dashboard…</div>}
      {q.data && !q.data.ok && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">Failed to load dashboard.</div>}

      {d?.ok && (
        <>
          {/* Fleet cards */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 p-4">
              <div className="text-[11px] uppercase tracking-wide text-emerald-300">Overall rate</div>
              <div className="mt-1 font-display text-3xl font-bold tabular-nums text-emerald-200">{d.fleet.overallRate}%</div>
              <div className="text-[10px] text-ink-500">last {d.period.days} days</div>
            </div>
            <div className="rounded-2xl border border-ink-700 bg-ink-900 p-4">
              <div className="text-[11px] uppercase tracking-wide text-ink-400">Students</div>
              <div className="mt-1 font-display text-3xl font-bold tabular-nums text-white">{d.fleet.totalStudents}</div>
              <div className="text-[10px] text-ink-500">in your scope</div>
            </div>
            <div className="rounded-2xl border border-ink-700 bg-ink-900 p-4">
              <div className="text-[11px] uppercase tracking-wide text-ink-400">Class days</div>
              <div className="mt-1 font-display text-3xl font-bold tabular-nums text-white">{d.fleet.totalClassDays}</div>
              <div className="text-[10px] text-ink-500">marked in period</div>
            </div>
            <div className="rounded-2xl border border-ink-700 bg-ink-900 p-4">
              <div className="text-[11px] uppercase tracking-wide text-ink-400">Avg per class</div>
              <div className="mt-1 font-display text-3xl font-bold tabular-nums text-white">{d.fleet.avgAttended}</div>
              <div className="text-[10px] text-ink-500">attended</div>
            </div>
            <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 to-amber-500/5 p-4">
              <div className="text-[11px] uppercase tracking-wide text-amber-300">Perfect attendance</div>
              <div className="mt-1 font-display text-3xl font-bold tabular-nums text-amber-200">{d.fleet.perfectCount}</div>
              <div className="text-[10px] text-ink-500">students · no misses</div>
            </div>
          </div>

          {/* Watchlist */}
          {d.watchlist.length > 0 && (
            <section className="rounded-2xl border border-rose-500/30 bg-gradient-to-br from-rose-500/5 to-orange-500/5 p-5">
              <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-white">
                <span>⚠️</span>
                <span>Kids who need a check-in</span>
                <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-xs font-semibold text-rose-200">{d.watchlist.length}</span>
              </h2>
              <div className="space-y-2">
                {d.watchlist.map((w) => (
                  <Link key={w.studentId} to={`/academy/students/${encodeURIComponent(w.studentId)}/performance`}
                        className="flex items-center gap-3 rounded-xl border border-ink-800 bg-ink-950/60 p-3 transition hover:border-rose-500/40 hover:bg-ink-900">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="truncate text-sm font-semibold text-white">{w.name}</span>
                        {w.coachName && <span className="text-[10px] text-ink-500">· {w.coachName}</span>}
                        {w.batchNames.length > 0 && <span className="truncate text-[10px] text-ink-500">· {w.batchNames.join(", ")}</span>}
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-1.5">
                        {w.reasons.map((r, i) => (
                          <span key={i} className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            w.consecutiveMiss && r.includes("row") ? "bg-rose-500/30 text-rose-200"
                            : r.includes("this week") ? "bg-orange-500/25 text-orange-200"
                            : "bg-amber-500/20 text-amber-200"
                          }`}>{r}</span>
                        ))}
                      </div>
                    </div>
                    <div className="text-right text-xs">
                      <div className={`font-bold tabular-nums ${rateColor(w.currentRate)}`}>{w.currentRate != null ? `${w.currentRate}%` : "—"}</div>
                      {w.rateDelta != null && w.rateDelta !== 0 && (
                        <div className="mt-0.5">{deltaBadge(w.rateDelta)}</div>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Per-batch table */}
          {d.byBatch.length > 0 && (
            <section className="rounded-2xl border border-ink-700 bg-ink-900 p-5">
              <h2 className="mb-3 text-lg font-bold text-white">🎒 By batch</h2>
              <div className="overflow-hidden rounded-xl border border-ink-800">
                <table className="w-full text-sm">
                  <thead className="bg-ink-950/60 text-[11px] uppercase tracking-wide text-ink-400">
                    <tr>
                      <th className="px-3 py-2 text-left">Batch</th>
                      <th className="px-3 py-2 text-left">Coach</th>
                      <th className="px-3 py-2 text-right">Students</th>
                      <th className="px-3 py-2 text-right">Rate</th>
                      <th className="px-3 py-2 text-right">vs prior</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-800">
                    {d.byBatch.map((b) => (
                      <tr key={b.batchId} className="hover:bg-ink-800/40">
                        <td className="px-3 py-2 font-medium text-white">
                          <Link to={`/academy/batches/${encodeURIComponent(b.batchId)}/performance`} className="hover:text-emerald-300">{b.name}</Link>
                        </td>
                        <td className="px-3 py-2 text-ink-400">{b.coachName || "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink-300">{b.studentCount}</td>
                        <td className={`px-3 py-2 text-right font-bold tabular-nums ${rateColor(b.rate)}`}>{b.rate != null ? `${b.rate}%` : "—"}</td>
                        <td className="px-3 py-2 text-right text-xs">{deltaBadge(b.delta)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Per-coach (owner only) */}
          {isOwner && d.byCoach.length > 0 && (
            <section className="rounded-2xl border border-ink-700 bg-ink-900 p-5">
              <h2 className="mb-3 text-lg font-bold text-white">👨‍🏫 By coach</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {d.byCoach.map((c) => (
                  <div key={c.coachId} className="rounded-xl border border-ink-800 bg-ink-950/60 p-3">
                    <div className="text-sm font-semibold text-white">{c.coachName}</div>
                    <div className="mt-1 flex items-baseline justify-between">
                      <div className="text-[11px] text-ink-500">{c.studentCount} student{c.studentCount === 1 ? "" : "s"}</div>
                      <div className={`font-display text-xl font-bold tabular-nums ${rateColor(c.rate)}`}>{c.rate != null ? `${c.rate}%` : "—"}</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {d.fleet.totalStudents === 0 && (
            <div className="rounded-xl border border-ink-700 bg-ink-900 p-8 text-center text-sm text-ink-400">
              No students in your scope yet. <Link to="/academy" className="text-brand-300 hover:underline">Add students →</Link>
            </div>
          )}
          {d.fleet.totalStudents > 0 && d.byBatch.length === 0 && d.watchlist.length === 0 && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-8 text-center">
              <div className="text-4xl">🎉</div>
              <div className="mt-2 text-sm text-emerald-200">Everyone's showing up — no kids need attention right now.</div>
              <div className="mt-1 text-xs text-ink-500">Fleet rate: <b className="text-white">{d.fleet.overallRate}%</b></div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
