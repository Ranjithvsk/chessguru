// Academy-wide performance overview — the "Student performance" tab in
// the Academy nav dropdown. One sortable row per student in the academy,
// with tier (Topper / Average / Challenger), attendance count, rating,
// and a per-row link into that student's full dashboard.
//
// Route: /academy/performance
//
// Data source is a single GET /api/academy/students call (already includes
// puzzleRating, attendance30d, lastAttendedAt) — no per-student fan-out.
// Deeper metrics (delta, puzzles solved, W-D-L) surface when the coach
// clicks into an individual student where the parent-report preview
// endpoint fills them in.
import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, get } from "../lib/api";

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
  attendance30d?: boolean[];
  coachId?: string | null;
};

type Tier = "topper" | "average" | "challenger" | "unrated";
type SortKey = "name" | "rating" | "attendance" | "lastActive" | "tier" | "streak";

/** Assign each rated student a tier RELATIVE to the whole academy roster:
 *  Topper = top 30% by rating, Challenger = bottom 30% (kept motivational
 *  not shaming), everyone else Average. Unrated = no puzzles yet, kept
 *  separate so beginners aren't lumped with challengers. */
function computeTiers(ratings: (number | null | undefined)[]): Tier[] {
  const rated = ratings
    .map((r, i) => ({ r, i }))
    .filter((x) => typeof x.r === "number") as { r: number; i: number }[];
  const out: Tier[] = ratings.map(() => "unrated");
  if (rated.length < 3) { rated.forEach(({ i }) => { out[i] = "average"; }); return out; }
  const sorted = [...rated].sort((a, b) => b.r - a.r);
  const topCut = Math.max(1, Math.floor(sorted.length * 0.3));
  const bottomCut = Math.max(1, Math.floor(sorted.length * 0.3));
  sorted.forEach((x, idx) => {
    if (idx < topCut) out[x.i] = "topper";
    else if (idx >= sorted.length - bottomCut) out[x.i] = "challenger";
    else out[x.i] = "average";
  });
  return out;
}
function tierBadge(t: Tier | undefined): { emoji: string; label: string; cls: string } {
  switch (t) {
    case "topper":     return { emoji: "🏆", label: "Topper",     cls: "bg-amber-500/20 text-amber-200" };
    case "average":    return { emoji: "📊", label: "Average",    cls: "bg-brand-500/20 text-brand-200" };
    case "challenger": return { emoji: "🎯", label: "Challenger", cls: "bg-rose-500/20 text-rose-200" };
    case "unrated":    return { emoji: "•",  label: "Unrated",    cls: "bg-ink-800 text-ink-500" };
    // Defensive fallback — never white-screen if a bad tier value slips through.
    default:           return { emoji: "•",  label: "Unknown",    cls: "bg-ink-800 text-ink-500" };
  }
}
function tierRank(t: Tier): number { return t === "topper" ? 3 : t === "average" ? 2 : t === "challenger" ? 1 : 0; }

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

