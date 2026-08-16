// Exams — two sections in one page: exams I OWN + exams ASSIGNED to me.
// Route: /exams

import { Link, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { examsApi, type ExamListEntry } from "../lib/exams-api";

const STATUS_BADGE: Record<string, string> = {
  draft:     "bg-ink-800 text-ink-300",
  published: "bg-emerald-500/20 text-emerald-200",
  closed:    "bg-ink-800 text-ink-500",
};

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }); }
  catch { return ""; }
}

export default function ExamsListPage() {
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const q = useQuery({
    queryKey: ["exams"],
    queryFn: () => examsApi.list(),
    enabled: !!auth?.loggedIn,
  });

  if (auth && !auth.loggedIn) return <Navigate to="/login?back=/exams" replace />;

  const owned = q.data?.owned ?? [];
  const assigned = q.data?.assigned ?? [];

  return (
    <div className="mx-auto max-w-5xl px-3 py-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl text-white">Exams</h1>
          <p className="text-sm text-ink-400">Coach: test what students remember. Student: take assigned exams.</p>
        </div>
        <Link to="/exams/new"
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 shadow-glow">
          + New exam
        </Link>
      </div>

      {q.isLoading && <div className="text-sm text-ink-400">Loading…</div>}
      {q.error && <div className="rounded border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{String((q.error as any)?.message || q.error)}</div>}

      {/* Assigned (student POV) */}
      {assigned.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-400">Assigned to me</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {assigned.map((e) => <AssignedCard key={e._id} e={e} />)}
          </div>
        </section>
      )}

      {/* Owned (coach POV) */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-400">My exams</h2>
        {owned.length === 0 ? (
          <div className="rounded-xl2 border border-dashed border-ink-700 bg-ink-900/50 p-8 text-center">
            <div className="mb-2 text-4xl">📝</div>
            <div className="mb-4 text-white">No exams yet.</div>
            <Link to="/exams/new" className="inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500">
              Create your first exam
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {owned.map((e) => <OwnedCard key={e._id} e={e} />)}
          </div>
        )}
      </section>
    </div>
  );
}

function OwnedCard({ e }: { e: ExamListEntry }) {
  const isDraft = e.status === "draft";
  const dest = isDraft ? `/exams/${encodeURIComponent(e._id)}/edit` : `/exams/${encodeURIComponent(e._id)}/results`;
  return (
    <Link to={dest}
      className="group flex flex-col rounded-xl2 border border-ink-700 bg-ink-900 p-4 transition hover:border-brand-500/60 hover:shadow-glow">
      <div className="mb-2 flex items-center gap-2 text-xs">
        <span className={`rounded-full px-2 py-0.5 ${STATUS_BADGE[e.status]}`}>{e.status}</span>
        <span className="ml-auto text-ink-500">{e.positions.length} pos</span>
      </div>
      <h3 className="line-clamp-2 flex-1 font-semibold text-white group-hover:text-brand-200">{e.title}</h3>
      <div className="mt-3 flex items-center justify-between text-[11px] text-ink-500">
        <span>{e.timePerPosSec ? `${e.timePerPosSec}s/pos` : "untimed"} · pass {e.passMarkPct}%</span>
        <span>{e.dueAt ? `due ${fmtDate(e.dueAt)}` : `updated ${fmtDate(e.updatedAt)}`}</span>
      </div>
    </Link>
  );
}

function AssignedCard({ e }: { e: ExamListEntry }) {
  const now = new Date();
  const overdue = !!(e.dueAt && new Date(e.dueAt).getTime() < now.getTime()) && e.myStatus !== "done";
  const dest = e.myStatus === "done" ? `/exams/${encodeURIComponent(e._id)}/results` : `/exams/${encodeURIComponent(e._id)}/take`;
  const label = e.myStatus === "done" ? "View result" : e.myStatus === "in_progress" ? "Resume" : "Start exam";
  return (
    <Link to={dest}
      className={`flex flex-col rounded-xl2 border p-4 transition ${overdue ? "border-amber-500/40 bg-amber-500/5" : "border-ink-700 bg-ink-900"} hover:border-brand-500/60 hover:shadow-glow`}>
      <div className="mb-2 flex items-center gap-2 text-xs">
        <span className="rounded-full bg-brand-500/20 px-2 py-0.5 text-brand-200">{e.myStatus === "done" ? "✓ done" : e.myStatus === "in_progress" ? "⏸ in progress" : "🆕 new"}</span>
        {overdue && <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-amber-200">overdue</span>}
        <span className="ml-auto text-ink-500">{e.positions.length} pos</span>
      </div>
      <h3 className="line-clamp-2 flex-1 font-semibold text-white">{e.title}</h3>
      <div className="mt-2 text-xs text-ink-400">
        {e.timePerPosSec ? `${e.timePerPosSec}s/pos · ` : "untimed · "}
        pass {e.passMarkPct}%
        {e.myBestScorePct !== null && <span className="ml-2 text-emerald-300">best {e.myBestScorePct}%</span>}
      </div>
      <div className="mt-3 rounded-lg bg-brand-600 px-3 py-1.5 text-center text-xs font-semibold text-white">{label} →</div>
    </Link>
  );
}
