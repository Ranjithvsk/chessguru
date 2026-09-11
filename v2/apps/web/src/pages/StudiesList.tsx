// My Studies — grid of studies I've created or been shared on.
// Route: /studies

import { useMemo } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { studiesApi, type StudySummary } from "../lib/studies-api";

const INTENT_META: Record<string, { icon: string; label: string }> = {
  opening:        { icon: "📖", label: "Opening" },
  middlegame:     { icon: "⚔️", label: "Middlegame" },
  endgame:        { icon: "👑", label: "Endgame" },
  game:           { icon: "🎮", label: "Own game revision" },
  "gm-game":      { icon: "🏆", label: "Grandmaster games" },
  "classic-game": { icon: "🏛️", label: "Classic games" },
  puzzle:         { icon: "🧩", label: "Puzzle / tactic" },
  concept:        { icon: "💡", label: "Concept lesson" },
  notebook:       { icon: "📝", label: "Notebook" },
  book:           { icon: "📚", label: "From a book" },
};

/** The order My Studies groups by — a game's own order, then the general kinds.
 *  Anything not listed falls into "Other" at the end. */
const SECTION_ORDER = [
  "opening", "middlegame", "endgame",
  "game", "gm-game", "classic-game",
  "puzzle", "concept", "notebook", "book",
];

const VIS_LABEL: Record<string, string> = {
  private: "Private",
  shared:  "Shared",
  academy: "Academy-visible",
  public:  "Public",
};

function fmtDate(iso: string) {
  try { return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }); }
  catch { return ""; }
}

export default function StudiesListPage() {
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const list = useQuery({
    queryKey: ["studies"],
    queryFn: () => studiesApi.list(),
    enabled: !!auth?.loggedIn,
  });

  if (auth && !auth.loggedIn) return <Navigate to="/login?back=/studies" replace />;

  const items = list.data?.items ?? [];

  // Bucket studies by category, in SECTION_ORDER, dropping empty buckets. An
  // unrecognised intent (an older study, or one created before a category
  // existed) collects under "Other" rather than vanishing from the page.
  const sections = useMemo(() => {
    const by = new Map<string, StudySummary[]>();
    for (const st of items) {
      const k = INTENT_META[st.intent] ? st.intent : "__other__";
      const arr = by.get(k);
      if (arr) arr.push(st); else by.set(k, [st]);
    }
    const out: Array<{ intent: string; meta: { icon: string; label: string }; items: StudySummary[] }> = [];
    for (const k of SECTION_ORDER) {
      const rows = by.get(k);
      if (rows && rows.length) out.push({ intent: k, meta: INTENT_META[k]!, items: rows });
    }
    const other = by.get("__other__");
    if (other && other.length) out.push({ intent: "__other__", meta: { icon: "📁", label: "Other" }, items: other });
    return out;
  }, [items]);

  return (
    <div className="mx-auto max-w-5xl px-3 py-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl text-white">My Studies</h1>
          <p className="text-sm text-ink-400">Analyze games, teach concepts, build opening notes.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/studies/trash"
            className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800"
            title="Recover recently-deleted studies">
            🗑 Trash
          </Link>
          <Link to="/studies/new"
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 shadow-glow">
            + New study
          </Link>
        </div>
      </div>

      {list.isLoading && <div className="text-sm text-ink-400">Loading…</div>}
      {list.error && <div className="rounded border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">Couldn't load studies: {String((list.error as any)?.message || list.error)}</div>}

      {!list.isLoading && !list.error && items.length === 0 && (
        <div className="rounded-xl2 border border-dashed border-ink-700 bg-ink-900/50 p-8 text-center">
          <div className="mb-2 text-4xl">📓</div>
          <div className="mb-4 text-white">No studies yet.</div>
          <Link to="/studies/new" className="inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500">
            Create your first study
          </Link>
        </div>
      )}

      {/* Grouped by category rather than one flat wall of cards: a coach's
          opening prep and their endgame work are different bodies of study and
          reading them apart is the point. Sections follow a game's own order —
          opening, middlegame, endgame — then the revision kinds. Empty
          categories are omitted, so this collapses to a single list until
          there is actually a mix. */}
      {sections.map((sec) => (
        <div key={sec.intent} className="mb-6">
          {sections.length > 1 && (
            <div className="mb-2 flex items-center gap-2">
              <span className="text-base">{sec.meta.icon}</span>
              <span className="text-xs font-semibold uppercase tracking-wider text-brand-300">{sec.meta.label}</span>
              <span className="text-[11px] text-ink-500">{sec.items.length}</span>
              <span className="h-px flex-1 bg-ink-800" />
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sec.items.map((s) => <StudyCard key={s._id} s={s} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

function StudyCard({ s }: { s: StudySummary }) {
  const meta = INTENT_META[s.intent] || INTENT_META.notebook;
  return (
    <Link to={`/studies/${encodeURIComponent(s._id)}`}
      className="group relative flex flex-col rounded-xl2 border border-ink-700 bg-ink-900 p-4 transition hover:border-brand-500/60 hover:shadow-glow">
      <div className="mb-2 flex items-center gap-2 text-xs text-ink-400">
        <span className="text-lg">{meta.icon}</span>
        <span>{meta.label}</span>
        <span className="ml-auto rounded-full bg-ink-800 px-2 py-0.5 text-[10px] text-ink-300">
          {VIS_LABEL[s.visibility] || s.visibility}
        </span>
      </div>
      <h3 className="line-clamp-2 flex-1 font-semibold text-white group-hover:text-brand-200">{s.title}</h3>
      <div className="mt-3 flex items-center justify-between text-[11px] text-ink-500">
        <span>{s.chapterCount} chapter{s.chapterCount === 1 ? "" : "s"}</span>
        <span>Updated {fmtDate(s.updatedAt)}</span>
      </div>
    </Link>
  );
}
