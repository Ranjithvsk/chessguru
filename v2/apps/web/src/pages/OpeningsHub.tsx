// Learn → Openings — everything opening-related on one integrated page.
//
// Owner asks (2026-08-19):
//   * "show opening explorer open in opening, not in a box"
//   * "integrate browse by opening name, not in a separate box option"
//
// Layout: Family → Opening → Variation drilldown on the LEFT drives the same
// board + masters-DB explorer on the RIGHT. Picking a variation loads that
// line's position; you can then keep exploring by playing moves on the board.
// The other opening trainers (Notation, Memory Master, Repertoire, Daily
// Review, PGN Import, Progress, Prep-test, Opening Memory, tree, coordinates)
// live as tiles BELOW the integrated explorer.

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { STUDIES, type StudyDef } from "../lib/studies";
import { studyLevels, type StudyLevel } from "../lib/api";
import OpeningExplorer from "../components/OpeningExplorer";
import { useFreePlay } from "../hooks/useFreePlay";
import { OPENINGS } from "../lib/openings";
import type { Opening } from "../lib/openings/types";

function tier(avg: number) {
  if (avg < 1000) return "Beginner";
  if (avg < 1400) return "Intermediate";
  if (avg < 1800) return "Advanced";
  return "Expert";
}
function tierLabel(range: [number, number]): string {
  const t1 = tier(range[0]), t2 = tier(range[1]);
  return t1 === t2 ? t1 : `${t1}–${t2}`;
}
function RangeChip({ range }: { range: [number, number] }) {
  return (
    <span className="rounded-full bg-brand-500/15 px-2.5 py-1 text-[11px] font-semibold text-brand-300"
      title={`Curated difficulty ${range[0]}–${range[1]}`}>
      ★ {range[0]}–{range[1]} · {tierLabel(range)}
    </span>
  );
}

function StudyCard({ s, level }: { s: StudyDef; level?: StudyLevel }) {
  return (
    <Link to={`/study/${s.id}`}
      className="group flex flex-col rounded-xl2 border border-ink-700 bg-ink-900 p-5 transition hover:border-brand-500 hover:bg-ink-800">
      <div className="flex items-center gap-3">
        <span className="grid h-12 w-12 place-items-center rounded-lg bg-brand-gradient text-2xl leading-none text-white">{s.icon}</span>
        <div>
          <h2 className="font-display text-lg text-white">{s.title}</h2>
          <p className="text-xs text-ink-400">{s.blurb}</p>
        </div>
      </div>
      <p className="mt-3 flex-1 text-sm text-ink-400">{s.detail}</p>
      <div className="mt-4 flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-ink-800 px-2.5 py-1 text-[11px] font-medium text-ink-300">{s.mateIn}</span>
          {s.range && <RangeChip range={s.range} />}
          {level && level.n > 0 && (
            <span className="rounded-full bg-accent-500/15 px-2.5 py-1 text-[11px] font-semibold text-accent-400"
              title={`${level.n} rated puzzles · ${level.min}–${level.max} (your play data)`}>
              you: ~{level.avg}
            </span>
          )}
        </div>
        <span className="shrink-0 text-sm font-semibold text-brand-400 group-hover:text-brand-300">Start →</span>
      </div>
    </Link>
  );
}

/** Single flat searchable list — replaces the previous 3-column tree
 *  (owner ask 2026-08-19: "3 boxes looks bad"). Every opening is one row,
 *  showing ECO + full "Family: variation, sub-variation" hierarchy. Type to
 *  filter by name, family, or ECO — click to load onto the board. */
