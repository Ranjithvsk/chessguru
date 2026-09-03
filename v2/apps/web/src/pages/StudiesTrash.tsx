// My Studies — trash. Owner-only list of soft-deleted studies with a
// one-click restore. Route: /studies/trash.
//
// Studies deleted via the /studies/:sid page set `deletedAt` (soft delete —
// owner ask 2026-09-02 "in notebook my studies, only soft delete"). They
// disappear from the main list but stay in the DB. This page surfaces them
// so a mis-clicked delete is a click away from recovery.
//
// Currently: study-level restore only. Per-chapter restore + a "purge
// forever" button are follow-ups if wanted.

import { Link, Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { studiesApi, type StudySummary } from "../lib/studies-api";

const INTENT_ICON: Record<string, string> = {
  game: "🎮", puzzle: "🧩", concept: "💡", opening: "📖",
  endgame: "👑", notebook: "📝", book: "📚",
};

function fmtWhen(iso?: string) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffH = (now.getTime() - d.getTime()) / (1000 * 60 * 60);
    if (diffH < 24) return `${Math.max(1, Math.round(diffH))}h ago`;
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  } catch { return ""; }
}

export default function StudiesTrashPage() {
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["studies", "trash"],
    queryFn: () => studiesApi.listTrash(),
    enabled: !!auth?.loggedIn,
  });
  const restore = useMutation({
    mutationFn: (sid: string) => studiesApi.restore(sid),
    onSuccess: () => {
      // Invalidate both the trash and the live list so the row moves
      // instantly between pages without a manual refresh.
      qc.invalidateQueries({ queryKey: ["studies", "trash"] });
      qc.invalidateQueries({ queryKey: ["studies"] });
    },
  });

  if (auth && !auth.loggedIn) return <Navigate to="/login?back=/studies/trash" replace />;

  const items: StudySummary[] = list.data?.items ?? [];

  return (
    <div className="mx-auto max-w-4xl px-3 py-6">
      <Link to="/studies" className="mb-2 inline-block text-xs text-ink-400 hover:text-ink-200">← My studies</Link>
      <div className="mb-5 flex items-end justify-between">
        <div>
          <h1 className="font-display text-2xl text-white">🗑 Trash</h1>
          <p className="text-sm text-ink-400">Studies you deleted. Click Restore to bring one back.</p>
        </div>
      </div>

      {list.isLoading && <div className="text-sm text-ink-400">Loading…</div>}
      {list.error && (
        <div className="rounded border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">
          Couldn't load trash: {String((list.error as any)?.message || list.error)}
        </div>
      )}

      {!list.isLoading && !list.error && items.length === 0 && (
        <div className="rounded-xl2 border border-dashed border-ink-700 bg-ink-900/50 p-8 text-center">
          <div className="mb-2 text-4xl">🕊️</div>
          <div className="text-white">Trash is empty.</div>
          <div className="mt-1 text-xs text-ink-500">Studies you delete land here first — nothing is gone forever.</div>
        </div>
      )}

      {restore.error && (
        <div className="mb-3 rounded border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-200">
          Restore failed: {String((restore.error as any)?.message || restore.error)}
        </div>
      )}

      <ul className="divide-y divide-ink-800 rounded-xl border border-ink-800 bg-ink-900/60">
        {items.map((s) => (
          <li key={s._id} className="flex items-center gap-3 p-3">
            <span className="text-2xl" aria-hidden>{INTENT_ICON[s.intent] ?? "📓"}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-white">{s.title}</div>
              <div className="text-[11px] text-ink-500">
                {s.chapterCount} chapter{s.chapterCount === 1 ? "" : "s"}
                <span className="mx-1.5 opacity-60">·</span>
                deleted {fmtWhen(s.deletedAt)}
              </div>
            </div>
            <button
              onClick={() => restore.mutate(s._id)}
              disabled={restore.isPending && restore.variables === s._id}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
              {restore.isPending && restore.variables === s._id ? "Restoring…" : "♻ Restore"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
