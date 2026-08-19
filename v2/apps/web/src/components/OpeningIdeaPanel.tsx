// Reusable "wiki-book" panel that surfaces an Opening's curated idea +
// Wikibooks excerpt. Rendered in two places:
//
//   * OpeningDetail.tsx (compact=false): full-page detail — long form
//     paragraphs, plans, tags, structure, citations. (Owned there.)
//   * OpeningExplorer.tsx (compact=true): inline right rail — from ply 1
//     onward, the current line's best-matching opening shows here so the
//     student never has to leave the analysis view to read what's going
//     on (matches Lichess's analysis-page book text). Owner ask
//     2026-08-19: "here after making 2 moves, the wiki books explains
//     every move in detail, need like this" + follow-up "not 2 moves,
//     even if one move is played".
//
// Deliberately zero external data — the panel reads from lib/openings
// (in-bundle corpus, generated from Wikibooks CC-BY-SA 3.0 + hand-authored
// pillars). No network call.
import { Link } from "react-router-dom";
import type { Opening } from "../lib/openings/types";

export function OpeningIdeaPanel({ opening, compact = false }: { opening: Opening; compact?: boolean }) {
  const idea = opening.idea;
  // Prefer the hand-authored `long` when present (pillars); fall back to the
  // wikibook excerpt for auto-generated entries. `short` shows above either.
  const body = idea?.long ?? null;
  const wiki = idea?.wikibookExcerpt ?? null;
  return (
    <div className={compact
      ? "rounded-xl2 border border-ink-700 bg-ink-900 p-4"
      : "rounded-xl2 border border-ink-700 bg-ink-900 p-5"}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className={compact ? "font-display text-base text-white" : "font-display text-xl text-white"}>
          <span className="font-mono text-xs text-ink-400 mr-1.5">{opening.eco}</span>
          {opening.name}
        </h3>
        {compact && (
          <Link to={`/openings/${opening.slug}`} className="shrink-0 text-[11px] font-semibold text-brand-300 hover:underline">
            Study this opening →
          </Link>
        )}
      </div>

      {idea?.short && (
        <p className={compact ? "text-xs leading-snug text-ink-200" : "text-base leading-snug text-ink-200"}>
          {idea.short}
        </p>
      )}

      {body && (
        <div className={compact
          ? "mt-2 rounded-lg bg-ink-950 p-2.5 text-[13px] leading-relaxed text-ink-300"
          : "mt-3 rounded-lg bg-ink-950 p-3 text-sm leading-relaxed text-ink-300"}>
          {body.split(/\n\n/).map((para, i) => <p key={i} className={i > 0 ? "mt-2" : ""}>{para}</p>)}
        </div>
      )}

      {wiki && !body && (
        <div className={compact
          ? "mt-2 rounded-lg bg-blue-50/95 p-2.5 text-[13px] leading-relaxed text-blue-900"
          : "mt-3 rounded-lg bg-blue-50 p-3 text-sm leading-relaxed text-blue-900"}>
          {wiki}
          {idea?.wikibookUrl && (
            <a href={idea.wikibookUrl} target="_blank" rel="noopener noreferrer"
              className="ml-2 text-xs font-semibold text-blue-700 hover:underline">→ read on Wikibooks</a>
          )}
        </div>
      )}

      {(idea?.whitePlans?.length || idea?.blackPlans?.length) && (
        <div className={compact ? "mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2" : "mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2"}>
          {idea?.whitePlans?.length ? (
            <div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-ink-500">White plans</div>
              <ul className="space-y-1 text-xs text-ink-300">
                {idea.whitePlans.map((p, i) => <li key={i} className="flex gap-1.5"><span>•</span><span>{p}</span></li>)}
              </ul>
            </div>
          ) : null}
          {idea?.blackPlans?.length ? (
            <div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-ink-500">Black plans</div>
              <ul className="space-y-1 text-xs text-ink-300">
                {idea.blackPlans.map((p, i) => <li key={i} className="flex gap-1.5"><span>•</span><span>{p}</span></li>)}
              </ul>
            </div>
          ) : null}
        </div>
      )}

      {/* When the corpus has no idea at all (rare, e.g. obscure Tier-4 line
          not covered by Wikibooks), still show a "search on Wikibooks" nudge. */}
      {!idea?.short && !body && !wiki && (
        <p className="text-xs text-ink-500">
          No book text for this position yet.
          {" "}
          <a href={`https://en.wikibooks.org/w/index.php?search=${encodeURIComponent(`Chess Opening Theory ${opening.name}`)}`}
             target="_blank" rel="noopener noreferrer"
             className="font-semibold text-brand-300 hover:underline">Search Wikibooks</a>
        </p>
      )}
    </div>
  );
}
