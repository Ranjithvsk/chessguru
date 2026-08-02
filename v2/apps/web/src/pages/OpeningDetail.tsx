// Memory Master 500 — opening detail page. One route: /study/openings/:slug
//
// Shows the board + step-through of the mainline, plus all the metadata a
// user needs to internalise the opening: idea (short + long), plans for both
// sides, story hook, tags + structure + family, Wikibook excerpt, author
// citations. "Learn this opening" button hands the SAN sequence off to the
// existing Opening Memory trainer via the sessionStorage handoff.

import { useMemo, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { Chess } from "chess.js";
import Board from "../components/Board";
import {
  openingBySlug,
  familyById,
  tagBySlug,
  structureBySlug,
} from "../lib/openings";
import { OPENING_HANDOFF_KEY, type OpeningHandoff } from "../lib/openingMemory";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export default function OpeningDetail() {
  const { slug } = useParams<{ slug: string }>();
  const nav = useNavigate();
  const opening = slug ? openingBySlug.get(slug) : undefined;
  const [ply, setPly] = useState(0);

  const { positions, moves } = useMemo(() => {
    if (!opening) return { positions: [START_FEN], moves: [] as string[] };
    const sans = opening.mainlinePgn ?? opening.pgnStart;
    const g = new Chess();
    const p: string[] = [g.fen()];
    const played: string[] = [];
    for (const s of sans) {
      try { const mv = g.move(s); if (mv) { played.push(mv.san); p.push(g.fen()); } }
      catch { break; }
    }
    return { positions: p, moves: played };
  }, [opening]);

  if (!opening) {
    return (
      <div className="mx-auto max-w-3xl p-8 text-center">
        <p className="text-sm text-gray-500">Opening not found.</p>
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

  const handoffToTrainer = () => {
    const handoff: OpeningHandoff = { name: opening.name, sans: moves };
    try { sessionStorage.setItem(OPENING_HANDOFF_KEY, JSON.stringify(handoff)); } catch { /* */ }
    nav("/study/opening-memory");
  };

  return (
    <div className="mx-auto max-w-6xl p-4">
      <Link to="/study/openings" className="mb-3 inline-block text-xs text-gray-500 hover:text-gray-800">
        ← All openings
      </Link>

      <header className="mb-4">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-2xl font-bold">{opening.name}</h1>
          <span className="rounded bg-gray-100 px-2 py-0.5 font-mono text-xs font-bold">{opening.eco}</span>
          {opening.tier === 1 && (
            <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-bold uppercase text-amber-700">Pillar</span>
          )}
        </div>
        <div className="mt-1 text-sm text-gray-600">
          {family && (
            <Link
              to={`/study/openings?family=${family.id}`}
              className="mr-2 hover:underline"
              style={{ color: family.colorHex }}
            >
              {family.name}
            </Link>
          )}
          {opening.aliases?.length ? <span className="text-gray-400">· also: {opening.aliases.join(" · ")}</span> : null}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        {/* Board + step-through */}
        <div>
          <div className="max-w-md">
            <Board fen={positions[cur]!} viewOnly coordinates />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => setPly(0)}
              className="rounded border border-gray-200 px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-40"
              disabled={cur === 0}
            >
              ⏮
            </button>
            <button
              onClick={() => setPly((p) => Math.max(0, p - 1))}
              className="rounded border border-gray-200 px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-40"
              disabled={cur === 0}
            >
              ◀
            </button>
            <span className="min-w-[90px] text-center text-xs font-medium">
              {cur === 0 ? "start" : `move ${Math.ceil(cur / 2)}${cur % 2 ? "…" : ""} · ply ${cur}/${positions.length - 1}`}
            </span>
            <button
              onClick={() => setPly((p) => Math.min(positions.length - 1, p + 1))}
              className="rounded border border-gray-200 px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-40"
              disabled={cur >= positions.length - 1}
            >
              ▶
            </button>
            <button
              onClick={() => setPly(positions.length - 1)}
              className="rounded border border-gray-200 px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-40"
              disabled={cur >= positions.length - 1}
            >
              ⏭
            </button>
          </div>

          {/* Move list */}
          <div className="mt-3 rounded-lg border border-gray-100 bg-white p-3">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-500">Mainline</div>
            <div className="flex flex-wrap gap-x-2 gap-y-1 font-mono text-xs">
              {moves.map((san, i) => {
                const moveNo = Math.floor(i / 2) + 1;
                const isWhite = i % 2 === 0;
                const isCritical = opening.criticalMoveNo != null && moveNo === opening.criticalMoveNo && !isWhite === false && (i % 2 === 0);
                return (
                  <button
                    key={i}
                    onClick={() => setPly(i + 1)}
                    className={`rounded px-1 py-0.5 ${cur === i + 1 ? "bg-yellow-100 font-bold" : "hover:bg-gray-100"} ${isCritical ? "ring-1 ring-amber-400" : ""}`}
                  >
                    {isWhite ? `${moveNo}.` : ""}{san}
                  </button>
                );
              })}
            </div>
          </div>

          <button
            onClick={handoffToTrainer}
            className="mt-4 w-full rounded-xl bg-gray-900 py-3 text-sm font-bold text-white hover:bg-gray-800 disabled:opacity-40"
            disabled={moves.length === 0}
          >
            ▶ Learn this opening in the trainer
          </button>
        </div>

        {/* Text panel */}
        <div className="space-y-5">
          {idea?.short && (
            <p className="text-base leading-snug text-gray-800">{idea.short}</p>
          )}
          {idea?.long && (
            <div className="rounded-lg bg-gray-50 p-3 text-sm leading-relaxed text-gray-700">
              {idea.long.split(/\n\n/).map((para, i) => <p key={i} className={i > 0 ? "mt-2" : ""}>{para}</p>)}
            </div>
          )}

          {/* Tags */}
          {opening.tagSlugs.length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-gray-500">Tags</div>
              <div className="flex flex-wrap gap-1">
                {opening.tagSlugs.map((s) => {
                  const t = tagBySlug.get(s);
                  if (!t) return null;
                  return (
                    <span key={s} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700">
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
                  <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-gray-500">White plans</div>
                  <ul className="space-y-1 text-xs text-gray-700">
                    {idea.whitePlans.map((p, i) => <li key={i} className="flex gap-1.5"><span>•</span><span>{p}</span></li>)}
                  </ul>
                </div>
              )}
              {idea.blackPlans?.length && (
                <div>
                  <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-gray-500">Black plans</div>
                  <ul className="space-y-1 text-xs text-gray-700">
                    {idea.blackPlans.map((p, i) => <li key={i} className="flex gap-1.5"><span>•</span><span>{p}</span></li>)}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Story */}
          {idea?.storyHook && (
            <div className="rounded-lg border border-purple-100 bg-purple-50 p-3">
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-purple-700">Story hook</div>
              <p className="text-sm italic text-purple-900">{idea.storyHook}</p>
              {idea.storyLong && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-semibold text-purple-700">Full narration</summary>
                  <p className="mt-2 text-xs leading-relaxed text-purple-900">{idea.storyLong}</p>
                </details>
              )}
            </div>
          )}

          {/* Structure */}
          {structure && (
            <div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-gray-500">Pawn structure</div>
              <div className="text-sm">
                <span className="font-semibold">{structure.glyph} {structure.name}</span>
                <span className="ml-2 text-gray-600">— {structure.short}</span>
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
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-gray-500">Cited from</div>
              <ul className="space-y-0.5 text-xs text-gray-600">
                {idea.citations.map((c, i) => (
                  <li key={i}>
                    • {c.author && <span className="font-semibold">{c.author} — </span>}
                    {c.url ? <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{c.work}</a> : c.work}
                    {c.section && <span className="text-gray-400">, {c.section}</span>}
                    {c.licence && <span className="ml-1 text-gray-400">({c.licence})</span>}
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
