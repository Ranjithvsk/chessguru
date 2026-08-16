// Generate a monthly parent report for a specific student.
// Route: /coach-board/reports/new/:studentId
//
// Flow: preview data → coach adds a note + parent email → save → land on
// the saved report view where they can Send or Download PDF.

import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { parentReportsApi, type ReportData } from "../lib/parent-reports-api";
import { ReportBody } from "./ParentReportView";

/** ISO date string for input[type=date]: YYYY-MM-DD */
function toDateInput(d: Date): string { return d.toISOString().slice(0, 10); }

export default function ParentReportGeneratePage() {
  const { studentId = "" } = useParams<{ studentId: string }>();
  const nav = useNavigate();
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });

  // Default period: previous full month (or last 30 days if we're early in a month).
  const now = new Date();
  const defStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const defEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
  const [start, setStart] = useState(toDateInput(defStart));
  const [end, setEnd] = useState(toDateInput(defEnd));
  const [coachNote, setNote] = useState("");
  const [parentEmail, setParentEmail] = useState("");
  const [preview, setPreview] = useState<ReportData | null>(null);
  const [err, setErr] = useState("");

  const previewMut = useMutation({
    mutationFn: () => parentReportsApi.preview({
      studentId,
      periodStart: new Date(start).toISOString(),
      periodEnd: new Date(end + "T23:59:59").toISOString(),
    }),
    onSuccess: (d) => { setPreview(d); setErr(""); },
    onError: (e: any) => setErr(String(e?.message || e)),
  });
  const saveMut = useMutation({
    mutationFn: () => parentReportsApi.save({
      studentId,
      periodStart: new Date(start).toISOString(),
      periodEnd: new Date(end + "T23:59:59").toISOString(),
      coachNote: coachNote.trim() || undefined,
      parentEmail: parentEmail.trim() || undefined,
    }),
    onSuccess: (r) => nav(`/coach-board/reports/${encodeURIComponent(r.reportId)}`),
    onError: (e: any) => setErr(String(e?.message || e)),
  });

  // Auto-preview on mount + when dates change
  useEffect(() => { if (studentId) previewMut.mutate(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [studentId, start, end]);

  if (auth && !auth.loggedIn) return <Navigate to={`/login?back=/coach-board/reports/new/${encodeURIComponent(studentId)}`} replace />;

  return (
    <div className="mx-auto max-w-4xl px-3 py-6">
      <Link to="/coach-board" className="mb-3 inline-block text-xs text-ink-400 hover:text-ink-200">← Class board</Link>
      <h1 className="mb-4 font-display text-2xl text-white">New parent report</h1>

      {/* Period + note controls */}
      <div className="mb-4 rounded-xl border border-ink-700 bg-ink-900 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Period start</label>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)}
              className="w-full rounded border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Period end</label>
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)}
              className="w-full rounded border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none" />
          </div>
        </div>
      </div>

      {err && <div className="mb-4 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{err}</div>}

      {previewMut.isPending && <div className="mb-4 text-sm text-ink-400">Building preview…</div>}

      {preview && (
        <>
          <ReportBody data={preview} coachNote={coachNote} onNoteChange={setNote} editable />

          <div className="mt-6 rounded-xl border border-ink-700 bg-ink-900 p-4 space-y-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Parent email (optional)</label>
              <input type="email" value={parentEmail} onChange={(e) => setParentEmail(e.target.value)}
                placeholder="parent@example.com"
                className="w-full rounded border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none" />
            </div>
            <button type="button" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}
              className="w-full rounded-lg bg-brand-600 px-4 py-2.5 font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
              {saveMut.isPending ? "Saving…" : "Save report →"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
