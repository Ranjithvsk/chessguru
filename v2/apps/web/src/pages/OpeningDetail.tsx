// Memory Master 500 — opening detail page. One route: /study/openings/:slug
//
// Shows the board + step-through of the mainline, plus all the metadata a
// user needs to internalise the opening: idea (short + long), plans for both
// sides, story hook, tags + structure + family, Wikibook excerpt, author
// citations. "Learn this opening" button hands the SAN sequence off to the
// existing Opening Memory trainer via the sessionStorage handoff.

import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Chess } from "chess.js";
import Board from "../components/Board";
import type { Key } from "chessground/types";
import {
  openingBySlug,
  openingsByFamily,
  familyById,
  tagBySlug,
  structureBySlug,
} from "../lib/openings";
import { OPENING_HANDOFF_KEY, type OpeningHandoff } from "../lib/openingMemory";
import { activateOpening, deactivateOpening, isActivated } from "../lib/cards";
import EngineCoach from "../components/EngineCoach";
import { resolveStory, saveUserStory, speak, clearUserStory } from "../lib/userStories";
import type { Opening } from "../lib/openings/types";
import { api, get } from "../lib/api";

const BASE = (import.meta as any).env?.VITE_API_BASE ?? "";
type MoveNoteMap = { slug: string; notes: Record<string, { note: string; authorName: string; updatedAt: string }>; pendingRequests: Record<string, number> };
async function postJSON<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  if (!r.ok) throw new Error(`POST ${path} → ${r.status}`);
  return r.json() as Promise<T>;
}

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export default function OpeningDetail() {
  const { slug } = useParams<{ slug: string }>();
  const nav = useNavigate();
  const opening = slug ? openingBySlug.get(slug) : undefined;
  const [ply, setPly] = useState(0);
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [activated, setActivated] = useState<boolean>(() => slug ? isActivated(slug) : false);
  const [justAddedCount, setJustAddedCount] = useState<number | null>(null);

  // Reset ply + activated state when the slug changes (prev/next family nav).
  useEffect(() => {
    setPly(0);
    setActivated(slug ? isActivated(slug) : false);
    setJustAddedCount(null);
  }, [slug]);

  const { positions, moves, fromTo } = useMemo(() => {
    if (!opening) return { positions: [START_FEN], moves: [] as string[], fromTo: [] as Array<[Key, Key]> };
    const sans = opening.mainlinePgn ?? opening.pgnStart;
    const g = new Chess();
    const p: string[] = [g.fen()];
    const played: string[] = [];
    const ft: Array<[Key, Key]> = [];
    for (const s of sans) {
      try {
        const mv = g.move(s);
        if (mv) { played.push(mv.san); p.push(g.fen()); ft.push([mv.from as Key, mv.to as Key]); }
      }
      catch { break; }
    }
    return { positions: p, moves: played, fromTo: ft };
  }, [opening]);

  if (!opening) {
    return (
      <div className="mx-auto max-w-3xl p-8 text-center">
        <p className="text-sm text-ink-500">Opening not found.</p>
        <Link to="/study/openings" className="mt-3 inline-block text-sm text-blue-600 hover:underline">
          ← Back to Openings
        </Link>
      </div>
    );
  }

  const family = familyById.get(opening.familyId);
  const structure = opening.structureSlug ? structureBySlug.get(opening.structureSlug) : null;
  const idea = opening.idea;
  const cur = Math.max(0, Math.min(ply, positions.length - 1));
  const lastMoveKey: [Key, Key] | undefined = cur > 0 ? fromTo[cur - 1] : undefined;

  // Sibling openings in the same family — for the ← prev / next → nav.
  const siblings = useMemo(() => {
    const list = openingsByFamily(opening.familyId).sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      return (b.frequencyBps ?? 0) - (a.frequencyBps ?? 0);
    });
    const idx = list.findIndex((o) => o.slug === opening.slug);
    return {
      list,
      idx,
      prev: idx > 0 ? list[idx - 1] : null,
      next: idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null,
    };
  }, [opening]);

  // Keyboard nav: ← → step; Home/End jump to start/end; F flips board.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      // Ignore if the user is typing in an input/textarea (story editor, etc.)
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowLeft")  { e.preventDefault(); setPly((p) => Math.max(0, p - 1)); }
      else if (e.key === "ArrowRight") { e.preventDefault(); setPly((p) => Math.min(positions.length - 1, p + 1)); }
      else if (e.key === "Home") { e.preventDefault(); setPly(0); }
      else if (e.key === "End")  { e.preventDefault(); setPly(positions.length - 1); }
      else if (e.key === "f" || e.key === "F") { e.preventDefault(); setOrientation((o) => o === "white" ? "black" : "white"); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [positions.length]);

  const handoffToTrainer = () => {
    const handoff: OpeningHandoff = { name: opening.name, sans: moves };
    try { sessionStorage.setItem(OPENING_HANDOFF_KEY, JSON.stringify(handoff)); } catch { /* */ }
    nav("/study/opening-memory");
  };

  const toggleActivated = () => {
    if (!opening) return;
    if (activated) {
      deactivateOpening(opening.slug);
      setActivated(false);
      setJustAddedCount(null);
    } else {
      const n = activateOpening(opening.slug);
      setActivated(true);
      setJustAddedCount(n);
    }
  };

  return (
    <div className="mx-auto max-w-6xl p-4">
      <div className="mb-3 flex items-center gap-3 text-xs">
        <Link to="/study/openings" className="text-ink-500 hover:text-ink-200">← All openings</Link>
        <div className="ml-auto flex items-center gap-2">
          {siblings.prev ? (
            <Link to={`/study/openings/${siblings.prev.slug}`}
              className="rounded-full bg-ink-900 px-2.5 py-1 font-semibold text-ink-300 hover:bg-ink-800"
              title={`Previous in ${family?.name ?? "family"}`}>
              ← {siblings.prev.name.length > 30 ? siblings.prev.name.slice(0, 30) + "…" : siblings.prev.name}
            </Link>
          ) : <span className="rounded-full bg-ink-950 px-2.5 py-1 text-ink-700">← start of family</span>}
          {family && (
            <span className="text-[10px] text-ink-500">
              {siblings.idx + 1}/{siblings.list.length} · {family.name}
            </span>
          )}
          {siblings.next ? (
            <Link to={`/study/openings/${siblings.next.slug}`}
              className="rounded-full bg-ink-900 px-2.5 py-1 font-semibold text-ink-300 hover:bg-ink-800"
              title={`Next in ${family?.name ?? "family"}`}>
              {siblings.next.name.length > 30 ? siblings.next.name.slice(0, 30) + "…" : siblings.next.name} →
            </Link>
          ) : <span className="rounded-full bg-ink-950 px-2.5 py-1 text-ink-700">end of family →</span>}
        </div>
      </div>

      <header className="mb-4">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-2xl font-bold">{opening.name}</h1>
          <span className="rounded bg-ink-900 px-2 py-0.5 font-mono text-xs font-bold">{opening.eco}</span>
          {opening.tier === 1 && (
            <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-bold uppercase text-amber-700">Pillar</span>
          )}
        </div>
        <div className="mt-1 text-sm text-ink-400">
          {family && (
            <Link
              to={`/study/openings?family=${family.id}`}
              className="mr-2 hover:underline"
              style={{ color: family.colorHex }}
            >
              {family.name}
            </Link>
          )}
          {opening.aliases?.length ? <span className="text-ink-600">· also: {opening.aliases.join(" · ")}</span> : null}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        {/* Board + step-through */}
        <div>
          <div className="max-w-md">
            <Board fen={positions[cur]!} viewOnly coordinates orientation={orientation} lastMove={lastMoveKey} />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => setPly(0)}
              className="rounded border border-ink-800 px-2 py-1 text-xs hover:bg-ink-950 disabled:opacity-40"
              disabled={cur === 0}
            >
              ⏮
            </button>
            <button
              onClick={() => setPly((p) => Math.max(0, p - 1))}
              className="rounded border border-ink-800 px-2 py-1 text-xs hover:bg-ink-950 disabled:opacity-40"
              disabled={cur === 0}
            >
              ◀
            </button>
            <span className="min-w-[90px] text-center text-xs font-medium">
              {cur === 0 ? "start" : `move ${Math.ceil(cur / 2)}${cur % 2 ? "…" : ""} · ply ${cur}/${positions.length - 1}`}
            </span>
            <button
              onClick={() => setPly((p) => Math.min(positions.length - 1, p + 1))}
              className="rounded border border-ink-800 px-2 py-1 text-xs hover:bg-ink-950 disabled:opacity-40"
              disabled={cur >= positions.length - 1}
            >
              ▶
            </button>
            <button
              onClick={() => setPly(positions.length - 1)}
              className="rounded border border-ink-800 px-2 py-1 text-xs hover:bg-ink-950 disabled:opacity-40"
              disabled={cur >= positions.length - 1}
            >
              ⏭
            </button>
            <button
              onClick={() => setOrientation((o) => o === "white" ? "black" : "white")}
              className="ml-auto rounded border border-ink-800 px-2 py-1 text-xs hover:bg-ink-950"
              title="Flip board (F)"
            >
              ⇅ flip
            </button>
          </div>
          <p className="mt-1 text-[10px] text-ink-600">
            keys: ← → step · Home/End jump · F flip
          </p>

          {/* Move list — each move has a small "?" button that opens the
           *  Move-note modal. Coach/owner can author notes on-demand; students
           *  see the note if it exists or a "Request explanation" button
           *  otherwise (Path C, owner ask 2026-08-12). */}
          <MoveListWithNotes
            opening={opening}
            moves={moves}
            cur={cur}
            setPly={setPly}
          />

          {opening && <NotesSummary slug={opening.slug} />}

          <button
            onClick={handoffToTrainer}
            className="mt-4 w-full rounded-xl bg-ink-100 py-3 text-sm font-bold text-white hover:bg-ink-200 disabled:opacity-40"
            disabled={moves.length === 0}
          >
            ▶ Learn this opening in the trainer
          </button>

          <button
            onClick={toggleActivated}
            className={`mt-2 w-full rounded-xl py-3 text-sm font-bold ${activated ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200" : "bg-indigo-600 text-white hover:bg-indigo-700"}`}
          >
            {activated ? "✓ In your daily queue · click to remove" : "🔁 Add to daily spaced-repetition queue"}
          </button>
          {justAddedCount != null && (
            <div className="mt-2 rounded-lg bg-indigo-50 px-3 py-2 text-center text-xs text-indigo-900">
              Added <b>{justAddedCount}</b> cards. <Link to="/study/daily" className="font-bold underline">Start reviewing →</Link>
            </div>
          )}

          {/* Engine coach — analyses the CURRENTLY-VIEWED position vs the mainline move at this ply */}
          <div className="mt-4">
            <EngineCoach
              key={positions[cur]}
              fen={positions[cur]!}
              declaredSan={moves[cur]}
              ctaLabel={cur < moves.length ? `Ask engine about move ${cur + 1}` : "Ask engine about this position"}
            />
          </div>
        </div>

        {/* Text panel */}
        <div className="space-y-5">
          {idea?.short && (
            <p className="text-base leading-snug text-ink-200">{idea.short}</p>
          )}
          {idea?.long && (
            <div className="rounded-lg bg-ink-950 p-3 text-sm leading-relaxed text-ink-300">
              {idea.long.split(/\n\n/).map((para, i) => <p key={i} className={i > 0 ? "mt-2" : ""}>{para}</p>)}
            </div>
          )}

          {/* Tags */}
          {opening.tagSlugs.length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-ink-500">Tags</div>
              <div className="flex flex-wrap gap-1">
                {opening.tagSlugs.map((s) => {
                  const t = tagBySlug.get(s);
                  if (!t) return null;
                  return (
                    <span key={s} className="rounded-full bg-ink-900 px-2 py-0.5 text-xs font-semibold text-ink-300">
                      {t.glyph ? `${t.glyph} ` : ""}{t.label}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Plans */}
          {(idea?.whitePlans?.length || idea?.blackPlans?.length) && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {idea.whitePlans?.length && (
                <div>
                  <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-ink-500">White plans</div>
                  <ul className="space-y-1 text-xs text-ink-300">
                    {idea.whitePlans.map((p, i) => <li key={i} className="flex gap-1.5"><span>•</span><span>{p}</span></li>)}
                  </ul>
                </div>
              )}
              {idea.blackPlans?.length && (
                <div>
                  <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-ink-500">Black plans</div>
                  <ul className="space-y-1 text-xs text-ink-300">
                    {idea.blackPlans.map((p, i) => <li key={i} className="flex gap-1.5"><span>•</span><span>{p}</span></li>)}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Story — user > pillar > auto */}
          <StoryPanel opening={opening} />

          {/* Structure */}
          {structure && (
            <div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-ink-500">Pawn structure</div>
              <div className="text-sm">
                <span className="font-semibold">{structure.glyph} {structure.name}</span>
                <span className="ml-2 text-ink-400">— {structure.short}</span>
              </div>
            </div>
          )}

          {/* Wikibook excerpt (auto-generated openings) */}
          {idea?.wikibookExcerpt && !idea?.long && (
            <div className="rounded-lg bg-blue-50 p-3 text-sm leading-relaxed text-blue-900">
              {idea.wikibookExcerpt}
              {idea.wikibookUrl && (
                <a href={idea.wikibookUrl} target="_blank" rel="noopener noreferrer"
                  className="ml-2 text-xs font-semibold text-blue-700 hover:underline">→ read on Wikibooks</a>
              )}
            </div>
          )}

          {/* Citations */}
          {idea?.citations?.length && (
            <div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-ink-500">Cited from</div>
              <ul className="space-y-0.5 text-xs text-ink-400">
                {idea.citations.map((c, i) => (
                  <li key={i}>
                    • {c.author && <span className="font-semibold">{c.author} — </span>}
                    {c.url ? <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{c.work}</a> : c.work}
                    {c.section && <span className="text-ink-600">, {c.section}</span>}
                    {c.licence && <span className="ml-1 text-ink-600">({c.licence})</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- Story panel: resolves user > pillar > auto, edit + read-aloud ---------- */

function StoryPanel({ opening }: { opening: Opening }) {
  const [nonce, setNonce] = useState(0);
  const story = useMemo(() => resolveStory(opening), [opening, nonce]);
  const [editing, setEditing] = useState(false);
  const [draftHook, setDraftHook] = useState("");
  const [draftLong, setDraftLong] = useState("");
  const [speaking, setSpeaking] = useState(false);

  const startEdit = () => {
    setDraftHook(story.source === "user" ? story.hook : "");
    setDraftLong(story.source === "user" ? (story.long ?? "") : "");
    setEditing(true);
  };
  const save = () => {
    if (!draftHook.trim()) return;
    saveUserStory(opening.slug, draftHook, draftLong);
    setEditing(false);
    setNonce((n) => n + 1);
  };
  const reset = () => {
    clearUserStory(opening.slug);
    setEditing(false);
    setNonce((n) => n + 1);
  };
  const toggleSpeak = () => {
    if (speaking) { window.speechSynthesis?.cancel(); setSpeaking(false); return; }
    const text = story.long ? `${story.hook}. ${story.long}` : story.hook;
    speak(text);
    setSpeaking(true);
    // Approximate stop-flag reset — speech has no reliable end event across browsers.
    setTimeout(() => setSpeaking(false), Math.min(30_000, 3_000 + text.length * 60));
  };

  const badge = story.source === "user" ? { label: "Your story", cls: "bg-emerald-100 text-emerald-800" }
    : story.source === "pillar" ? { label: "Author-written", cls: "bg-purple-100 text-purple-800" }
    : { label: "Auto", cls: "bg-ink-800 text-ink-300" };

  const bgCls = story.source === "user" ? "border-emerald-100 bg-emerald-50"
    : story.source === "pillar" ? "border-purple-100 bg-purple-50"
    : "border-ink-800 bg-ink-950";
  const textCls = story.source === "user" ? "text-emerald-900" : story.source === "pillar" ? "text-purple-900" : "text-ink-200";

  return (
    <div className={`rounded-lg border p-3 ${bgCls}`}>
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="text-[10px] font-bold uppercase tracking-wide text-ink-500">Story</div>
          <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${badge.cls}`}>{badge.label}</span>
        </div>
        <div className="flex gap-1.5">
          <button onClick={toggleSpeak}
            className="rounded bg-ink-900 px-2 py-0.5 text-[10px] font-semibold text-ink-300 ring-1 ring-ink-800 hover:bg-ink-950">
            {speaking ? "⏹ stop" : "🔊 read"}
          </button>
          {!editing && (
            <button onClick={startEdit}
              className="rounded bg-ink-900 px-2 py-0.5 text-[10px] font-semibold text-ink-300 ring-1 ring-ink-800 hover:bg-ink-950">
              ✏️ your story
            </button>
          )}
        </div>
      </div>

      {!editing && (
        <>
          <p className={`text-sm italic ${textCls}`}>{story.hook}</p>
          {story.long && (
            <details className="mt-2">
              <summary className={`cursor-pointer text-xs font-semibold ${textCls}`}>Full narration</summary>
              <p className={`mt-2 text-xs leading-relaxed ${textCls}`}>{story.long}</p>
            </details>
          )}
        </>
      )}

      {editing && (
        <div className="space-y-2">
          <input
            value={draftHook}
            onChange={(e) => setDraftHook(e.target.value)}
            placeholder="One sentence — the hook you'll remember"
            className="w-full rounded border border-ink-800 bg-ink-900 px-2 py-1 text-sm outline-none focus:border-ink-600"
          />
          <textarea
            value={draftLong}
            onChange={(e) => setDraftLong(e.target.value)}
            placeholder="Optional — longer narration"
            rows={4}
            className="w-full rounded border border-ink-800 bg-ink-900 px-2 py-1 text-xs outline-none focus:border-ink-600"
          />
          <div className="flex gap-1.5">
            <button onClick={save} disabled={!draftHook.trim()}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-40">
              Save
            </button>
            <button onClick={() => setEditing(false)}
              className="rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-semibold hover:bg-ink-800">
              Cancel
            </button>
            {story.source === "user" && (
              <button onClick={reset}
                className="ml-auto rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100">
                Reset to default
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Move-note UI — per-ply "why?" explanations, coach-authored on demand.
// ─────────────────────────────────────────────────────────────────────

function useOpeningNotes(slug: string | undefined) {
  return useQuery({
    queryKey: ["opening-notes", slug],
    queryFn: () => get<MoveNoteMap>(`/api/openings/${encodeURIComponent(slug!)}/notes`),
    enabled: !!slug,
    staleTime: 30_000,
  });
}

function MoveListWithNotes({ opening, moves, cur, setPly }: {
  opening: Opening;
  moves: string[];
  cur: number;
  setPly: (n: number) => void;
}) {
  const { data: notesData, refetch } = useOpeningNotes(opening.slug);
  const notes = notesData?.notes ?? {};
  const pending = notesData?.pendingRequests ?? {};
  const [openPly, setOpenPly] = useState<number | null>(null);
  return (
    <>
      <div className="mt-3 rounded-lg border border-ink-900 bg-ink-900 p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[10px] font-bold uppercase tracking-wide text-ink-500">Mainline</div>
          <div className="text-[10px] text-ink-500">Tap <span className="font-mono">?</span> beside a move to see or request its explanation</div>
        </div>
        <div className="flex flex-wrap gap-x-2 gap-y-1 font-mono text-xs">
          {moves.map((san, i) => {
            const moveNo = Math.floor(i / 2) + 1;
            const isWhite = i % 2 === 0;
            const isCritical = opening.criticalMoveNo != null && moveNo === opening.criticalMoveNo && isWhite;
            const ply = i + 1;
            const hasNote = !!notes[String(ply)];
            const pendingCount = pending[String(ply)] ?? 0;
            return (
              <span key={i} className="inline-flex items-center">
                <button
                  onClick={() => setPly(ply)}
                  className={`rounded px-1 py-0.5 ${cur === ply ? "bg-yellow-100 font-bold" : "hover:bg-ink-900"} ${isCritical ? "ring-1 ring-amber-400" : ""}`}
                >
                  {isWhite ? `${moveNo}.` : ""}{san}
                </button>
                <button
                  onClick={() => { setPly(ply); setOpenPly(ply); }}
                  title={hasNote ? "See explanation" : pendingCount > 0 ? `Explanation requested (${pendingCount})` : "Request an explanation for this move"}
                  className={`ml-0.5 grid h-4 w-4 place-items-center rounded-full text-[9px] font-bold transition ${
                    hasNote
                      ? "bg-emerald-500 text-white hover:bg-emerald-400"
                      : pendingCount > 0
                        ? "bg-amber-400 text-ink-100 hover:bg-amber-300"
                        : "bg-ink-800 text-ink-400 hover:bg-ink-700"
                  }`}
                >
                  ?
                </button>
              </span>
            );
          })}
        </div>
      </div>
      {openPly != null && (
        <MoveNoteModal
          slug={opening.slug}
          ply={openPly}
          san={moves[openPly - 1] ?? ""}
          openingName={opening.name}
          note={notes[String(openPly)]}
          pendingCount={pending[String(openPly)] ?? 0}
          onClose={() => setOpenPly(null)}
          onChange={() => refetch()}
        />
      )}
    </>
  );
}

function MoveNoteModal(props: {
  slug: string; ply: number; san: string; openingName: string;
  note?: { note: string; authorName: string; updatedAt: string };
  pendingCount: number;
  onClose: () => void; onChange: () => void;
}) {
  const { slug, ply, san, openingName, note, pendingCount, onClose, onChange } = props;
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const isCoach = !!(auth?.loggedIn && ((auth as any).role === "coach" || (auth as any).role === "academy_owner" || (auth as any).admin));
  const [editing, setEditing] = useState<boolean>(!note && !!isCoach);
  const [draft, setDraft] = useState<string>(note?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [requested, setRequested] = useState(false);

  useEffect(() => { setDraft(note?.note ?? ""); setEditing(!note && !!isCoach); }, [note, isCoach]);

  const save = async () => {
    if (!draft.trim()) return;
    setSaving(true);
    try { await postJSON(`/api/openings/${encodeURIComponent(slug)}/notes/${ply}`, { note: draft }); onChange(); setEditing(false); }
    catch { alert("Save failed — try again"); }
    setSaving(false);
  };
  const request = async () => {
    try { await postJSON(`/api/openings/${encodeURIComponent(slug)}/notes/${ply}/request`, {}); setRequested(true); onChange(); }
    catch { /* ignore */ }
  };
  const moveNo = Math.floor((ply - 1) / 2) + 1;
  const side = ply % 2 === 1 ? "White" : "Black";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center" onClick={onClose}>
      <div className="my-auto w-full max-w-xl max-h-[92vh] overflow-y-auto rounded-2xl border border-ink-800 bg-ink-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-ink-900 px-4 py-3">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-widest text-ink-500">Move explanation</div>
            <div className="mt-0.5 truncate font-display text-base font-bold text-ink-100">
              {openingName}
              <span className="mx-2 text-ink-600">·</span>
              <span className="rounded bg-ink-900 px-1.5 py-0.5 font-mono text-sm">{moveNo}.{ply % 2 === 0 ? ".." : ""}{san}</span>
              <span className="ml-1.5 text-xs font-normal text-ink-500">({side}'s move)</span>
            </div>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-xl leading-none text-ink-600 hover:bg-ink-900 hover:text-ink-200">×</button>
        </div>

        <div className="space-y-3 p-4">
          {!editing && note && (
            <>
              <div className="whitespace-pre-wrap rounded-lg border border-ink-900 bg-ink-950 p-3 text-sm leading-relaxed text-ink-200">
                {note.note}
              </div>
              <div className="flex items-center justify-between text-[11px] text-ink-500">
                <span>By <b className="text-ink-300">{note.authorName}</b> · {new Date(note.updatedAt).toLocaleDateString()}</span>
                {isCoach && (
                  <button onClick={() => setEditing(true)} className="rounded-md border border-ink-800 px-2 py-1 text-xs font-semibold text-ink-300 hover:bg-ink-950">Edit</button>
                )}
              </div>
            </>
          )}

          {!editing && !note && (
            <div className="space-y-3">
              <div className="rounded-lg border border-dashed border-ink-700 bg-ink-950 p-4 text-center">
                <div className="text-3xl">📝</div>
                <div className="mt-1 text-sm text-ink-400">No explanation yet for this move.</div>
                {pendingCount > 0 && (
                  <div className="mt-1 text-[11px] text-amber-700">
                    {pendingCount} {pendingCount === 1 ? "student has" : "students have"} requested one.
                  </div>
                )}
              </div>
              {isCoach ? (
                <button onClick={() => setEditing(true)} className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-bold text-white hover:bg-indigo-500">✍️ Write an explanation</button>
              ) : (
                <button
                  onClick={request}
                  disabled={requested}
                  className={`w-full rounded-lg py-2.5 text-sm font-bold transition ${requested ? "bg-emerald-100 text-emerald-700" : "bg-indigo-600 text-white hover:bg-indigo-500"}`}
                >
                  {requested ? "✓ Requested — your coach will be notified" : "Ask my coach to explain this move"}
                </button>
              )}
            </div>
          )}

          {editing && (
            <div className="space-y-2">
              <label className="block text-[11px] font-bold uppercase tracking-wide text-ink-500">Explanation (up to 5000 chars)</label>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={10}
                maxLength={5000}
                autoFocus
                placeholder={`Why ${san} here? Explain the idea, common responses, traps to avoid…`}
                className="w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-ink-200 focus:border-indigo-500 focus:outline-none"
              />
              <div className="flex items-center justify-between">
                <div className="text-[11px] text-ink-500">{draft.length}/5000</div>
                <div className="flex items-center gap-2">
                  <button onClick={() => { setEditing(false); setDraft(note?.note ?? ""); }} className="rounded-md border border-ink-800 px-3 py-1.5 text-xs font-semibold text-ink-300 hover:bg-ink-950">Cancel</button>
                  <button onClick={save} disabled={saving || !draft.trim()} className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function NotesSummary({ slug }: { slug: string }) {
  const { data } = useOpeningNotes(slug);
  if (!data) return null;
  const noteCount = Object.keys(data.notes || {}).length;
  const pendingCount = Object.values(data.pendingRequests || {}).reduce((s: number, n: any) => s + Number(n || 0), 0);
  if (noteCount === 0 && pendingCount === 0) return null;
  return (
    <div className="mt-2 flex items-center justify-between rounded-lg border border-ink-900 bg-ink-950 px-3 py-1.5 text-[11px] text-ink-400">
      <span>
        {noteCount > 0 && <>📝 {noteCount} move{noteCount === 1 ? "" : "s"} explained</>}
        {noteCount > 0 && pendingCount > 0 && <span className="mx-1.5 text-ink-600">·</span>}
        {pendingCount > 0 && <span className="text-amber-700">🙋 {pendingCount} pending request{pendingCount === 1 ? "" : "s"}</span>}
      </span>
    </div>
  );
}