export default function AcademyPerformancePage() {
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  // Roster endpoint is coach/owner-only. Gate the query on role — a plain
  // logged-in student would 403 and we'd render a confusing error card.
  // Mirrors the `canManage` pattern used in AcademyDashboard.
  const canManage = auth?.loggedIn && (auth.role === "academy_owner" || auth.role === "coach");
  const q = useQuery({
    queryKey: ["academy-students"],
    queryFn: () => get<Student[]>("/api/academy/students"),
    enabled: !!canManage,
    staleTime: 30_000,
  });
  const [needle, setNeedle] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("tier");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [tierFilter, setTierFilter] = useState<Tier | "all">("all");

  const students = q.data ?? [];
  const tiers = useMemo(() => computeTiers(students.map((s) => s.puzzleRating)), [students]);

  const rows = students
    .map((s, i) => {
      const attendanceCount = (s.attendance30d ?? []).filter(Boolean).length;
      return {
        student: s,
        tier: tiers[i] || "unrated",
        attendanceCount,
        lastActive: s.lastAttendedAt || s.lastLogin || null,
      };
    })
    .filter((r) => tierFilter === "all" || r.tier === tierFilter)
    .filter((r) => {
      if (!needle.trim()) return true;
      const n = needle.trim().toLowerCase();
      return `${r.student.name || ""} ${r.student.username} ${r.student.email || ""}`.toLowerCase().includes(n);
    });

  const sorted = [...rows].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    const cmp = (x: number | string | null, y: number | string | null) => {
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
      return String(x).localeCompare(String(y)) * dir;
    };
    switch (sortKey) {
      case "name":       return cmp(a.student.name || a.student.username, b.student.name || b.student.username);
      case "rating":     return cmp(a.student.puzzleRating ?? null, b.student.puzzleRating ?? null);
      case "attendance": return cmp(a.attendanceCount, b.attendanceCount);
      case "lastActive": return cmp(a.lastActive ? new Date(a.lastActive).getTime() : null, b.lastActive ? new Date(b.lastActive).getTime() : null);
      case "tier":       return cmp(tierRank(a.tier), tierRank(b.tier));
      case "streak":     return cmp(a.student.dailyStreakCurrent ?? 0, b.student.dailyStreakCurrent ?? 0);
    }
  });

  const tierCounts = {
    topper:     students.filter((_, i) => tiers[i] === "topper").length,
    average:    students.filter((_, i) => tiers[i] === "average").length,
    challenger: students.filter((_, i) => tiers[i] === "challenger").length,
    unrated:    students.filter((_, i) => tiers[i] === "unrated").length,
  };

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "name" ? "asc" : "desc"); }
  }
  const arrow = (k: SortKey) => (sortKey === k ? (sortDir === "asc" ? "▲" : "▼") : "");

  if (auth && !auth.loggedIn) return <Navigate to="/login?back=/academy/performance" replace />;
  if (auth && !canManage) return (
    <div className="mx-auto max-w-3xl space-y-3 px-3 py-8">
      <div className="rounded border border-amber-500/40 bg-amber-500/10 p-4">
        <div className="text-sm font-semibold text-amber-100">Coach or owner only</div>
        <p className="mt-1 text-xs text-amber-200">This page is for academy owners and coaches. Your account is signed in as <b>{auth.role || "a student"}</b> — ask your academy owner to give you coach access.</p>
      </div>
      <Link to="/dashboard" className="inline-block text-sm text-brand-300 hover:underline">← Your dashboard</Link>
    </div>
  );
  if (q.isLoading) return <div className="mx-auto max-w-6xl px-3 py-8 text-sm text-ink-400">Loading students…</div>;
  if (q.error) return (
    <div className="mx-auto max-w-6xl px-3 py-8 space-y-3">
      <div className="rounded border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{String((q.error as any)?.message || "Could not load academy students.")}</div>
      <Link to="/academy" className="inline-block text-sm text-brand-300 hover:underline">← Academy</Link>
    </div>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-3 py-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-400">Academy · performance</div>
          <h1 className="font-display text-2xl text-white">Student performance</h1>
          <div className="mt-1 text-sm text-ink-400">
            {students.length} student{students.length === 1 ? "" : "s"} · click a row for the full dashboard.
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
            {(["topper","average","challenger","unrated"] as const).map((t) => {
              const b = tierBadge(t); const c = tierCounts[t];
              const on = tierFilter === t;
              return (
                <button key={t} onClick={() => setTierFilter(on ? "all" : t)}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold transition ${b.cls} ${on ? "ring-2 ring-white/30" : "opacity-80 hover:opacity-100"}`}>
                  <span>{b.emoji}</span><span>{b.label}</span><span className="tabular-nums opacity-70">{c}</span>
                </button>
              );
            })}
            {tierFilter !== "all" && (
              <button onClick={() => setTierFilter("all")} className="text-[11px] text-ink-400 hover:text-white">clear filter</button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input value={needle} onChange={(e) => setNeedle(e.target.value)} placeholder="Search…"
            className="w-52 rounded-lg border border-ink-700 bg-ink-900 px-3 py-1.5 text-sm text-white placeholder-ink-500 focus:border-brand-400 focus:outline-none" />
          <Link to="/students" className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs font-medium text-ink-300 hover:text-white">Full roster</Link>
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
              <th className="px-3 py-2 text-right"><button onClick={() => toggleSort("streak")}>Streak {arrow("streak")}</button></th>
              <th className="px-3 py-2 text-right"><button onClick={() => toggleSort("attendance")}>Attend (30d) {arrow("attendance")}</button></th>
              <th className="px-3 py-2 text-left"><button onClick={() => toggleSort("lastActive")}>Last active {arrow("lastActive")}</button></th>
              <th className="px-3 py-2 text-right">Report</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const b = tierBadge(r.tier);
              const s = r.student;
              return (
                <tr key={s._id} className={`border-t border-ink-800 hover:bg-ink-800/40 ${r.tier === "challenger" ? "bg-rose-500/5" : ""}`}>
                  <td className="px-3 py-2">
                    <Link to={`/academy/students/${encodeURIComponent(s._id)}/performance`}
                      className="font-semibold text-white hover:text-brand-300">{s.name || s.username}</Link>
                    <div className="text-xs text-ink-500">@{s.username}</div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${b.cls}`}>
                      <span>{b.emoji}</span><span>{b.label}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-brand-200">{s.puzzleRating ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-amber-200">{s.dailyStreakCurrent ?? 0}</td>
                  <td className="px-3 py-2 text-right">
                    <span className={`tabular-nums ${r.attendanceCount === 0 ? "text-rose-300" : "text-emerald-200"}`}>{r.attendanceCount}</span>
                    <span className="text-ink-500">/30</span>
                  </td>
                  <td className="px-3 py-2 text-ink-400 text-xs">{daysAgo(r.lastActive)}</td>
                  <td className="px-3 py-2 text-right">
                    <Link to={`/academy/students/${encodeURIComponent(s._id)}/performance`}
                      className="rounded-md bg-sky-500/20 px-2 py-1 text-xs font-semibold text-sky-100 hover:bg-sky-500/30">📊 Open</Link>
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-ink-500">
                {students.length === 0 ? "No students yet — add them from the roster page." : "No students match the current filter."}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
