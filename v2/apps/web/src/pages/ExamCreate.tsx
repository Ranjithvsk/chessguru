// Create a draft exam. Route: /exams/new
// Just the meta: title/description/timer/passMark/retryable.
// Positions are added in the editor.

import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { examsApi } from "../lib/exams-api";

const TIMER_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: "No timer" },
  { value: 30,   label: "30 seconds" },
  { value: 60,   label: "1 minute" },
  { value: 120,  label: "2 minutes" },
  { value: 180,  label: "3 minutes" },
];

export default function ExamCreatePage() {
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const nav = useNavigate();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [timePerPosSec, setTime] = useState<number | null>(60);
  const [passMarkPct, setPass] = useState(60);
  const [retryable, setRetry] = useState(true);
  const [err, setErr] = useState("");

  const mut = useMutation({
    mutationFn: (body: any) => examsApi.create(body),
    onSuccess: (r) => nav(`/exams/${encodeURIComponent(r.examId)}/edit`),
    onError: (e: any) => setErr(String(e?.message || e)),
  });

  if (auth && !auth.loggedIn) return <Navigate to="/login?back=/exams/new" replace />;

  const submit = () => {
    setErr("");
    if (!title.trim()) { setErr("Title required"); return; }
    mut.mutate({ title: title.trim(), description: description.trim() || undefined, timePerPosSec, passMarkPct, retryable });
  };

  return (
    <div className="mx-auto max-w-2xl px-3 py-6">
      <Link to="/exams" className="mb-3 inline-block text-xs text-ink-400 hover:text-ink-200">← Exams</Link>
      <h1 className="mb-4 font-display text-2xl text-white">New exam</h1>
      <p className="mb-6 text-sm text-ink-400">Set the ground rules — you'll add positions in the next step.</p>

      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200}
            placeholder="e.g. Week 3 tactics quiz"
            className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Description <span className="font-normal text-ink-500">(optional — students see this before starting)</span></label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={3000}
            placeholder="e.g. Find the best move in each of these 10 positions from this week's lessons."
            className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Time per position</label>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {TIMER_OPTIONS.map((o) => (
              <button key={String(o.value)} type="button" onClick={() => setTime(o.value)}
                className={`rounded-lg px-3 py-2 text-xs font-semibold ${timePerPosSec === o.value ? "bg-brand-600 text-white" : "border border-ink-700 text-ink-300 hover:bg-ink-800 hover:text-white"}`}>
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Pass mark: {passMarkPct}%</label>
          <input type="range" min="0" max="100" step="5" value={passMarkPct}
            onChange={(e) => setPass(Number(e.target.value))}
            className="w-full accent-brand-500" />
        </div>

        <label className="flex items-center gap-2 text-sm text-white">
          <input type="checkbox" checked={retryable} onChange={(e) => setRetry(e.target.checked)}
            className="accent-brand-500" />
          <span>Students can retake if they fail</span>
        </label>

        {err && <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{err}</div>}

        <button type="button" onClick={submit} disabled={mut.isPending}
          className="w-full rounded-lg bg-brand-600 px-4 py-2.5 font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
          {mut.isPending ? "Creating…" : "Create draft →"}
        </button>
      </div>
    </div>
  );
}
