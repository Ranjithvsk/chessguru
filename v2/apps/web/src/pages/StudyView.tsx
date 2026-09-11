// View a study — chapter list. Route: /studies/:sid
//
// From here you can open any chapter in the editor, add a new chapter,
// rename the study, change visibility, or delete.

import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "../lib/api";
import { studiesApi, type Visibility } from "../lib/studies-api";
import { TagChips } from "../components/TagEditor";
import { MiniFenBoard } from "../components/MiniFenBoard";
import { revisionsApi } from "../lib/revisions-api";

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
    // Explicit startingFen so a new chapter always lands on the standard
    // opening board in the editor (owner ask 2026-09-02: "when i click
    // new chapter, i need opening board"). Server normalizeFen defaults
    // an empty startingFen to startpos too, but sending it explicitly
    // avoids any future divergence between client + server defaults.
    mutationFn: () => studiesApi.addChapter(sid, {
      title: "",
      startingFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    }),
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
  const addToQueue = useMutation({
    mutationFn: () => revisionsApi.addStudy(sid),
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
    <div className="mx-auto max-w-7xl px-3 py-6">
      <Link to="/studies" className="mb-3 inline-block text-xs text-ink-400 hover:text-ink-200">← My studies</Link>

      {/* Book link badge (if this study is tied to a book chapter) */}
      {study.sourceBook && (
        <Link to={`/books/${encodeURIComponent(study.sourceBook.bookId)}`}
          className="mb-3 inline-flex items-center gap-2 rounded-full border border-brand-500/40 bg-brand-500/10 px-3 py-1 text-xs text-brand-100 hover:bg-brand-500/20">
          📚 From book{study.sourceBook.chapterNumber ? ` — Ch ${study.sourceBook.chapterNumber}` : ""}
          {study.sourceBook.topicTags && study.sourceBook.topicTags.length > 0 && (
            <span className="text-ink-400">· {study.sourceBook.topicTags.slice(0, 3).join(", ")}</span>
          )}
        </Link>
      )}

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

      {/* Revision opt-in — only offered to non-owners viewing a shared study.
          Owners auto-sync on chapter save. */}
      {!isOwner && (
        <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 flex items-center gap-3">
          <span className="text-2xl">🎯</span>
          <div className="flex-1 text-sm text-amber-100">
            Add the ⭐ positions in this study to your daily revision queue.
          </div>
          <button onClick={() => addToQueue.mutate()} disabled={addToQueue.isPending || addToQueue.isSuccess}
            className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-ink-900 hover:bg-amber-400 disabled:opacity-60">
            {addToQueue.isPending ? "Adding…" :
              addToQueue.isSuccess ? `Added ${addToQueue.data?.added ?? 0}` :
              "Add to my queue"}
          </button>
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

      <ChapterList
        chapters={chapters}
        sid={sid}
        isOwner={isOwner}
        onDelete={(id, title) => { if (confirm(`Delete chapter "${title}"?`)) deleteChapter.mutate(id); }}
      />

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

type ChapterRow = {
  _id: string; title: string; tags?: string[];
  startingFen?: string; previewFen?: string;
};

/** Chapter list with topic grouping. A chapter can carry several tags, so in
 *  grouped mode it appears under each of them — that is the point of tagging
 *  rather than foldering. Clicking any tag filters to it. */
function ChapterList({
  chapters, sid, isOwner, onDelete,
}: {
  chapters: ChapterRow[];
  sid: string;
  isOwner: boolean | undefined;
  onDelete: (id: string, title: string) => void;
}) {
  const [grouped, setGrouped] = useState(true);
  const [filter, setFilter] = useState<string | null>(null);

  // Original position, so numbering stays stable however the list is sliced.
  const orderOf = useMemo(() => {
    const m = new Map<string, number>();
    chapters.forEach((c, i) => m.set(c._id, i + 1));
    return m;
  }, [chapters]);

  const allTags = useMemo(() => {
    const m = new Map<string, { tag: string; count: number }>();
    for (const c of chapters) {
      for (const t of c.tags || []) {
        const k = t.toLowerCase();
        const e = m.get(k);
        if (e) e.count++; else m.set(k, { tag: t, count: 1 });
      }
    }
    return [...m.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }, [chapters]);

  const shown = useMemo(
    () => (filter ? chapters.filter((c) => (c.tags || []).some((t) => t.toLowerCase() === filter)) : chapters),
    [chapters, filter],
  );

  const groups = useMemo(() => {
    if (!grouped) return [{ tag: null as string | null, items: shown }];
    const m = new Map<string, { tag: string; items: typeof shown }>();
    const untagged: typeof shown = [];
    for (const c of shown) {
      const ts = c.tags || [];
      if (ts.length === 0) { untagged.push(c); continue; }
      for (const t of ts) {
        const k = t.toLowerCase();
        const e = m.get(k);
        if (e) e.items.push(c); else m.set(k, { tag: t, items: [c] });
      }
    }
    const out: Array<{ tag: string | null; items: typeof shown }> =
      [...m.values()].sort((a, b) => b.items.length - a.items.length || a.tag.localeCompare(b.tag));
    if (untagged.length) out.push({ tag: null, items: untagged });
    return out;
  }, [shown, grouped]);

  if (chapters.length === 0) {
    return (
      <div className="rounded border border-dashed border-ink-700 p-6 text-center text-sm text-ink-400">
        No chapters yet.
      </div>
    );
  }

  /* A card, three to a row, board first. The board is the thing you actually
     recognise a chapter by, so it gets the whole card width rather than a
     thumbnail beside the text. The position drawn is the one the MAIN LINE
     reaches — a start position would render an identical untouched board for
     every opening chapter. previewFen is stored server-side because this list
     deliberately does not ship `moves`. */
  const card = (c: ChapterRow) => (
    <div key={c._id} className="overflow-hidden rounded-xl border border-ink-700 bg-ink-900 transition hover:border-brand-500/60">
      <div className="relative">
        <Link
          to={`/studies/${encodeURIComponent(sid)}/edit/${encodeURIComponent(c._id)}`}
          className="block"
          title="Open on the board"
          aria-hidden
          tabIndex={-1}
        >
          <MiniFenBoard fen={c.previewFen || c.startingFen || "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"} />
        </Link>
        <span className="pointer-events-none absolute left-2 top-2 flex h-6 min-w-6 items-center justify-center rounded bg-ink-950/80 px-1.5 text-[11px] font-semibold text-ink-100 ring-1 ring-black/30">
          {orderOf.get(c._id)}
        </span>
        {isOwner && (
          <button
            onClick={() => onDelete(c._id, c.title)}
            title={`Delete "${c.title}"`}
            aria-label={`Delete chapter ${c.title}`}
            className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded bg-ink-950/80 text-xs text-ink-300 ring-1 ring-black/30 hover:bg-rose-600 hover:text-white"
          >
            ✕
          </button>
        )}
      </div>
      <div className="p-2.5">
        <Link to={`/studies/${encodeURIComponent(sid)}/edit/${encodeURIComponent(c._id)}`}
          className="block truncate text-sm font-semibold text-white hover:text-brand-200"
          title={c.title}>
          {c.title || `Chapter ${orderOf.get(c._id)}`}
        </Link>
        <TagChips tags={c.tags} onClick={(t) => setFilter(t.toLowerCase())} />
      </div>
    </div>
  );

  return (
    <>
      {allTags.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setFilter(null)}
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${filter === null ? "bg-brand-500/30 text-brand-100" : "bg-ink-800 text-ink-300 hover:bg-ink-700"}`}
          >
            All ({chapters.length})
          </button>
          {allTags.map((t) => (
            <button
              key={t.tag}
              onClick={() => setFilter(filter === t.tag.toLowerCase() ? null : t.tag.toLowerCase())}
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${filter === t.tag.toLowerCase() ? "bg-brand-500/30 text-brand-100" : "bg-ink-800 text-ink-300 hover:bg-ink-700"}`}
            >
              {t.tag} ({t.count})
            </button>
          ))}
          <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-ink-400">
            <input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} className="accent-brand-500" />
            Group by topic
          </label>
        </div>
      )}

      {/* Without this the feature is invisible: the chips + "Group by topic"
          toggle only render once something carries a tag, so a user with no
          tags yet sees an unchanged page and no hint that topics exist at all.
          Owner could not find the feature for exactly this reason. */}
      {allTags.length === 0 && (
        <div className="mb-3 rounded-lg border border-dashed border-ink-700 px-3 py-2 text-xs text-ink-400">
          🏷️ No topics yet. Open a chapter and add one in the{" "}
          <span className="font-semibold text-ink-200">Topics</span> row above the board —
          chapters then group by topic here, and a chapter can carry several.
        </div>
      )}

      {shown.length === 0 && (
        <div className="rounded border border-dashed border-ink-700 p-6 text-center text-sm text-ink-400">
          No chapters with that topic.
        </div>
      )}

      {groups.map((g) => (
        <div key={g.tag ?? "__untagged"} className="mb-4">
          {grouped && allTags.length > 0 && (
            <div className="mb-1.5 flex items-center gap-2">
              <span className={`text-xs font-semibold uppercase tracking-wider ${g.tag ? "text-brand-300" : "text-ink-500"}`}>
                {g.tag ?? "No topic"}
              </span>
              <span className="text-[11px] text-ink-500">{g.items.length}</span>
              <span className="h-px flex-1 bg-ink-800" />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{g.items.map(card)}</div>
        </div>
      ))}
    </>
  );
}
