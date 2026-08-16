// List of saved parent reports. Route: /coach-board/reports

import { Link, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { parentReportsApi } from "../lib/parent-reports-api";

function fmt(iso: string) { try { return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }); } catch { return ""; } }

export default function ParentReportsListPage() {
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const q = useQuery({
    queryKey: ["parent-reports"],
    queryFn: () => parentReportsApi.list(),
    enabled: !!auth?.loggedIn,
  });

  if (auth && !auth.loggedIn) return <Navigate to="/login?back=/coach-board/reports" replace />;

  return (
    <div className="mx-auto max-w-4xl px-3 py-6">
      <Link to="/coach-board" className="mb-3 inline-block text-xs text-ink-400 hover:text-ink-200">← Class board</Link>
      <h1 className="mb-1 font-display text-2xl text-white">Parent reports</h1>
      <p className="mb-5 text-sm text-ink-400">All reports you've generated. Open one to edit, send, or print as PDF.</p>

      {q.isLoading && <div className="text-sm text-ink-400">Loading…</div>}
      {q.error && <div className="rounded border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{String((q.error as any)?.message || q.error)}</div>}

      {!q.isLoading && (q.data?.items.length ?? 0) === 0 && (
        <div className="rounded-xl2 border border-dashed border-ink-700 bg-ink-900/50 p-8 text-center text-sm text-ink-400">
          No reports yet. Generate one from any student on the <Link to="/coach-board" className="text-brand-300 hover:underline">Class board</Link>.
        </div>
      )}

      <div className="space-y-2">
        {q.data?.items.map((r) => (
          <Link key={r._id} to={`/coach-board/reports/${encodeURIComponent(r._id)}`}
            className="flex items-center gap-3 rounded-xl border border-ink-700 bg-ink-900 p-3 hover:bg-ink-800">
            <div className="flex-1">
              <div className="font-semibold text-white">{r.data.student.name || r.data.student.username}</div>
              <div className="text-xs text-ink-400">
                {fmt(r.periodStart)} → {fmt(r.periodEnd)}
              </div>
            </div>
            <div className="text-xs text-ink-500">
              {r.sentAt ? <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-emerald-200">Sent {fmt(r.sentAt)}</span>
                : r.parentEmail ? <span className="rounded-full bg-brand-500/20 px-2 py-0.5 text-brand-200">Ready</span>
                : <span className="rounded-full bg-ink-800 px-2 py-0.5 text-ink-400">Draft</span>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
