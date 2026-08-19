// "My Repertoire" panel — every opening the user has saved from the Explorer
// (corpus openings by slug, or custom lines by SAN). Renders in the /openings
// right rail below the Explorer + Finder.
//
// Actions:
//   * 💾 Save current line — appears when the user has played moves
//   * ➕ Save this opening — appears when the board is at a corpus opening
//   * 🎓 Share with students — coach only, per saved entry
//   * 🗑 Delete
//   * Clicking an entry loads it onto the shared board (via onLoad callback)
//
// Data comes from GET /api/my/repertoire; mutations go through the api
// helpers in lib/repertoire-api.ts.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listRepertoire, addRepertoire, deleteRepertoire, shareRepertoire,
  type RepertoireEntry,
} from "../lib/repertoire-api";
import { api } from "../lib/api";

interface Props {
  history: string[];                                     // current line's SANs
  activeOpening?: { slug: string; name: string; eco: string } | null;
  onLoad: (entry: { sans?: string[]; slug?: string }) => void;
}

export default function MyRepertoirePanel({ history, activeOpening, onLoad }: Props) {
  const qc = useQueryClient();
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const loggedIn = !!auth?.loggedIn;
  const isCoach = auth?.role === "coach" || auth?.role === "academy_owner";

  const { data } = useQuery({
    queryKey: ["my-repertoire"],
    queryFn: listRepertoire,
    enabled: loggedIn,
  });
  const entries = data?.entries ?? [];

  const invalidate = () => qc.invalidateQueries({ queryKey: ["my-repertoire"] });

  const addMut = useMutation({ mutationFn: addRepertoire, onSuccess: invalidate });
  const delMut = useMutation({ mutationFn: deleteRepertoire, onSuccess: invalidate });

  const saveLine = () => {
    if (!history.length) return;
    const suggested = activeOpening ? `${activeOpening.name} (my line)` : `Line — ${history.slice(0, 6).join(" ")}`;
    const name = window.prompt("Name this line:", suggested);
    if (!name) return;
    addMut.mutate({ name: name.trim(), kind: "line", sans: history });
  };
  const saveOpening = () => {
    if (!activeOpening) return;
    addMut.mutate({
      name: activeOpening.name,
      kind: "corpus",
      slug: activeOpening.slug,
    });
  };

  // Duplicate-detection so the "already saved" state is visible instead of
  // silently letting the user pile up copies of the same corpus opening.
  const savedSlugs = useMemo(() => new Set(entries.filter((e) => e.kind === "corpus").map((e) => e.slug!)), [entries]);
  const openingAlreadySaved = !!(activeOpening && savedSlugs.has(activeOpening.slug));

  const [shareTarget, setShareTarget] = useState<RepertoireEntry | null>(null);

  if (!loggedIn) {
    return (
      <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-4 text-xs text-ink-400">
        <b>Sign in</b> to save openings and custom lines to your repertoire.
      </div>
    );
  }

  return (
    <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="font-display text-sm font-semibold text-white">🎯 My Repertoire</h2>
        <span className="text-[10px] text-ink-500">{entries.length} saved</span>
      </div>

      {/* Action row — save current line and/or save the corpus opening. */}
      <div className="mb-3 flex flex-wrap gap-2">
        <button
          onClick={saveLine}
          disabled={history.length === 0 || addMut.isPending}
          className="rounded-lg bg-brand-500/80 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-500 disabled:opacity-40"
          title={history.length === 0 ? "Play some moves first" : "Save the current line with a name"}>
          💾 Save current line
        </button>
        {activeOpening && (
          <button
            onClick={saveOpening}
            disabled={openingAlreadySaved || addMut.isPending}
            className="rounded-lg bg-emerald-600/80 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-40"
            title={openingAlreadySaved ? "Already in your repertoire" : `Save ${activeOpening.name}`}>
            {openingAlreadySaved ? "✓ Saved" : `➕ Save ${activeOpening.eco}`}
          </button>
        )}
      </div>

      {/* Entries list */}
      <div className="max-h-[240px] overflow-y-auto rounded-lg border border-ink-800 bg-ink-950">
        {entries.length === 0 ? (
          <div className="p-3 text-center text-xs text-ink-500">
            Nothing saved yet. Play a line or pick an opening, then use the buttons above.
          </div>
        ) : (
          <ul className="divide-y divide-ink-800/60">
            {entries.map((e) => (
              <li key={e._id} className="group flex items-center gap-2 px-2 py-1.5 hover:bg-ink-900">
                <button
                  onClick={() => onLoad(e.kind === "corpus" ? { slug: e.slug } : { sans: e.sans })}
                  className="min-w-0 flex-1 truncate text-left text-xs text-ink-100 hover:text-white">
                  <span className="mr-1">{e.kind === "corpus" ? "📖" : "✏️"}</span>
                  {e.name}
                  {e.sharedFromName && (
                    <span className="ml-1 text-[10px] font-semibold text-indigo-300"> · shared by {e.sharedFromName}</span>
                  )}
                </button>
                {isCoach && !e.sharedFrom && (
                  <button
                    onClick={() => setShareTarget(e)}
                    className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-ink-400 hover:bg-ink-800 hover:text-brand-300"
                    title="Share with students">🎓</button>
                )}
                <button
                  onClick={() => { if (confirm(`Remove "${e.name}"?`)) delMut.mutate(e._id); }}
                  className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-ink-500 hover:bg-rose-500/20 hover:text-rose-300"
                  title="Delete">🗑</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {shareTarget && (
        <ShareModal entry={shareTarget} onClose={() => setShareTarget(null)} onDone={() => { setShareTarget(null); invalidate(); }} />
      )}
    </div>
  );
}

/** Student-picker modal for coaches. Loads /api/academy/students and lets
 *  the coach pick multiple recipients for a single shareRepertoire call. */
function ShareModal({ entry, onClose, onDone }: { entry: RepertoireEntry; onClose: () => void; onDone: () => void }) {
  const { data } = useQuery({
    queryKey: ["academy-students-picker"],
    queryFn: async () => {
      const r = await fetch(`${(import.meta as any).env?.VITE_API_BASE ?? ""}/api/academy/students`, { credentials: "include" });
      const j = await r.json();
      return j as { students?: Array<{ _id: string; name?: string; username?: string }> };
    },
  });
  const students = data?.students ?? [];
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");

  const shareMut = useMutation({
    mutationFn: () => shareRepertoire(entry._id, [...picked]),
    onSuccess: (r) => { alert(`Shared with ${r.shared} student${r.shared === 1 ? "" : "s"}.`); onDone(); },
    onError: (e: any) => alert(e.message || "Share failed."),
  });

  const filtered = students.filter((s) =>
    !q.trim() || `${s.name || ""} ${s.username || ""}`.toLowerCase().includes(q.trim().toLowerCase()),
  );

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl2 border border-ink-700 bg-ink-900 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="font-display text-sm font-semibold text-white">Share "{entry.name}"</h3>
          <button onClick={onClose} className="text-ink-500 hover:text-white">✕</button>
        </div>
        <p className="mb-2 text-[11px] text-ink-400">Copies land in each student's My Repertoire, tagged "shared by you".</p>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search students…"
          className="mb-2 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm text-white placeholder-ink-500 focus:border-brand-400 focus:outline-none" />
        <div className="mb-3 max-h-[280px] overflow-y-auto rounded-lg border border-ink-800 bg-ink-950 p-1">
          {filtered.length === 0 ? (
            <div className="p-2 text-xs text-ink-500">No students match.</div>
          ) : filtered.map((s) => {
            const on = picked.has(s._id);
            return (
              <label key={s._id} className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs ${on ? "bg-brand-500/25 text-white" : "text-ink-200 hover:bg-ink-800"}`}>
                <input type="checkbox" checked={on}
                  onChange={(e) => setPicked((prev) => {
                    const n = new Set(prev); e.target.checked ? n.add(s._id) : n.delete(s._id); return n;
                  })} />
                <span className="truncate">{s.name || s.username || s._id}</span>
              </label>
            );
          })}
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-ink-300 hover:bg-ink-800">Cancel</button>
          <button onClick={() => shareMut.mutate()} disabled={picked.size === 0 || shareMut.isPending}
            className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-400 disabled:opacity-40">
            {shareMut.isPending ? "Sharing…" : `Share with ${picked.size || "…"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
