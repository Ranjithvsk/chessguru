// Exam builder — coach adds positions from their studies, picks students to
// assign, and publishes. Route: /exams/:id/edit
//
// The core workflow: pick a study → we bulk-add all its ⭐ positions.
// If coach needs a custom position that isn't in a study yet, they add it
// to a study first (⭐ flag) then come back here.

import { useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { examsApi, type ExamSummary, type ExamPosition } from "../lib/exams-api";
import { studiesApi } from "../lib/studies-api";

export default function ExamEditPage() {
  const { id = "" } = useParams<{ id: string }>();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });

  const q = useQuery({
    queryKey: ["exam", id],
    queryFn: () => examsApi.get(id),
    enabled: !!auth?.loggedIn && !!id,
  });
  const studies = useQuery({
    queryKey: ["studies"],
    queryFn: () => studiesApi.list(),
    enabled: !!auth?.loggedIn,
  });
  const pickable = useQuery({
    queryKey: ["exam-pickable-students"],
    queryFn: () => examsApi.pickableStudents(),
    enabled: !!auth?.loggedIn,
  });

  const addFrom = useMutation({
    mutationFn: (sid: string) => examsApi.addFromStudy(id, sid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["exam", id] }),
  });
  const removePos = useMutation({
    mutationFn: (pid: string) => examsApi.removePosition(id, pid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["exam", id] }),
  });
  const patchMeta = useMutation({
    mutationFn: (body: Partial<ExamSummary>) => examsApi.updateMeta(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["exam", id] }),
  });
  const publishM = useMutation({
    mutationFn: (dueAt: string | null) => examsApi.publish(id, { dueAt }),
    onSuccess: () => nav(`/exams/${encodeURIComponent(id)}/results`),
  });
  const deleteM = useMutation({
    mutationFn: () => examsApi.remove(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["exams"] }); nav("/exams"); },
  });

  const [dueAt, setDueAt] = useState<string>("");
  const [studyPick, setStudyPick] = useState("");

  if (auth && !auth.loggedIn) return <Navigate to={`/login?back=/exams/${encodeURIComponent(id)}/edit`} replace />;
  if (q.isLoading) return <div className="mx-auto max-w-4xl px-3 py-8 text-sm text-ink-400">Loading…</div>;
  if (q.error || !q.data) return <div className="mx-auto max-w-4xl px-3 py-8">
    <div className="rounded border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{String((q.error as any)?.message || "not found")}</div>
    <Link to="/exams" className="mt-3 inline-block text-sm text-brand-300 hover:underline">← Exams</Link>
  </div>;

  const exam = q.data.exam;
  const isDraft = exam.status === "draft";
  const flaggedStudies = (studies.data?.items ?? []).filter((s) => s.chapterCount > 0);

  return (
    <div className="mx-auto max-w-4xl px-3 py-6">
      <Link to="/exams" className="mb-3 inline-block text-xs text-ink-400 hover:text-ink-200">← Exams</Link>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input value={exam.title} onChange={(e) => patchMeta.mutate({ title: e.target.value })} disabled={!isDraft}
          maxLength={200}
          className="flex-1 min-w-[240px] rounded-lg border border-ink-700 bg-ink-900 px-3 py-1.5 font-display text-lg text-white outline-none focus:border-brand-500 disabled:opacity-70" />
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${exam.status === "draft" ? "bg-ink-800 text-ink-300" : exam.status === "published" ? "bg-emerald-500/20 text-emerald-200" : "bg-ink-800 text-ink-500"}`}>{exam.status}</span>
      </div>

      {/* Positions */}
      <section className="mb-6 rounded-xl2 border border-ink-700 bg-ink-900 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-400">Positions ({exam.positions.length})</h2>
        </div>

        {isDraft && (
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-ink-800 p-3">
            <select value={studyPick} onChange={(e) => setStudyPick(e.target.value)}
              className="flex-1 rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-white focus:border-brand-500 focus:outline-none">
              <option value="">Pick a study → add its ⭐ positions</option>
              {flaggedStudies.map((s) => (
                <option key={s._id} value={s._id}>{s.title} ({s.chapterCount} ch)</option>
              ))}
            </select>
            <button type="button"
              onClick={() => studyPick && addFrom.mutate(studyPick)}
              disabled={!studyPick || addFrom.isPending}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
              {addFrom.isPending ? "Adding…" : addFrom.isSuccess ? `+${addFrom.data?.added}` : "Add"}
            </button>
          </div>
        )}

        {exam.positions.length === 0 ? (
          <div className="rounded border border-dashed border-ink-700 p-4 text-center text-sm text-ink-400">
            No positions yet — add ⭐ positions from any study you own.
          </div>
        ) : (
          <div className="space-y-2">
            {exam.positions.map((p, i) => <PositionRow key={p.id} p={p} i={i} isDraft={isDraft} onRemove={() => removePos.mutate(p.id)} />)}
          </div>
        )}
      </section>

      {/* Assign */}
      <section className="mb-6 rounded-xl2 border border-ink-700 bg-ink-900 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-400">Assign to</h2>
        {isDraft ? (
          <AssignPicker exam={exam} allStudents={pickable.data?.items ?? []} onSave={(ids) => patchMeta.mutate({ assignedTo: ids })} />
        ) : (
          <div className="text-sm text-ink-300">
            {exam.assignedTo.length === 0
              ? "Everyone in the academy."
              : `${exam.assignedTo.length} specific student${exam.assignedTo.length === 1 ? "" : "s"}.`}
          </div>
        )}
      </section>

      {/* Publish */}
      {isDraft && (
        <section className="rounded-xl2 border border-brand-500/40 bg-brand-500/5 p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-brand-200">Publish</h2>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="mb-1 block text-xs text-ink-400">Due date (optional)</label>
              <input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)}
                className="w-full rounded border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none" />
            </div>
            <button type="button"
              onClick={() => publishM.mutate(dueAt ? new Date(dueAt).toISOString() : null)}
              disabled={exam.positions.length === 0 || publishM.isPending}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
              {publishM.isPending ? "Publishing…" : "🚀 Publish exam"}
            </button>
          </div>
          {exam.positions.length === 0 && <p className="mt-2 text-xs text-amber-300">Add at least one position before publishing.</p>}
          {publishM.error && <div className="mt-2 rounded border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-200">{String((publishM.error as any)?.message || publishM.error)}</div>}
        </section>
      )}

      {/* Delete */}
      {isDraft && (
        <div className="mt-8 rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 flex items-center justify-between">
          <div className="text-xs text-rose-200">Delete this draft.</div>
          <button onClick={() => { if (confirm(`Delete exam "${exam.title}"?`)) deleteM.mutate(); }}
            className="rounded-lg border border-rose-500/50 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/20">
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

function PositionRow({ p, i, isDraft, onRemove }: { p: ExamPosition; i: number; isDraft: boolean; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-ink-700 bg-ink-800/50 p-2">
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded bg-ink-800 text-xs text-ink-300">{i + 1}</div>
      <div className="flex-1 text-sm text-white">
        <span className="font-mono text-brand-200">{p.expectedSan}</span>
        <span className="ml-2 text-xs text-ink-400">({p.turnColor} to move)</span>
        {p.comment && <div className="mt-0.5 text-xs text-ink-500 line-clamp-1">💬 {p.comment}</div>}
      </div>
      {isDraft && (
        <button onClick={onRemove} className="rounded px-2 py-1 text-xs text-rose-400 hover:bg-rose-500/10">
          ×
        </button>
      )}
    </div>
  );
}

function AssignPicker({ exam, allStudents, onSave }: {
  exam: ExamSummary;
  allStudents: { _id: string; username: string; name?: string; role: string }[];
  onSave: (ids: string[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(exam.assignedTo));
  const [mode, setMode] = useState<"everyone" | "picked">(exam.assignedTo.length === 0 ? "everyone" : "picked");

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };
  const commit = () => onSave(mode === "everyone" ? [] : Array.from(selected));

  const sorted = useMemo(() => [...allStudents].sort((a, b) => (a.name || a.username).localeCompare(b.name || b.username)), [allStudents]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button type="button" onClick={() => setMode("everyone")}
          className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${mode === "everyone" ? "bg-brand-600 text-white" : "border border-ink-700 text-ink-300 hover:bg-ink-800 hover:text-white"}`}>
          Everyone in academy
        </button>
        <button type="button" onClick={() => setMode("picked")}
          className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${mode === "picked" ? "bg-brand-600 text-white" : "border border-ink-700 text-ink-300 hover:bg-ink-800 hover:text-white"}`}>
          Specific students ({selected.size})
        </button>
      </div>
      {mode === "picked" && (
        <div className="max-h-72 space-y-1 overflow-y-auto rounded border border-ink-700 bg-ink-800/50 p-2">
          {sorted.length === 0 ? (
            <div className="p-3 text-xs text-ink-400">No other students in your academy yet.</div>
          ) : sorted.map((u) => (
            <label key={u._id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-ink-800">
              <input type="checkbox" checked={selected.has(u._id)} onChange={() => toggle(u._id)} className="accent-brand-500" />
              <span className="text-white">{u.name || u.username}</span>
              <span className="text-xs text-ink-500">{u.username} · {u.role}</span>
            </label>
          ))}
        </div>
      )}
      <button type="button" onClick={commit}
        className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-500">
        Save assignment
      </button>
    </div>
  );
}
