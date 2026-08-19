// Openings hub — every opening trainer + tool in one place.
//
// Route: /openings   (nav Learn → Openings)
//
// Owner ask 2026-08-19: "now openings is in learn study, i need all openings
// in learn, openings" — moves the entire Opening section out of /study and
// into its own hub, alongside the existing Opening Explorer and the Chess
// Notation trainer.
//
// Sourced from STUDIES (any phase === "opening") + hand-authored cards for
// the free-play Opening Explorer at /opening. Kept in ONE place so a new
// opening trainer only needs `phase: "opening"` in studies.ts to appear here.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { STUDIES, type StudyDef } from "../lib/studies";
import { studyLevels, type StudyLevel } from "../lib/api";
import OpeningExplorer from "../components/OpeningExplorer";

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

export default function OpeningsHub() {
  const [levels, setLevels] = useState<Record<string, StudyLevel>>({});
  const [q, setQ] = useState("");
  useEffect(() => { studyLevels().then(setLevels).catch(() => { /* ratings optional */ }); }, []);

  const needle = q.trim().toLowerCase();
  const matches = (s: StudyDef) =>
    !needle || [s.title, s.blurb, s.detail, s.mateIn, s.id].some((v) => (v || "").toLowerCase().includes(needle));

  const openingStudies = STUDIES.filter((s) => s.phase === "opening" && matches(s));

  return (
    <div className="space-y-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-400">Learn · Openings</div>
          <h1 className="font-display text-2xl text-white">Everything to learn openings</h1>
          <p className="text-sm text-ink-400">
            Read the notation, browse the 3810-opening corpus by name or move-tree, build a personal
            repertoire, and drill it with spaced-repetition — every opening tool in one place.
          </p>
        </div>
        <div className="shrink-0">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search openings…"
            className="w-64 rounded-lg border border-ink-700 bg-ink-900 px-3 py-1.5 text-sm text-white placeholder-ink-500 focus:border-brand-400 focus:outline-none" />
        </div>
      </header>

      {/* Explorer inline — the primary surface. Play any moves and see the
          masters DB update live; hand a line off to Memory with the button.
          Kept above the trainer grid so a landing user gets a real board, not
          a wall of cards (owner ask 2026-08-19). */}
      <section>
        <OpeningExplorer />
      </section>

      <section className="space-y-4">
        <h2 className="font-display text-lg text-white">All opening trainers</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {openingStudies.map((s) => <StudyCard key={s.id} s={s} level={levels[s.id]} />)}
        </div>
        {openingStudies.length === 0 && !needle && (
          <p className="text-xs text-ink-500">No opening trainers registered.</p>
        )}
        {openingStudies.length === 0 && needle && (
          <p className="text-xs text-ink-500">Nothing matches "{needle}".</p>
        )}
      </section>
    </div>
  );
}
