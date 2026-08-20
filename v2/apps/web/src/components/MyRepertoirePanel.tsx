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
  type RepertoireEntry, type RepMoveNode,
} from "../lib/repertoire-api";
import { api } from "../lib/api";
import { activateOpening, isActivated } from "../lib/cards";
import type { MoveNode } from "../hooks/useFreePlay";

interface Props {
  history: string[];                                     // current line's SANs
  /** Full move tree with any sidelines — save alongside `history` so branches
   *  survive the round-trip. Optional so old callers keep working. */
  tree?: MoveNode[];
  activeOpening?: { slug: string; name: string; eco: string } | null;
  onLoad: (entry: { sans?: string[]; tree?: RepMoveNode[]; slug?: string }) => void;
  /** Fired when a user clicks the 📅 "add to Opening Trainer" button on an
   *  entry. Lets embedders (DailyStudy) refresh their queue view. */
  onActivate?: (slug: string) => void;
}

export default function MyRepertoirePanel({ history, tree, activeOpening, onLoad, onActivate }: Props) {
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

  // Cheap check: does the tree carry at least one sibling variation? If not,
  // we skip sending it — the server already rejects trees without branches
  // (falls back to sans-only), but this saves the payload bytes on the wire
  // and keeps the intent visible.
  const treeHasBranches = useMemo(() => {
    if (!tree || tree.length === 0) return false;
    const check = (n: MoveNode): boolean => n.children.length > 1 || n.children.some(check);
    return tree.some(check);
  }, [tree]);

  const saveLine = () => {
    if (!history.length) return;
    const suggested = activeOpening ? `${activeOpening.name} (my line)` : `Line — ${history.slice(0, 6).join(" ")}`;
    const name = window.prompt("Name this line:", suggested);
    if (!name) return;
    // Ship the full tree when it contains sidelines so students / coaches
    // don't silently lose branches on save+reload (owner report 2026-08-19:
    // "save also side lines while saving, now only main lines are saved
    // even when sidelines are there"). MoveNode <-> RepMoveNode are
    // structurally identical — plain { san, children[] }.
    addMut.mutate({
      name: name.trim(),
      kind: "line",
      sans: history,
      ...(treeHasBranches ? { tree: tree as RepMoveNode[] } : {}),
    });
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

      {/* Entries list — split into coach-suggested vs my-own for students so
          the two feeds don't blur together. Coaches (who don't receive shared
          entries themselves) just see one list. Owner ask 2026-08-19: "for
          students, in My Repertoire, coach suggested opening show separate". */}
      {(() => {
        const suggested = entries.filter((e) => !!e.sharedFrom);
        const mine = entries.filter((e) => !e.sharedFrom);
        if (entries.length === 0) {
          return (
            <div className="rounded-lg border border-ink-800 bg-ink-950 p-3 text-center text-xs text-ink-500">
              Nothing saved yet. Play a line or pick an opening, then use the buttons above.
            </div>
          );
        }
        return (
          <div className="space-y-3">
            {suggested.length > 0 && (
              <Section title={`🎓 Coach-suggested (${suggested.length})`} tone="indigo">
                <List entries={suggested} onLoad={onLoad} onDelete={(id) => delMut.mutate(id)} isCoach={isCoach} onShare={() => { /* recipient can't re-share */ }} onActivate={onActivate} />
              </Section>
            )}
            <Section title={`✏️ ${suggested.length ? "My own" : "Saved"} (${mine.length})`} tone="brand">
              {mine.length === 0 ? (
                <div className="px-2 py-3 text-center text-xs text-ink-500">Nothing saved on your own yet.</div>
              ) : (
                <List entries={mine} onLoad={onLoad} onDelete={(id) => delMut.mutate(id)} isCoach={isCoach} onShare={(e) => setShareTarget(e)} onActivate={onActivate} />
              )}
            </Section>
          </div>
        );
      })()}

      {shareTarget && (
        <ShareModal entry={shareTarget} onClose={() => setShareTarget(null)} onDone={() => { setShareTarget(null); invalidate(); }} />
      )}
    </div>
  );
}

