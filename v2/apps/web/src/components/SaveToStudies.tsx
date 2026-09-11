// "Save to My Studies" — the one control every position/game surface uses.
//
// Before this, only the openings explorer could put anything into My Studies,
// and it did so through a bare window.prompt. A puzzle you had just solved or a
// game you had just played could only get there by retyping the position by
// hand. This replaces that with a real dialog: name it, choose whether it starts
// a new study or joins an existing one, and tag it — then jump straight into the
// board to annotate it.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { studiesApi, type Intent } from "../lib/studies-api";
import { TagEditor } from "./TagEditor";

export function SaveToStudiesButton({
  intent, defaultTitle, startingFen, pgn, defaultTags, label, className, disabled, title: tooltip,
}: {
  intent: Intent;
  /** Pre-filled name — opponent names, puzzle id, opening name, a date. */
  defaultTitle: string;
  /** Position to start from. Omit for a game that starts from the initial position. */
  startingFen?: string;
  /** Moves as PGN. Omit to save the position alone. */
  pgn?: string;
  defaultTags?: string[];
  label?: string;
  className?: string;
  disabled?: boolean;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={tooltip || "Save this to My Studies"}
        className={className || "rounded-lg border border-ink-700 bg-ink-900/60 px-3 py-1.5 text-xs font-semibold text-ink-200 hover:border-brand-500 hover:text-brand-200 disabled:opacity-40"}
      >
        {label || "📓 Save to My Studies"}
      </button>
      {open && (
        <SaveDialog
          intent={intent}
          defaultTitle={defaultTitle}
          startingFen={startingFen}
          pgn={pgn}
          defaultTags={defaultTags}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function SaveDialog({
  intent, defaultTitle, startingFen, pgn, defaultTags, onClose,
}: {
  intent: Intent;
  defaultTitle: string;
  startingFen?: string;
  pgn?: string;
  defaultTags?: string[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(defaultTitle || "Saved position");

  // Several host pages bind BARE keys at the window — the puzzle trainer alone
  // takes N, Space, R, H and S, and its handler only bails for inputs, so a
  // keypress on a focused BUTTON in here would reach it and swap the puzzle out
  // from under the open dialog. A capture-phase listener on window runs before
  // those bubble-phase handlers, so swallowing keys here keeps this dialog safe
  // on any page without each host needing to know about it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    // DOCUMENT + BUBBLE, deliberately not window-capture. React 18 delegates
    // its handlers to the #root container inside document, so a capture
    // listener on window runs BEFORE React and stopPropagation there would kill
    // this dialog's own onKeyDown — Enter would not save, and Enter/comma would
    // not add a tag. Bubbling hits #root (React) first, then document (here),
    // then window (the page's shortcuts), so this shields the page beneath
    // without deafening the dialog itself.
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const [tags, setTags] = useState<string[]>(defaultTags || []);
  const [target, setTarget] = useState<string>("__new__");   // "__new__" or a study id
  const [saved, setSaved] = useState<{ sid: string; cid: string } | null>(null);

  const studies = useQuery({ queryKey: ["studies", "list"], queryFn: studiesApi.list, staleTime: 30_000 });
  const tagList = useQuery({ queryKey: ["study-tags"], queryFn: studiesApi.listTags, staleTime: 60_000 });
  const me = useQuery({ queryKey: ["auth-me"], queryFn: api.me, staleTime: 60_000 });

  // Only studies the caller OWNS can take a new chapter. The list endpoint also
  // returns studies merely shared with them and academy-visible ones, and
  // addChapter goes through loadForWrite — so offering those would hand the
  // user a dropdown entry that always fails with a permission error.
  const myId = me.data?.userId;
  const mine = useMemo(
    () => (studies.data?.items || []).filter((s: any) => !s.deletedAt && (!myId || s.ownerId === myId)),
    [studies.data, myId],
  );

  const save = useMutation({
    mutationFn: async () => {
      const title = name.trim() || defaultTitle || "Saved position";
      if (target === "__new__") {
        const r = await studiesApi.create({
          title, intent, tags,
          ...(startingFen ? { startingFen } : {}),
          ...(pgn ? { pgn } : {}),
          chapterTitle: title,
        });
        return { sid: r.studyId, cid: r.chapterId };
      }
      const r = await studiesApi.addChapter(target, {
        title, tags,
        ...(startingFen ? { startingFen } : {}),
        ...(pgn ? { pgn } : {}),
      });
      return { sid: target, cid: r.chapterId };
    },
    onSuccess: (r) => {
      setSaved(r);
      qc.invalidateQueries({ queryKey: ["studies"] });
      qc.invalidateQueries({ queryKey: ["study", r.sid] });
      qc.invalidateQueries({ queryKey: ["study-tags"] });
    },
  });

  const err = save.error ? String((save.error as any)?.message || save.error) : null;
  const needsLogin = !!err && /401|unauth|sign in|log in/i.test(err);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Save to My Studies"
    >
      <div
        className="w-full max-w-md rounded-2xl border border-ink-700 bg-ink-900 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-base text-white">📓 Save to My Studies</h3>
          <button onClick={onClose} className="rounded px-2 text-ink-400 hover:text-white" aria-label="Close">✕</button>
        </div>

        {saved ? (
          <div>
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-200">
              Saved. It is in My Studies now.
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                to={`/studies/${encodeURIComponent(saved.sid)}/edit/${encodeURIComponent(saved.cid)}`}
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-500"
              >
                Open on the board →
              </Link>
              <Link
                to={`/studies/${encodeURIComponent(saved.sid)}`}
                className="rounded-lg border border-ink-700 px-3 py-1.5 text-sm text-ink-200 hover:border-ink-500"
              >
                View study
              </Link>
              <button onClick={onClose} className="ml-auto rounded-lg px-3 py-1.5 text-sm text-ink-400 hover:text-white">
                Done
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-ink-500">Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") save.mutate(); }}
                className="w-full rounded-lg border border-ink-700 bg-ink-900/60 px-3 py-2 text-sm text-white outline-none focus:border-brand-500"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-ink-500">Where</span>
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="w-full rounded-lg border border-ink-700 bg-ink-900/60 px-3 py-2 text-sm text-white outline-none focus:border-brand-500"
              >
                <option value="__new__">New study</option>
                {mine.map((s: any) => (
                  <option key={s._id} value={s._id}>Add to “{s.title}”</option>
                ))}
              </select>
            </label>

            <div>
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-ink-500">Topics</span>
              <TagEditor tags={tags} onChange={setTags} suggestions={tagList.data?.tags || []} />
            </div>

            {err && (
              <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-200">
                {needsLogin ? "Sign in to save to My Studies." : `Could not save — ${err}`}
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => save.mutate()}
                disabled={save.isPending}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50"
              >
                {save.isPending ? "Saving…" : "Save"}
              </button>
              <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-ink-400 hover:text-white">
                Cancel
              </button>
              <span className="ml-auto text-[11px] text-ink-500">
                {pgn ? "position + moves" : "position only"}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
