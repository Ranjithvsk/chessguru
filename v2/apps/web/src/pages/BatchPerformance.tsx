// Coach-facing performance overview for an entire batch.
// Route: /academy/batches/:batchId/performance
//
// One row per student in the batch. Columns: rating, delta over period,
// puzzles solved, W-D-L, attendance %, red-flag. Sortable — click a header
// to toggle asc/desc. Row-click jumps to that student's dashboard
// (/academy/students/:id/performance). Data comes from:
//   - GET /api/academy/batches (roster + names)
//   - GET /api/academy/students (attendance rollup + last-active)
//   - N × POST /api/parent-reports/preview (fan-out; useQueries)
// The parallel fan-out keeps the pre-class prep flow fast (~200-500ms for
// a 10-student batch on a warm DB) and needs no new backend endpoint.
import { useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useQueries, useQuery } from "@tanstack/react-query";
import { api, get } from "../lib/api";
import { parentReportsApi, type ReportData } from "../lib/parent-reports-api";

type Student = {
  _id: string;
  name?: string;
  username: string;
  puzzleRating?: number | null;
  attendedTotal?: number | null;
  attendedThisWeek?: number | null;
  lastAttendedAt?: string | null;
  lastLogin?: string | null;
  attendance30d?: boolean[];
  dailyPuzzleStreak?: number | null;
};
type Batch = {
  _id: string;
  name: string;
  coachUserId?: string;
  students: { _id: string; name: string; username: string }[];
};

type SortKey = "name" | "rating" | "delta" | "puzzles" | "attendance" | "games" | "tier";
type Tier = "topper" | "average" | "challenger" | "unrated";
type Row = {
  studentId: string;
  name: string;
  username: string;
  rating: number | null;
  delta: number | null;
  puzzles: number;
  attendanceCount: number;
  games: string; // "W-D-L"
  winRate: number;
  lastActive: string | null;
  flagged: boolean;
  tier: Tier;
  loading: boolean;
  error: string | null;
};

/** Assign each rated student a tier RELATIVE to the batch cohort:
 *  Topper = top ~30% by rating, Challenger = bottom ~30% (the students who
 *  need more coach attention — deliberately not "weaker" so the label is
 *  motivating not shaming), everyone else Average. Unrated students (no
 *  puzzles solved yet) stay in their own bucket. Tiers are peer-relative so
 *  a 1400 in a beginners' batch is a topper while a 1400 in a strong batch
 *  is average.
 */
