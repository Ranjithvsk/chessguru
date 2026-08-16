// Exam results. Route: /exams/:id/results
//
// Coach view: table of all students + scores + per-position miss counts
//             ("5/8 missed position 3 — worth reteaching").
// Student view: their own attempts + a retake button if retryable + not passed.

import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { examsApi } from "../lib/exams-api";

function fmt(iso: string | null | undefined) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); }
  catch { return ""; }
}

export default function ExamResultsPage() {
  const { id = "" } = useParams<{ id: string }>();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const q = useQuery({
    queryKey: ["exam-results", id],
    queryFn: () => examsApi.results(id),
    enabled: !!auth?.loggedIn && !!id,
  });

  const closeM = useMutation({
    mutationFn: () => examsApi.close(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["exam-results", id] }),
  });
  const startRetake = useMutation({
    mutationFn: () => examsApi.startAttempt(id),
    onSuccess: () => nav(`/exams/${encodeURIComponent(id)}/take`),
  });

  if (auth && !auth.loggedIn) return <Navigate to={`/login?back=/exams/${encodeURIComponent(id)}/results`} replace />;
  if (q.isLoading) return <div className="mx-auto max-w-4xl px-3 py-8 text-sm text-ink-400">Loading…</div>;
  if (q.error || !q.data) return <div className="mx-auto max-w-4xl px-3 py-8">
    <div className="rounded border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{String((q.error as any)?.message || "not found")}</div>
    <Link to="/exams" className="mt-3 inline-block text-sm text-brand-300 hover:underline">← Exams</Link>
  </div>;

  const { role, exam, attempts, perPosition } = q.data;
  const submitted = attempts.filter((a) => a.submittedAt);
  const inProg = attempts.find((a) => !a.submittedAt);

  return (
    <div className="mx-auto max-w-5xl px-3 py-6">
      <Link to="/exams" className="mb-3 inline-block text-xs text-ink-400 hover:text-ink-200">← Exams</Link>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h1 className="font-display text-2xl text-white">{exam.title}</h1>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${exam.status === "published" ? "bg-emerald-500/20 text-emerald-200" : "bg-ink-800 text-ink-500"}`}>{exam.status}</span>
      </div>
      <p className="mb-6 text-xs text-ink-400">
        {exam.positions.length} positions · {exam.timePerPosSec ? `${exam.timePerPosSec}s per position` : "no timer"} · pass {exam.passMarkPct}%
        {exam.dueAt && <> · due {fmt(exam.dueAt)}</>}
      </p>

      {role === "student" && (
        <StudentResults exam={exam} attempts={submitted} inProg={inProg} onRetake={() => startRetake.mutate()} retaking={startRetake.isPending} />
      )}

      {role === "owner" && (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-3">
            <StatBox label="Attempts submitted" value={submitted.length} />
            <StatBox label="Average score" value={submitted.length ? `${Math.round(submitted.reduce((s, a) => s + a.scorePct, 0) / submitted.length)}%` : "—"} />
            <StatBox label="Pass rate" value={submitted.length ? `${Math.round((submitted.filter((a) => a.passed).length / submitted.length) * 100)}%` : "—"} />
          </div>

          {/* Attempts table */}
          <section className="mb-8">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-400">Attempts</h2>
            {submitted.length === 0 ? (
              <div className="rounded-xl border border-dashed border-ink-700 p-4 text-center text-sm text-ink-400">No attempts yet.</div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-ink-700">
                <table className="w-full text-sm">
                  <thead className="bg-ink-800 text-xs uppercase tracking-wide text-ink-400">
                    <tr>
                      <th className="px-3 py-2 text-left">Student</th>
                      <th className="px-3 py-2 text-left">Attempt</th>
                      <th className="px-3 py-2 text-left">Score</th>
                      <th className="px-3 py-2 text-left">Passed</th>
                      <th className="px-3 py-2 text-left">Submitted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {submitted.map((a) => (
                      <tr key={a._id} className="border-t border-ink-800">
                        <td className="px-3 py-2 text-white">{a.user?.name || a.user?.username || a.userId}</td>
                        <td className="px-3 py-2 text-ink-400">#{a.attemptNumber}</td>
                        <td className="px-3 py-2">
                          <span className={a.scorePct >= exam.passMarkPct ? "text-emerald-300" : "text-rose-300"}>
                            {a.score}/{a.totalPositions} ({a.scorePct}%)
                          </span>
                        </td>
                        <td className="px-3 py-2">{a.passed ? "✓" : "✗"}</td>
                        <td className="px-3 py-2 text-xs text-ink-400">{fmt(a.submittedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Per-position miss counts — the "which positions did everyone bomb?" heatmap. */}
          {perPosition && perPosition.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-400">Position miss rates</h2>
              <p className="mb-3 text-xs text-ink-500">Sort → find positions worth reteaching.</p>
              <div className="space-y-1">
                {[...perPosition].sort((a, b) => b.missCount - a.missCount).map((p, i) => {
                  const rate = submitted.length ? p.missCount / submitted.length : 0;
                  return (
                    <div key={p.id} className="flex items-center gap-3 rounded border border-ink-700 bg-ink-900 p-2 text-sm">
                      <div className="w-8 text-xs text-ink-500">#{exam.positions.find((pp) => pp.id === p.id)?.order != null ? (exam.positions.find((pp) => pp.id === p.id)!.order + 1) : (i + 1)}</div>
                      <div className="w-16 font-mono text-brand-200">{p.expectedSan}</div>
                      <div className="flex-1 h-2 rounded bg-ink-800 overflow-hidden">
                        <div className={`h-full ${rate >= 0.5 ? "bg-rose-500" : rate >= 0.25 ? "bg-amber-500" : "bg-emerald-500"}`}
                          style={{ width: `${Math.min(100, rate * 100)}%` }} />
                      </div>
                      <div className="w-20 text-right text-xs text-ink-300">{p.missCount}/{submitted.length} missed</div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {exam.status === "published" && (
            <div className="mt-8 flex items-center justify-end">
              <button onClick={() => { if (confirm("Close this exam? Students won't be able to take/retake it.")) closeM.mutate(); }}
                className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-500/20">
                Close exam
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-900 p-3 text-center">
      <div className="text-2xl font-bold text-white">{value}</div>
      <div className="mt-1 text-xs text-ink-400">{label}</div>
    </div>
  );
}

function StudentResults({ exam, attempts, inProg, onRetake, retaking }: {
  exam: any;
  attempts: any[];
  inProg: any;
  onRetake: () => void;
  retaking: boolean;
}) {
  const best = attempts.reduce((b: any, a: any) => a.scorePct > (b?.scorePct ?? -1) ? a : b, null);
  const canRetake = exam.retryable && exam.status === "published" && !inProg && (!best || !best.passed);
  return (
    <div>
      {best ? (
        <div className={`mb-4 rounded-xl2 border p-4 ${best.passed ? "border-emerald-500/40 bg-emerald-500/5" : "border-rose-500/40 bg-rose-500/5"}`}>
          <div className="text-xs text-ink-400">Best attempt</div>
          <div className="mt-1 text-3xl font-bold text-white">{best.scorePct}%</div>
          <div className="mt-1 text-sm">
            {best.passed
              ? <span className="text-emerald-200">✓ Passed — {best.score}/{best.totalPositions} correct</span>
              : <span className="text-rose-200">✗ Not passed — {best.score}/{best.totalPositions} (pass mark: {exam.passMarkPct}%)</span>}
          </div>
        </div>
      ) : (
        <div className="mb-4 rounded-xl border border-dashed border-ink-700 p-6 text-center text-sm text-ink-400">
          No attempts yet.
        </div>
      )}

      {inProg && (
        <Link to={`/exams/${encodeURIComponent(exam._id)}/take`}
          className="mb-4 block rounded-lg bg-amber-500/20 px-4 py-3 text-center text-sm font-semibold text-amber-100 hover:bg-amber-500/30">
          ⏸ Resume attempt →
        </Link>
      )}

      {canRetake && (
        <button onClick={onRetake} disabled={retaking}
          className="mb-4 w-full rounded-lg bg-brand-600 px-4 py-3 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
          {retaking ? "Starting…" : "🔁 Take again"}
        </button>
      )}

      {attempts.length > 1 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-400">All attempts</h2>
          <div className="space-y-1">
            {attempts.map((a: any) => (
              <div key={a._id} className="flex items-center gap-3 rounded border border-ink-700 bg-ink-900 p-2 text-sm">
                <div className="text-ink-400">#{a.attemptNumber}</div>
                <div className="flex-1">
                  <span className={a.passed ? "text-emerald-300" : "text-rose-300"}>
                    {a.score}/{a.totalPositions} ({a.scorePct}%)
                  </span>
                </div>
                <div className="text-xs text-ink-500">{fmt(a.submittedAt)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
