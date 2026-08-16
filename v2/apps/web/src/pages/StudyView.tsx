// View a study — chapter list. Route: /studies/:sid
//
// From here you can open any chapter in the editor, add a new chapter,
// rename the study, change visibility, or delete.

import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api";
import { studiesApi, type Visibility } from "../lib/studies-api";

const VIS_OPTIONS: { value: Visibility; label: string; hint: string }[] = [
  { value: "private", label: "Private",         hint: "Only you can see this." },
  { value: "shared",  label: "Shared",          hint: "Only people you explicitly share with." },
  { value: "academy", label: "Academy",         hint: "Everyone in your academy." },
  { value: "public",  label: "Public",          hint: "Anyone with the link." },
];

export default function StudyViewPage() {
  const { sid = "" } = useParams<{ sid: string }>();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [titleEdit, setTitleEdit] = useState<string | null>(null);
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });

  const q = useQuery({
    queryKey: ["study", sid],
    queryFn: () => studiesApi.get(sid),
    enabled: !!auth?.loggedIn && !!sid,
  });

  const patchMeta = useMutation({
    mutationFn: (body: any) => studiesApi.updateMeta(sid, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["study", sid] }),
  });
  const addChapterM = useMutation({
    mutationFn: () => studiesApi.addChapter(sid, { title: "" }),
    onSuccess: (r) => nav(`/studies/${encodeURIComponent(sid)}/edit/${encodeURIComponent(r.chapterId)}`),
  });
  const deleteStudy = useMutation({
    mutationFn: () => studiesApi.remove(sid),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["studies"] }); nav("/studies"); },
  });
  const deleteChapter = useMutation({
    mutationFn: (cid: string) => studiesApi.deleteChapter(sid, cid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["study", sid] }),
  });

  if (auth && !auth.loggedIn) return <Navigate to={`/login?back=/studies/${encodeURIComponent(sid)}`} replace />;

  if (q.isLoading) return <div className="mx-auto max-w-3xl px-3 py-8 text-sm text-ink-400">Loading…</div>;
  if (q.error) return <div className="mx-auto max-w-3xl px-3 py-8">
    <div className="rounded border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{String((q.error as any)?.message || q.error)}</div>
    <Link to="/studies" className="mt-3 inline-block text-sm text-brand-300 hover:underline">← My studies</Link>
  </div>;
  if (!q.data) return null;

  const { study, chapters } = q.data;
  const isOwner = auth?.loggedIn && auth.userId === study.ownerId;

  return (
    <div className="mx-auto max-w-3xl px-3 py-6">
      <Link to="/studies" className="mb-3 inline-block text-xs text-ink-400 hover:text-ink-200">← My studies</Link>

      {/* Title (click to rename) */}
      <div className="mb-4">
        {titleEdit === null ? (
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl text-white">{study.title}</h1>
            {isOwner && (
              <button onClick={() => setTitleEdit(study.title)}
                className="rounded px-1.5 text-xs text-ink-500 hover:bg-ink-800 hover:text-ink-200">✏️</button>
            )}
          </div>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); patchMeta.mutate({ title: titleEdit }); setTitleEdit(null); }}
            className="flex gap-2">
            <input autoFocus value={titleEdit} onChange={(e) => setTitleEdit(e.target.value)}
              maxLength={140}
              className="flex-1 rounded-lg border border-brand-500 bg-ink-800 px-3 py-1.5 text-white outline-none" />
            <button type="submit" className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white">Save</button>
            <button type="button" onClick={() => setTitleEdit(null)} className="rounded-lg border border-ink-700 px-3 py-1.5 text-sm text-ink-300">Cancel</button>
          </form>
        )}
      </div>

      {/* Visibility */}
      {isOwner && (
        <div className="mb-4 rounded-xl border border-ink-700 bg-ink-900 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Visibility</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {VIS_OPTIONS.map((v) => (
              <button key={v.value} onClick={() => patchMeta.mutate({ visibility: v.value })}
                title={v.hint}
                className={`rounded-lg px-3 py-2 text-xs font-semibold ${
                  study.visibility === v.value
                    ? "bg-brand-600 text-white"
                    : "border border-ink-700 text-ink-300 hover:bg-ink-800 hover:text-white"
                }`}>
                {v.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-ink-500">{VIS_OPTIONS.find((v) => v.value === study.visibility)?.hint}</p>
        </div>
      )}

      {/* Chapters */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-400">Chapters ({chapters.length})</h2>
        {isOwner && (
          <button onClick={() => addChapterM.mutate()} disabled={addChapterM.isPending}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
            {addChapterM.isPending ? "Adding…" : "+ Add chapter"}
          </button>
        )}
      </div>

      <div className="space-y-2">
        {chapters.length === 0 && (
          <div className="rounded border border-dashed border-ink-700 p-6 text-center text-sm text-ink-400">
            No chapters yet.
          </div>
        )}
        {chapters.map((c, i) => (
          <div key={c._id} className="flex items-center gap-3 rounded-xl border border-ink-700 bg-ink-900 p-3">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded bg-ink-800 text-xs font-semibold text-ink-300">{i + 1}</div>
            <Link to={`/studies/${encodeURIComponent(sid)}/edit/${encodeURIComponent(c._id)}`}
              className="flex-1 text-sm font-semibold text-white hover:text-brand-200">
              {c.title || `Chapter ${i + 1}`}
            </Link>
            {isOwner && (
              <button onClick={() => { if (confirm(`Delete chapter "${c.title}"?`)) deleteChapter.mutate(c._id); }}
                className="rounded px-2 py-1 text-xs text-rose-400 hover:bg-rose-500/10 hover:text-rose-300">
                Delete
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Delete study */}
      {isOwner && (
        <div className="mt-8 rounded-xl border border-rose-500/30 bg-rose-500/5 p-3">
          <div className="flex items-center justify-between">
            <div className="text-xs text-rose-200">Delete this study permanently.</div>
            <button onClick={() => { if (confirm(`Delete study "${study.title}" and all its chapters? This cannot be undone.`)) deleteStudy.mutate(); }}
              className="rounded-lg border border-rose-500/50 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/20">
              Delete study
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
