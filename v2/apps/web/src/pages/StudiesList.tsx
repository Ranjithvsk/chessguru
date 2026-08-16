// My Studies — grid of studies I've created or been shared on.
// Route: /studies

import { Link, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { studiesApi, type StudySummary } from "../lib/studies-api";

const INTENT_META: Record<string, { icon: string; label: string }> = {
  game:     { icon: "🎮", label: "Game analysis" },
  puzzle:   { icon: "🧩", label: "Puzzle / tactic" },
  concept:  { icon: "💡", label: "Concept lesson" },
  opening:  { icon: "📖", label: "Opening" },
  endgame:  { icon: "👑", label: "Endgame" },
  notebook: { icon: "📝", label: "Notebook" },
  book:     { icon: "📚", label: "From a book" },
};

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

  return (
    <div className="mx-auto max-w-5xl px-3 py-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl text-white">My Studies</h1>
          <p className="text-sm text-ink-400">Analyze games, teach concepts, build opening notes.</p>
        </div>
        <Link to="/studies/new"
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 shadow-glow">
          + New study
        </Link>
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((s) => <StudyCard key={s._id} s={s} />)}
      </div>
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
