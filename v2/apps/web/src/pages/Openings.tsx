// Memory Master 500 — corpus browse page.
//
// Lists every opening in the bundled corpus (Tier 1 pillars authored by hand +
// Tier 2/3 generated from Lichess ECO + Wikibooks). Filter chips per tag axis;
// left rail for families; sorted by frequency (most-played first).
//
// Row → OpeningDetail (/study/openings/:slug) for the full write-up + board.

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  OPENINGS,
  FAMILIES,
  TAGS,
  tagBySlug,
  familyById,
  openingsByFamily,
  openingsByTags,
} from "../lib/openings";
import type { OpeningTag } from "../lib/openings/types";
import { loadRepertoire, repertoireRoleOf } from "../lib/repertoire";

const AXES: OpeningTag["axis"][] = ["CHARACTER", "STRUCTURE", "ATTACK", "SCHOOL", "PRACTICALITY"];

export default function Openings() {
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [selectedFamily, setSelectedFamily] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [onlyRepertoire, setOnlyRepertoire] = useState(false);
  const repertoire = useMemo(() => loadRepertoire(), []);

  const filtered = useMemo(() => {
    let rows = OPENINGS;
    if (selectedFamily) rows = openingsByFamily(selectedFamily);
    if (selectedTags.size) rows = openingsByTags([...selectedTags]).filter((o) => !selectedFamily || o.familyId === selectedFamily);
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      rows = rows.filter((o) =>
        o.name.toLowerCase().includes(needle) ||
        o.eco.toLowerCase().includes(needle) ||
        o.aliases?.some((a) => a.toLowerCase().includes(needle))
      );
    }
    if (onlyRepertoire && repertoire) {
      rows = rows.filter((o) => !!repertoireRoleOf(o.slug, repertoire));
    }
    // Sort: pillars (tier 1) first, then by frequency desc, then by ECO.
    return [...rows].sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      return (b.frequencyBps ?? 0) - (a.frequencyBps ?? 0) || a.eco.localeCompare(b.eco);
    });
  }, [selectedTags, selectedFamily, q, onlyRepertoire, repertoire]);

  const toggleTag = (slug: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      next.has(slug) ? next.delete(slug) : next.add(slug);
      return next;
    });
  };

  return (
    <div className="mx-auto max-w-6xl p-4">
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Openings — Memory Master 500</h1>
          <p className="mt-1 text-sm text-ink-500">
            The 500 most-played openings by master-game frequency. Pillars authored by hand;
            branches sourced from Lichess ECO (CC0) + Wikibooks Chess Opening Theory (CC-BY-SA).
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-ink-900 px-3 py-1 text-xs font-semibold">
          {filtered.length}/{OPENINGS.length}
        </span>
      </header>

      {/* Repertoire nudge — appears above the search when a user has (or hasn't) built one. */}
      <div className="mb-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm">
        {repertoire ? (
          <div className="flex items-center gap-3">
            <span className="text-indigo-900">
              🎯 Your repertoire — <b>{repertoire.whiteSlugs.length + repertoire.blackVsE4.length + repertoire.blackVsD4.length}</b> openings across White · vs 1.e4 · vs 1.d4.
            </span>
            <button onClick={() => setOnlyRepertoire((v) => !v)}
              className={`ml-auto rounded-full px-3 py-1 text-xs font-bold ${onlyRepertoire ? "bg-indigo-600 text-white" : "bg-ink-900 text-indigo-700 hover:bg-indigo-100"}`}>
              {onlyRepertoire ? "showing repertoire only" : "show repertoire only"}
            </button>
            <Link to="/study/repertoire" className="text-xs font-semibold text-indigo-700 hover:underline">edit ›</Link>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-indigo-900">
              🎯 Build your <b>personal repertoire</b> — 10 questions, 30-40 openings picked for your style.
            </span>
            <Link to="/study/repertoire" className="ml-auto rounded-full bg-indigo-600 px-3 py-1 text-xs font-bold text-white hover:bg-indigo-700">
              Start wizard
            </Link>
          </div>
        )}
      </div>

      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by name, ECO, or alias…"
        className="mb-4 w-full rounded-lg border border-ink-800 px-3 py-2 text-sm outline-none focus:border-ink-600"
      />

      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        {/* Family sidebar */}
        <aside className="space-y-1">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Families</div>
          <button
            onClick={() => setSelectedFamily(null)}
            className={`w-full rounded-lg px-3 py-1.5 text-left text-sm ${!selectedFamily ? "bg-ink-100 text-white" : "hover:bg-ink-900"}`}
          >
            All families
          </button>
          {FAMILIES.map((f) => (
            <button
              key={f.id}
              onClick={() => setSelectedFamily((cur) => (cur === f.id ? null : f.id))}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm ${selectedFamily === f.id ? "bg-ink-100 text-white" : "hover:bg-ink-900"}`}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: f.colorHex }} />
              <span className="truncate">{f.name}</span>
              <span className="ml-auto text-[10px] opacity-60">{openingsByFamily(f.id).length}</span>
            </button>
          ))}
        </aside>

        <main>
          {/* Tag chip filters */}
          <div className="mb-3 space-y-2">
            {AXES.map((axis) => (
              <div key={axis} className="flex flex-wrap items-center gap-1.5">
                <span className="w-24 text-[10px] font-bold uppercase tracking-wide text-ink-500">{axis}</span>
                {TAGS.filter((t) => t.axis === axis).map((t) => {
                  const on = selectedTags.has(t.slug);
                  return (
                    <button
                      key={t.slug}
                      onClick={() => toggleTag(t.slug)}
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold transition ${on ? "bg-ink-100 text-white" : "bg-ink-900 text-ink-300 hover:bg-ink-800"}`}
                    >
                      {t.glyph ? `${t.glyph} ` : ""}{t.label}
                    </button>
                  );
                })}
              </div>
            ))}
            {(selectedTags.size > 0 || selectedFamily) && (
              <button
                onClick={() => { setSelectedTags(new Set()); setSelectedFamily(null); }}
                className="text-xs font-semibold text-red-600 hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>

          {/* Opening list */}
          {filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-ink-800 p-8 text-center text-sm text-ink-500">
              No openings match these filters.
            </div>
          ) : (
            <div className="divide-y divide-ink-900 rounded-xl border border-ink-900 bg-ink-900">
              {filtered.slice(0, 100).map((o) => {
                const family = familyById.get(o.familyId);
                const repRole = repertoireRoleOf(o.slug, repertoire);
                return (
                  <Link
                    key={o.slug}
                    to={`/study/openings/${o.slug}`}
                    className="flex items-start gap-3 px-4 py-3 hover:bg-ink-950"
                  >
                    <div className="w-14 shrink-0">
                      <div className="rounded bg-ink-900 px-1.5 py-0.5 text-center font-mono text-xs font-bold">{o.eco}</div>
                      {o.tier === 1 && (
                        <div className="mt-1 text-center text-[9px] font-bold uppercase text-amber-600">Pillar</div>
                      )}
                      {repRole && (
                        <div className="mt-1 text-center text-[9px] font-bold uppercase text-indigo-600" title={`In your repertoire (${repRole})`}>
                          🎯 {repRole === "white" ? "white" : repRole === "vs-e4" ? "vs e4" : "vs d4"}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-sm font-semibold text-ink-100">{o.name}</h3>
                        {family && (
                          <span className="shrink-0 text-[10px] uppercase tracking-wide" style={{ color: family.colorHex }}>
                            {family.name}
                          </span>
                        )}
                      </div>
                      {o.idea?.short && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-ink-400">{o.idea.short}</p>
                      )}
                      {o.tagSlugs.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {o.tagSlugs.slice(0, 6).map((s) => {
                            const t = tagBySlug.get(s);
                            if (!t) return null;
                            return (
                              <span key={s} className="rounded bg-ink-950 px-1.5 py-0.5 text-[10px] text-ink-400">
                                {t.glyph ? `${t.glyph} ` : ""}{t.label}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    {(o.frequencyBps ?? 0) > 0 && (
                      <div className="shrink-0 text-right">
                        <div className="text-[10px] uppercase text-ink-600">popularity</div>
                        <div className="text-xs font-bold text-ink-300">{Math.max(1, Math.round((o.frequencyBps ?? 0) / 100))}%</div>
                      </div>
                    )}
                  </Link>
                );
              })}
              {filtered.length > 100 && (
                <div className="px-4 py-3 text-center text-xs text-ink-500">
                  Showing first 100 of {filtered.length}. Refine filters to narrow.
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