function Section({ title, tone, children }: { title: string; tone: "indigo" | "brand"; children: React.ReactNode }) {
  const border = tone === "indigo" ? "border-indigo-500/40" : "border-ink-800";
  const header = tone === "indigo" ? "text-indigo-300" : "text-ink-400";
  return (
    <div className={`rounded-lg border ${border} bg-ink-950`}>
      <div className={`border-b border-ink-800 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${header}`}>{title}</div>
      <div className="max-h-[200px] overflow-y-auto">{children}</div>
    </div>
  );
}

function List({
  entries, onLoad, onDelete, isCoach, onShare, onActivate,
}: {
  entries: RepertoireEntry[];
  onLoad: (entry: { sans?: string[]; tree?: RepMoveNode[]; slug?: string }) => void;
  onDelete: (id: string) => void;
  isCoach: boolean;
  onShare: (entry: RepertoireEntry) => void;
  onActivate?: (slug: string) => void;
}) {
  // Local counter to force a re-render after activateOpening flips the
  // `isActivated` state (writes to localStorage, no built-in subscribe).
  const [activateNonce, setActivateNonce] = useState(0);
  return (
    <ul className="divide-y divide-ink-800/60">
      {entries.map((e) => {
        const activatable = e.kind === "corpus" && !!e.slug;
        // Re-read on each render / after activation so the button flips
        // to the "activated" state without needing a page refresh.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const _touch = activateNonce;
        const activated = activatable && isActivated(e.slug!);
        return (
        <li key={e._id} className="group flex items-center gap-2 px-2 py-1.5 hover:bg-ink-900">
          <button
            onClick={() => onLoad(
              e.kind === "corpus"
                ? { slug: e.slug }
                // Prefer the full tree when present so sidelines load with
                // the entry (owner report 2026-08-19). Fall back to sans for
                // pre-tree entries.
                : { sans: e.sans, ...(e.tree ? { tree: e.tree } : {}) },
            )}
            className="min-w-0 flex-1 truncate text-left text-xs text-ink-100 hover:text-white">
            <span className="mr-1">{e.kind === "corpus" ? "📖" : (e.tree ? "🌳" : "✏️")}</span>
            {e.name}
            {e.sharedFromName && (
              <span className="ml-1 text-[10px] font-semibold text-indigo-300"> · from {e.sharedFromName}</span>
            )}
          </button>
          {/* Add to Opening Trainer — visible for corpus entries only (line
              entries have no corpus slug so the FSRS card generator has
              nothing to key off). Works for both own and coach-suggested
              entries (owner ask 2026-08-20). */}
          {activatable && (
            <button
              onClick={() => {
                if (activated) return;
                activateOpening(e.slug!);
                setActivateNonce((n) => n + 1);
                onActivate?.(e.slug!);
              }}
              disabled={activated}
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${activated
                ? "text-emerald-400 cursor-default"
                : "text-ink-400 hover:bg-ink-800 hover:text-emerald-300"}`}
              title={activated ? "Already in Opening Trainer" : "Add to Opening Trainer"}>
              {activated ? "✓📅" : "📅"}
            </button>
          )}
          {isCoach && !e.sharedFrom && (
            <button
              onClick={() => onShare(e)}
              className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-ink-400 hover:bg-ink-800 hover:text-brand-300"
              title="Share with students">🎓</button>
          )}
          <button
            onClick={() => { if (confirm(`Remove "${e.name}"?`)) onDelete(e._id); }}
            className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-ink-500 hover:bg-rose-500/20 hover:text-rose-300"
            title="Delete">🗑</button>
        </li>
        );
      })}
    </ul>
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
      // /api/academy/students returns a bare Student[] array (see
      // academy.service.ts::listStudents). Older code here expected a
      // { students: [...] } envelope, which meant the picker always
      // showed "No students match" (owner report 2026-08-20).
      return (Array.isArray(j) ? j : (j?.students ?? [])) as Array<{ _id: string; name?: string; username?: string }>;
    },
  });
  const students = data ?? [];
  // Batches — one click picks every student in a batch. /api/academy/batches
  // returns a bare array; each row has `.students: [{_id,name,username}, ...]`
  // already enriched by the server (see academy.service.ts::listBatches).
  // Owner ask 2026-08-20: "also option to share batch wise".
  const { data: batchData } = useQuery({
    queryKey: ["academy-batches-picker"],
    queryFn: async () => {
      const r = await fetch(`${(import.meta as any).env?.VITE_API_BASE ?? ""}/api/academy/batches`, { credentials: "include" });
      const j = await r.json();
      return (Array.isArray(j) ? j : (j?.batches ?? [])) as Array<{
        _id: string; name: string;
        studentIds?: string[];
        students?: Array<{ _id: string; name?: string; username?: string }>;
      }>;
    },
  });
  const batches = batchData ?? [];
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

  // Batch selection state: fully-selected = every studentId in the batch is
  // already picked; partial = some (not all) are picked; none otherwise.
  const batchIds = (b: { studentIds?: string[]; students?: Array<{ _id: string }> }): string[] =>
    (b.studentIds && b.studentIds.length ? b.studentIds : (b.students || []).map((s) => s._id)).map(String);
  const batchState = (b: { studentIds?: string[]; students?: Array<{ _id: string }> }): "all" | "some" | "none" => {
    const ids = batchIds(b);
    if (ids.length === 0) return "none";
    let hit = 0;
    for (const id of ids) if (picked.has(id)) hit++;
    return hit === 0 ? "none" : hit === ids.length ? "all" : "some";
  };
  const toggleBatch = (b: { studentIds?: string[]; students?: Array<{ _id: string }> }) => {
    const ids = batchIds(b);
    setPicked((prev) => {
      const next = new Set(prev);
      const state = batchState(b);
      if (state === "all") for (const id of ids) next.delete(id);
      else for (const id of ids) next.add(id);
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl2 border border-ink-700 bg-ink-900 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="font-display text-sm font-semibold text-white">Share "{entry.name}"</h3>
          <button onClick={onClose} className="text-ink-500 hover:text-white">✕</button>
        </div>
        <p className="mb-2 text-[11px] text-ink-400">Copies land in each student's My Repertoire, tagged "shared by you".</p>

        {batches.length > 0 && (
          <div className="mb-2">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-500">Batches</div>
            <div className="flex flex-wrap gap-1.5">
              {batches.map((b) => {
                const ids = batchIds(b);
                const state = batchState(b);
                const cls = state === "all"
                  ? "bg-brand-500 text-white"
                  : state === "some"
                    ? "bg-brand-500/40 text-white ring-1 ring-brand-400"
                    : "bg-ink-800 text-ink-200 hover:bg-ink-700";
                return (
                  <button key={b._id} type="button" onClick={() => toggleBatch(b)}
                    title={state === "all" ? "Unselect batch" : `Add ${ids.length} student${ids.length === 1 ? "" : "s"} from this batch`}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${cls}`}>
                    {b.name} <span className="opacity-75">· {ids.length}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search students…"
          className="mb-2 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm text-white placeholder-ink-500 focus:border-brand-400 focus:outline-none" />
        <div className="mb-3 max-h-[240px] overflow-y-auto rounded-lg border border-ink-800 bg-ink-950 p-1">
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
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={() => setPicked(new Set())}
            disabled={picked.size === 0}
            className="text-[11px] text-ink-500 underline-offset-2 hover:text-ink-300 hover:underline disabled:opacity-40">
            Clear
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-ink-300 hover:bg-ink-800">Cancel</button>
            <button onClick={() => shareMut.mutate()} disabled={picked.size === 0 || shareMut.isPending}
              className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-400 disabled:opacity-40">
              {shareMut.isPending ? "Sharing…" : `Share with ${picked.size || "…"}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
