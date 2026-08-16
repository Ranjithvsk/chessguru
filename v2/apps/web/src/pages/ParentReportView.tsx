// Saved parent report view — coach can edit the note, mark sent, print PDF.
// Route: /coach-board/reports/:id
//
// The body renderer (ReportBody) is exported so the Generate page can reuse
// it — same visual output, one is editable-in-place.

import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { parentReportsApi, type ReportData } from "../lib/parent-reports-api";

function fmt(iso: string | null | undefined) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }); }
  catch { return ""; }
}

export default function ParentReportViewPage() {
  const { id = "" } = useParams<{ id: string }>();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });

  const q = useQuery({
    queryKey: ["parent-report", id],
    queryFn: () => parentReportsApi.get(id),
    enabled: !!auth?.loggedIn && !!id,
  });

  const [coachNote, setNote] = useState("");
  const [parentEmail, setEmail] = useState("");
  useEffect(() => {
    if (q.data) {
      setNote(q.data.coachNote || "");
      setEmail(q.data.parentEmail || "");
    }
  }, [q.data]);

  const save = useMutation({
    mutationFn: () => parentReportsApi.updateMeta(id, { coachNote, parentEmail }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["parent-report", id] }),
  });
  const send = useMutation({
    mutationFn: () => parentReportsApi.markSent(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["parent-report", id] }),
  });
  const del = useMutation({
    mutationFn: () => parentReportsApi.remove(id),
    onSuccess: () => nav("/coach-board/reports"),
  });

  if (auth && !auth.loggedIn) return <Navigate to={`/login?back=/coach-board/reports/${encodeURIComponent(id)}`} replace />;
  if (q.isLoading) return <div className="mx-auto max-w-4xl px-3 py-8 text-sm text-ink-400">Loading…</div>;
  if (q.error || !q.data) return <div className="mx-auto max-w-4xl px-3 py-8">
    <div className="rounded border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{String((q.error as any)?.message || "not found")}</div>
    <Link to="/coach-board/reports" className="mt-3 inline-block text-sm text-brand-300 hover:underline">← Reports</Link>
  </div>;

  const r = q.data;
  const mailto = `mailto:${encodeURIComponent(r.parentEmail || "")}?subject=${encodeURIComponent(`${r.data.student.name || r.data.student.username} — Chess progress report`)}&body=${encodeURIComponent(makeMailBody(r.data, coachNote))}`;

  return (
    <div className="mx-auto max-w-4xl px-3 py-6">
      <div className="mb-3 flex items-center gap-2 print:hidden">
        <Link to="/coach-board/reports" className="text-xs text-ink-400 hover:text-ink-200">← All reports</Link>
        <span className="ml-auto text-xs text-ink-500">Generated {fmt(r.generatedAt)}{r.sentAt ? ` · Sent ${fmt(r.sentAt)}` : ""}</span>
      </div>

      <ReportBody data={r.data} coachNote={coachNote} onNoteChange={setNote} editable />

      <div className="mt-4 rounded-xl border border-ink-700 bg-ink-900 p-4 space-y-3 print:hidden">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Parent email</label>
          <input type="email" value={parentEmail} onChange={(e) => setEmail(e.target.value)}
            placeholder="parent@example.com"
            className="w-full rounded border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none" />
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => save.mutate()} disabled={save.isPending}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
            {save.isPending ? "Saving…" : "Save changes"}
          </button>
          <a href={mailto} onClick={() => send.mutate()} target="_blank" rel="noreferrer"
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold text-white ${parentEmail ? "bg-emerald-600 hover:bg-emerald-500" : "bg-ink-800 text-ink-500 pointer-events-none"}`}>
            📧 Send via email
          </a>
          <button type="button" onClick={() => window.print()}
            className="rounded-lg border border-ink-700 px-3 py-1.5 text-sm text-ink-200 hover:bg-ink-800">
            🖨️ Print / PDF
          </button>
          {r.sentAt && <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-xs text-emerald-200 self-center">✓ Marked sent</span>}
          <button type="button" onClick={() => { if (confirm("Delete this report?")) del.mutate(); }}
            className="ml-auto rounded-lg border border-rose-500/40 px-3 py-1.5 text-xs text-rose-200 hover:bg-rose-500/10">Delete</button>
        </div>
      </div>
    </div>
  );
}

/** Shared body renderer used by both the generate preview and the saved view. */
export function ReportBody({ data, coachNote, onNoteChange, editable }: {
  data: ReportData;
  coachNote: string;
  onNoteChange: (v: string) => void;
  editable: boolean;
}) {
  const d = data;
  const rating = d.rating.current;
  const change = d.rating.change;
  const changeCls = change === null ? "text-ink-500" : change > 0 ? "text-emerald-300" : change < 0 ? "text-rose-300" : "text-ink-300";
  const changeArrow = change === null ? "" : change > 0 ? "▲" : change < 0 ? "▼" : "→";

  return (
    <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-6 print:border-none print:bg-white print:text-black">
      <div className="mb-4 border-b border-ink-800 pb-3 print:border-black">
        <div className="text-xs uppercase tracking-wide text-ink-500 print:text-gray-600">Chess progress report</div>
        <h1 className="font-display text-3xl text-white print:text-black">{d.student.name || d.student.username}</h1>
        <div className="text-sm text-ink-400 print:text-gray-700">
          {new Date(d.period.start).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })} → {new Date(d.period.end).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
        </div>
      </div>

      {/* Top stats */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatBox label="Puzzle rating" value={rating != null ? String(rating) : "—"} sub={change != null ? <span className={changeCls}>{changeArrow} {Math.abs(change)}</span> : "—"} />
        <StatBox label="Games played" value={d.games.played} sub={`${d.games.won}W / ${d.games.drawn}D / ${d.games.lost}L`} />
        <StatBox label="Puzzles solved" value={d.puzzles.solved} sub="all-time" />
        <StatBox label="Revision streak" value={d.revision.longestStreak} sub={`${d.revision.totalCards} cards`} />
      </div>

      {/* Weaknesses */}
      {d.weaknesses.length > 0 && (
        <Section title="🎯 Focus areas this period">
          <div className="flex flex-wrap gap-2">
            {d.weaknesses.map((w) => (
              <div key={w.tag} className="rounded-full bg-ink-800 px-3 py-1 text-xs text-ink-200 print:border print:border-gray-300 print:bg-white print:text-gray-900">
                {w.label} × {w.count}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Books */}
      {d.books.length > 0 && (
        <Section title="📚 Books progress">
          <ul className="space-y-1">
            {d.books.map((b) => (
              <li key={b.bookId} className="flex items-center gap-2 text-sm">
                <span className="text-white print:text-black">{b.title}</span>
                <span className="ml-auto text-xs text-ink-400 print:text-gray-700">{b.totalDone}/{b.totalChapters} chapters done</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Studies created */}
      {d.studies.length > 0 && (
        <Section title="📓 Studies created / edited">
          <ul className="space-y-1">
            {d.studies.slice(0, 8).map((s) => (
              <li key={s.studyId} className="flex items-center gap-2 text-sm">
                <span className="text-white print:text-black">{s.title}</span>
                <span className="ml-auto text-xs text-ink-400 print:text-gray-700">{s.chapterCount} chapter{s.chapterCount === 1 ? "" : "s"}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Exams */}
      {d.exams.length > 0 && (
        <Section title="📝 Exams">
          <ul className="space-y-1">
            {d.exams.map((e) => (
              <li key={e.examId} className="flex items-center gap-2 text-sm">
                <span className="text-white print:text-black">{e.title}</span>
                <span className={`ml-auto text-xs ${e.passed ? "text-emerald-300 print:text-green-700" : "text-rose-300 print:text-red-700"}`}>
                  {e.scorePct}% {e.passed ? "✓" : "✗"}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Coach note — the "personal touch" that makes reports memorable to parents */}
      <Section title="💬 Coach's note">
        {editable ? (
          <textarea rows={5} value={coachNote} onChange={(e) => onNoteChange(e.target.value)}
            placeholder="A paragraph about the student's progress, effort, and next month's focus. Parents love this."
            className="w-full rounded border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none print:border-black print:bg-white print:text-black" />
        ) : (
          <p className="whitespace-pre-line text-sm text-ink-200 print:text-black">{coachNote || <span className="text-ink-500">(no note)</span>}</p>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-200 print:text-gray-800">{title}</div>
      {children}
    </div>
  );
}

function StatBox({ label, value, sub }: { label: string; value: string | number; sub?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-800 p-3 text-center print:border-gray-300 print:bg-white">
      <div className="text-2xl font-bold text-white print:text-black">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-ink-400 print:text-gray-700">{label}</div>
      {sub && <div className="mt-1 text-xs text-ink-300 print:text-gray-700">{sub}</div>}
    </div>
  );
}

function makeMailBody(d: ReportData, note: string): string {
  const lines: string[] = [];
  lines.push(`Hi,`);
  lines.push("");
  lines.push(`Here's ${d.student.name || d.student.username}'s chess progress for ${new Date(d.period.start).toLocaleDateString()} — ${new Date(d.period.end).toLocaleDateString()}:`);
  lines.push("");
  if (d.rating.current != null) lines.push(`• Puzzle rating: ${d.rating.current}${d.rating.change != null ? ` (${d.rating.change >= 0 ? "+" : ""}${d.rating.change})` : ""}`);
  lines.push(`• Games: ${d.games.played} (${d.games.won}W / ${d.games.drawn}D / ${d.games.lost}L)`);
  lines.push(`• Puzzles solved: ${d.puzzles.solved}`);
  if (d.revision.longestStreak) lines.push(`• Revision streak: ${d.revision.longestStreak} days`);
  if (d.weaknesses.length) lines.push(`• Focus areas: ${d.weaknesses.slice(0, 3).map((w) => `${w.label} (${w.count})`).join(", ")}`);
  if (note) { lines.push(""); lines.push(note); }
  lines.push("");
  lines.push("— Coach");
  return lines.join("\n");
}