function computeTiers(ratings: (number | null)[]): Tier[] {
  const rated = ratings
    .map((r, i) => ({ r, i }))
    .filter((x) => typeof x.r === "number") as { r: number; i: number }[];
  const out: Tier[] = ratings.map(() => "unrated");
  if (rated.length < 3) {
    // Too few rated students to split into three tiers meaningfully — call
    // everyone "average" so the coach still sees the metric column populated.
    rated.forEach(({ i }) => { out[i] = "average"; });
    return out;
  }
  const sorted = [...rated].sort((a, b) => b.r - a.r); // highest first
  const topCut = Math.max(1, Math.floor(sorted.length * 0.3));
  const bottomCut = Math.max(1, Math.floor(sorted.length * 0.3));
  sorted.forEach((x, idx) => {
    if (idx < topCut) out[x.i] = "topper";
    else if (idx >= sorted.length - bottomCut) out[x.i] = "challenger";
    else out[x.i] = "average";
  });
  return out;
}
function tierBadge(t: Tier) {
  switch (t) {
    case "topper":  return { emoji: "🏆", label: "Topper",  cls: "bg-amber-500/20 text-amber-200" };
    case "average": return { emoji: "📊", label: "Average", cls: "bg-brand-500/20 text-brand-200" };
    case "challenger":  return { emoji: "🎯", label: "Challenger",  cls: "bg-rose-500/20 text-rose-200" };
    case "unrated": return { emoji: "•",  label: "Unrated", cls: "bg-ink-800 text-ink-500" };
  }
}
function tierRank(t: Tier): number { return t === "topper" ? 3 : t === "average" ? 2 : t === "challenger" ? 1 : 0; }
function TierPill({ tier, count }: { tier: Tier; count: number }) {
  const b = tierBadge(tier);
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${b.cls}`}>
      <span>{b.emoji}</span><span>{b.label}</span><span className="tabular-nums opacity-70">{count}</span>
    </span>
  );
}

function periodDates(days: number): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  start.setHours(0, 0, 0, 0);
  return { start, end };
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

export default function BatchPerformancePage() {
  const { batchId = "" } = useParams<{ batchId: string }>();
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const [periodDays, setPeriodDays] = useState<7 | 30 | 90>(7);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const period = useMemo(() => periodDates(periodDays), [periodDays]);

  const batchesQ = useQuery({
    queryKey: ["academy-batches"],
    queryFn: () => get<Batch[]>("/api/academy/batches"),
    enabled: !!auth?.loggedIn,
    staleTime: 60_000,
  });
  const batch: Batch | undefined = batchesQ.data?.find((b) => b._id === batchId);

  const rosterQ = useQuery({
    queryKey: ["academy-students"],
    queryFn: () => get<Student[]>("/api/academy/students"),
    enabled: !!auth?.loggedIn,
    staleTime: 30_000,
  });
  const rosterById = useMemo(() => new Map((rosterQ.data ?? []).map((s) => [s._id, s])), [rosterQ.data]);

  // Fan out one preview() per student in the batch. React Query batches these
  // so a 10-student batch fires 10 parallel POSTs to /parent-reports/preview.
  // Each query is keyed by (studentId, periodDays) so switching the period
  // toggle refetches cleanly without churning cache from other batches.
  const studentIds = batch?.students.map((s) => s._id) ?? [];
  const reports = useQueries({
    queries: studentIds.map((sid) => ({
      queryKey: ["student-perf", sid, periodDays],
      queryFn: () => parentReportsApi.preview({
        studentId: sid,
        periodStart: period.start.toISOString(),
        periodEnd: period.end.toISOString(),
      }),
      enabled: !!auth?.loggedIn && !!batch,
      staleTime: 30_000,
    })),
  });

  if (auth && !auth.loggedIn) return <Navigate to={`/login?back=/academy/batches/${encodeURIComponent(batchId)}/performance`} replace />;

  // First pass: build rows without tiers so we know each student's rating.
  const preRows = (batch?.students ?? []).map((s, i) => {
    const q = reports[i];
    const roster = rosterById.get(s._id);
    const r: ReportData | undefined = q?.data;
    const attendanceCount = (roster?.attendance30d ?? []).filter(Boolean).length;
    const winRate = r && r.games.played > 0 ? Math.round((r.games.won / r.games.played) * 100) : 0;
    const flagged =
      (attendanceCount === 0) ||
      (r ? r.puzzles.solved === 0 : false) ||
      (r ? (r.rating.change ?? 0) < -50 : false);
    return {
      studentId: s._id,
      name: s.name || s.username,
      username: s.username,
      rating: r?.rating.current ?? roster?.puzzleRating ?? null,
      delta: r?.rating.change ?? null,
      puzzles: r?.puzzles.solved ?? 0,
      attendanceCount,
      games: r ? `${r.games.won}-${r.games.drawn}-${r.games.lost}` : "—",
      winRate,
      lastActive: roster?.lastAttendedAt || roster?.lastLogin || null,
      flagged,
      loading: !!q?.isLoading,
      error: (q?.error as any)?.message ?? null,
    };
  });
  // Tier pass: compute peer-relative topper/average/weaker on the batch
  // cohort's current ratings. Unrated students (no rating yet) stay separate
  // so beginners aren't lumped with weaker performers.
  const tiers = computeTiers(preRows.map((r) => r.rating));
  const rows: Row[] = preRows.map((r, i) => ({ ...r, tier: tiers[i] || "unrated" }));

  const sortedRows = [...rows].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    const cmp = (x: number | string | null, y: number | string | null) => {
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
      return String(x).localeCompare(String(y)) * dir;
    };
    switch (sortKey) {
      case "name":       return cmp(a.name, b.name);
      case "rating":     return cmp(a.rating, b.rating);
      case "delta":      return cmp(a.delta, b.delta);
      case "puzzles":    return cmp(a.puzzles, b.puzzles);
      case "attendance": return cmp(a.attendanceCount, b.attendanceCount);
      case "games":      return cmp(a.games, b.games);
      case "tier":       return cmp(tierRank(a.tier), tierRank(b.tier));
    }
  });

  // Cohort counts for the header pill row.
  const tierCounts = {
    topper:  rows.filter((r) => r.tier === "topper").length,
    average: rows.filter((r) => r.tier === "average").length,
    weaker:  rows.filter((r) => r.tier === "challenger").length,
    unrated: rows.filter((r) => r.tier === "unrated").length,
  };

  const flaggedCount = rows.filter((r) => r.flagged).length;
  const anyLoading = reports.some((q) => q.isLoading);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "name" ? "asc" : "desc"); /* useful default: bigger numbers first */ }
  }
  const arrow = (k: SortKey) => (sortKey === k ? (sortDir === "asc" ? "▲" : "▼") : "");

  if (batchesQ.isLoading) return <div className="mx-auto max-w-6xl px-3 py-8 text-sm text-ink-400">Loading batch…</div>;
  if (!batch) return (
    <div className="mx-auto max-w-6xl px-3 py-8 space-y-3">
      <div className="rounded border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">Batch not found or you don't have access.</div>
      <Link to="/academy" className="inline-block text-sm text-brand-300 hover:underline">← Academy</Link>
    </div>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-3 py-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-400">Batch · performance</div>
          <h1 className="font-display text-2xl text-white">{batch.name}</h1>
          <div className="mt-1 text-sm text-ink-400">
            {batch.students.length} student{batch.students.length === 1 ? "" : "s"}
            {flaggedCount > 0 && <> · <span className="text-rose-300">{flaggedCount} needs attention</span></>}
            {anyLoading && <> · <span className="text-ink-500">loading metrics…</span></>}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {tierCounts.topper > 0   && <TierPill tier="topper"     count={tierCounts.topper}   />}
            {tierCounts.average > 0  && <TierPill tier="average"    count={tierCounts.average}  />}
            {tierCounts.challenger > 0 && <TierPill tier="challenger" count={tierCounts.challenger} />}
            {tierCounts.unrated > 0  && <TierPill tier="unrated"    count={tierCounts.unrated}  />}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-ink-700 text-xs">
            {[7, 30, 90].map((d) => (
              <button key={d} type="button" onClick={() => setPeriodDays(d as 7 | 30 | 90)}
                className={`px-3 py-1.5 font-medium ${periodDays === d ? "bg-brand-500 text-white" : "bg-ink-900 text-ink-300 hover:bg-ink-800"}`}>
                {d} days
              </button>
            ))}
          </div>
          <Link to="/academy" className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs font-medium text-ink-300 hover:text-white">← Academy</Link>
        </div>
      </header>

      <div className="overflow-x-auto rounded-xl border border-ink-700 bg-ink-900/40">
        <table className="min-w-full text-sm">
          <thead className="bg-ink-800/70 text-xs uppercase tracking-wide text-ink-400">
            <tr>
              <th className="px-3 py-2 text-left"><button onClick={() => toggleSort("name")}>Student {arrow("name")}</button></th>
              <th className="px-3 py-2 text-left"><button onClick={() => toggleSort("tier")}>Tier {arrow("tier")}</button></th>
              <th className="px-3 py-2 text-right"><button onClick={() => toggleSort("rating")}>Rating {arrow("rating")}</button></th>
              <th className="px-3 py-2 text-right"><button onClick={() => toggleSort("delta")}>Δ ({periodDays}d) {arrow("delta")}</button></th>
              <th className="px-3 py-2 text-right"><button onClick={() => toggleSort("puzzles")}>Puzzles {arrow("puzzles")}</button></th>
              <th className="px-3 py-2 text-right"><button onClick={() => toggleSort("games")}>W-D-L {arrow("games")}</button></th>
              <th className="px-3 py-2 text-right"><button onClick={() => toggleSort("attendance")}>Attend (30d) {arrow("attendance")}</button></th>
              <th className="px-3 py-2 text-left">Last active</th>
              <th className="px-3 py-2 text-center">Flag</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr key={row.studentId} className={`border-t border-ink-800 hover:bg-ink-800/40 ${row.flagged ? "bg-rose-500/5" : ""}`}>
                <td className="px-3 py-2">
                  <Link to={`/academy/students/${encodeURIComponent(row.studentId)}/performance`}
                    className="font-semibold text-white hover:text-brand-300">{row.name}</Link>
                  <div className="text-xs text-ink-500">@{row.username}</div>
                </td>
                <td className="px-3 py-2">
                  {(() => { const b = tierBadge(row.tier); return (
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${b.cls}`}>
                      <span>{b.emoji}</span><span>{b.label}</span>
                    </span>
                  ); })()}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-brand-200">{row.rating ?? "—"}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${row.delta == null ? "text-ink-500" : row.delta >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                  {row.delta == null ? "—" : `${row.delta >= 0 ? "+" : ""}${row.delta}`}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-white">{row.loading ? "…" : row.puzzles}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ink-300">{row.games}</td>
                <td className="px-3 py-2 text-right">
                  <span className={`tabular-nums ${row.attendanceCount === 0 ? "text-rose-300" : "text-emerald-200"}`}>{row.attendanceCount}</span>
                  <span className="text-ink-500">/30</span>
                </td>
                <td className="px-3 py-2 text-ink-400 text-xs">{daysAgo(row.lastActive)}</td>
                <td className="px-3 py-2 text-center">
                  {row.flagged
                    ? <span title={row.error || "0 attendance / no puzzles / rating drop >50"} className="rounded-full bg-rose-500/20 px-2 py-0.5 text-[10px] font-semibold text-rose-200">⚠</span>
                    : <span className="text-emerald-400">✓</span>}
                </td>
              </tr>
            ))}
            {sortedRows.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-sm text-ink-500">No students in this batch yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="text-center text-[11px] text-ink-500">
        Metrics from live academy data · click any row to drill into that student's dashboard.
      </div>
    </div>
  );
}
