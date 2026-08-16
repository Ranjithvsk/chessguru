// Coach Class Board — the "Monday-morning dashboard".
// Route: /coach-board
//
// Two sections:
//   1. Class-wide weaknesses (auto → "Plan class" for each)
//   2. Student watchlist (traffic-light rows, click → student insights)

import { Link, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { coachBoardApi, type ClassWeakness, type StudentRow } from "../lib/coach-board-api";

const HEALTH_DOT: Record<string, string> = { red: "🔴", amber: "🟡", green: "🟢" };
const HEALTH_STYLES: Record<string, string> = {
  red:   "border-rose-500/50",
  amber: "border-amber-500/50",
  green: "border-emerald-500/40",
};

function fmt(iso: string | null | undefined) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }); }
  catch { return ""; }
}

export default function CoachBoardPage() {
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const q = useQuery({
    queryKey: ["coach-board"],
    queryFn: () => coachBoardApi.board(),
    enabled: !!auth?.loggedIn,
  });

  if (auth && !auth.loggedIn) return <Navigate to="/login?back=/coach-board" replace />;
  if (q.isLoading) return <div className="mx-auto max-w-5xl px-3 py-8 text-sm text-ink-400">Loading class board…</div>;
  if (q.error) return <div className="mx-auto max-w-5xl px-3 py-8">
    <div className="rounded border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{String((q.error as any)?.message || q.error)}</div>
  </div>;
  if (!q.data) return null;

  const d = q.data;
  const red = d.students.filter((s) => s.health === "red").length;
  const amber = d.students.filter((s) => s.health === "amber").length;

  return (
    <div className="mx-auto max-w-6xl px-3 py-6">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-white">Class Board</h1>
          <p className="text-sm text-ink-400">
            {d.studentCount} student{d.studentCount === 1 ? "" : "s"} · {red} needs attention · {amber} watch
          </p>
        </div>
        <Link to="/coach-board/reports" className="rounded-lg border border-ink-700 px-3 py-2 text-xs text-ink-300 hover:bg-ink-800 hover:text-white">
          📄 All reports
        </Link>
      </div>

      {/* Class-wide weaknesses */}
      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-400">📊 Class-wide weaknesses</h2>
        {d.classWeaknesses.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ink-700 p-4 text-center text-sm text-ink-400">
            No weaknesses yet — students need to import + analyze games first.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {d.classWeaknesses.slice(0, 6).map((w) => <ClassWeaknessCard key={w.tag} w={w} classSize={d.studentCount} />)}
          </div>
        )}
      </section>

      {/* Student watchlist */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-400">👥 Student watchlist</h2>
        {d.students.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ink-700 p-6 text-center text-sm text-ink-400">
            No students in your roster yet.
          </div>
        ) : (
          <div className="space-y-2">
            {d.students.map((s) => <StudentCard key={s.userId} s={s} />)}
          </div>
        )}
      </section>
    </div>
  );
}

function ClassWeaknessCard({ w, classSize }: { w: ClassWeakness; classSize: number }) {
  return (
    <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-2xl">🎯</span>
        <div className="flex-1">
          <div className="font-semibold text-white">{w.label}</div>
          <div className="text-xs text-ink-400">
            {w.studentsAffected} of {classSize} student{classSize === 1 ? "" : "s"} — {w.totalOccurrences} total
          </div>
        </div>
      </div>
      <Link to={`/coach-board/plan/${encodeURIComponent(w.tag)}`}
        className="block rounded-lg bg-brand-600 px-3 py-2 text-center text-sm font-semibold text-white hover:bg-brand-500">
        Plan class →
      </Link>
    </div>
  );
}

function StudentCard({ s }: { s: StudentRow }) {
  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-xl border ${HEALTH_STYLES[s.health]} bg-ink-900 p-3`}>
      <Link to={`/insights/students/${encodeURIComponent(s.userId)}`} className="flex flex-1 flex-wrap items-center gap-3 hover:opacity-90">
        <div className="text-2xl">{HEALTH_DOT[s.health]}</div>
        <div className="min-w-[140px] flex-1">
          <div className="font-semibold text-white">{s.name || s.username}</div>
          <div className="text-xs text-ink-500">{s.healthReason}</div>
        </div>
        <div className="grid grid-cols-4 gap-3 text-xs">
          <StatCol label="Games" value={s.gamesAnalyzed} />
          <StatCol label="Blunders" value={s.blunders} color={s.blunders > 0 ? "rose" : undefined} />
          <StatCol label="Revise due" value={s.reviseDueNow} color={s.reviseDueNow > 5 ? "amber" : undefined} />
          <StatCol label="Streak" value={s.reviseStreak} color={s.reviseStreak > 0 ? "emerald" : undefined} />
        </div>
        {s.topWeakness && (
          <div className="hidden lg:block text-xs">
            <div className="text-ink-500">Top weakness</div>
            <div className="text-brand-200">{s.topWeakness.label} ({s.topWeakness.count})</div>
          </div>
        )}
        {s.lastGameAt && <div className="hidden lg:block text-xs text-ink-500">Last game: {fmt(s.lastGameAt)}</div>}
      </Link>
      <Link to={`/coach-board/reports/new/${encodeURIComponent(s.userId)}`}
        title="Generate parent report"
        className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-ink-300 hover:bg-ink-800 hover:text-white">
        📄 Report
      </Link>
    </div>
  );
}

function StatCol({ label, value, color }: { label: string; value: number; color?: "rose" | "amber" | "emerald" }) {
  const cls = color === "rose" ? "text-rose-300" : color === "amber" ? "text-amber-300" : color === "emerald" ? "text-emerald-300" : "text-ink-200";
  return (
    <div className="min-w-[50px] text-center">
      <div className={`text-lg font-bold ${cls}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-ink-500">{label}</div>
    </div>
  );
}