function NameFinder({ onPick, activeSlug }: { onPick: (o: Opening) => void; activeSlug?: string }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();

  // Sort once: pillars first, then by frequency desc — the popular openings
  // land at the top when the search is empty.
  const sorted = useMemo(() => {
    return [...OPENINGS].sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      const fd = (b.frequencyBps ?? 0) - (a.frequencyBps ?? 0);
      if (fd) return fd;
      return a.name.localeCompare(b.name);
    });
  }, []);

  const filtered = useMemo(() => {
    if (!needle) return sorted.slice(0, 400);
    return sorted.filter((o) =>
      o.name.toLowerCase().includes(needle) ||
      o.ecoName.toLowerCase().includes(needle) ||
      o.eco.toLowerCase().includes(needle),
    ).slice(0, 400);
  }, [sorted, needle]);

  return (
    <div className="space-y-2">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search 3810 openings — name, ECO, family…"
        className="w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white placeholder-ink-500 focus:border-brand-400 focus:outline-none"
      />
      <div className="max-h-[360px] overflow-y-auto rounded-lg border border-ink-800 bg-ink-950">
        {filtered.length === 0 ? (
          <div className="p-3 text-center text-xs text-ink-500">No openings match "{q}".</div>
        ) : (
          <ul className="divide-y divide-ink-800/60">
            {filtered.map((o) => {
              const on = o.slug === activeSlug;
              return (
                <li key={o.slug}>
                  <button
                    onClick={() => onPick(o)}
                    className={`group flex w-full items-center gap-2 px-3 py-1.5 text-left transition ${
                      on ? "bg-brand-500/25 text-white" : "hover:bg-ink-800"}`}>
                    <span className="w-10 shrink-0 rounded bg-ink-800 px-1 py-0.5 text-center font-mono text-[10px] font-bold text-brand-300">
                      {o.eco}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-ink-100">{o.ecoName}</span>
                    {o.tier === 1 && <span className="shrink-0 text-[9px] font-bold uppercase text-amber-400">Pillar</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="text-[10px] text-ink-500">
        Showing {filtered.length}{needle ? "" : " of 3810"} · click to load onto the board.
      </div>
    </div>
  );
}

export default function OpeningsHub() {
  const [levels, setLevels] = useState<Record<string, StudyLevel>>({});
  useEffect(() => { studyLevels().then(setLevels).catch(() => { /* ratings optional */ }); }, []);

  // Shared freeplay drives BOTH the explorer's board+table AND the name
  // drilldown's picks. Picking a variation on the left rewrites the board;
  // playing a move on the board keeps the same fp so history + memorize
  // handoff stay coherent.
  const fp = useFreePlay();
  const [activeSlug, setActiveSlug] = useState<string | undefined>(undefined);
  const pickOpening = (o: Opening) => {
    setActiveSlug(o.slug);
    fp.loadSans(o.pgnStart);
  };

  // The "openings-by-name" study card is integrated into this hub — hide it
  // from the trainer grid below so it doesn't appear twice.
  const openingStudies = STUDIES.filter((s) => s.phase === "opening" && s.id !== "openings-by-name");

  return (
    <div className="space-y-8">
      <header>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-400">Learn · Openings</div>
        <h1 className="font-display text-2xl text-white">Everything to learn openings</h1>
        <p className="text-sm text-ink-400">
          Pick a variation on the left — the board loads that line and the masters DB updates. Keep playing from there,
          or hand the line over to Memory / Repertoire below.
        </p>
      </header>

      {/* Explorer keeps its Lichess-analysis layout (big board on the left,
          ~400px rail on the right). The name FINDER slots into that right rail
          via `asideExtra` — one clean search-first list (no three-column
          drilldown, owner ask 2026-08-19). */}
      <section>
        <OpeningExplorer fp={fp} asideExtra={
          <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-4">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h2 className="font-display text-sm font-semibold text-white">🗂️ Find an opening</h2>
              <span className="text-[10px] text-ink-500">3810 total</span>
            </div>
            <NameFinder onPick={pickOpening} activeSlug={activeSlug} />
          </div>
        } />
      </section>

      <section className="space-y-4">
        <h2 className="font-display text-lg text-white">All opening trainers</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {openingStudies.map((s) => <StudyCard key={s.id} s={s} level={levels[s.id]} />)}
        </div>
      </section>
    </div>
  );
}
