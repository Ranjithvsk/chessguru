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
import { buildNameTree, sortedNameChildren, subtreeOpeningCount, type NameNode } from "../lib/openings/nameTree";
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

/** Compact 3-column Family → Opening → Variation picker. Picking any row calls
 *  onPick with the opening — the parent hub then loads its pgnStart onto the
 *  shared freeplay board so the Explorer table refreshes. */
function NameDrilldown({ onPick, activeSlug }: { onPick: (o: Opening) => void; activeSlug?: string }) {
  const root = useMemo(() => buildNameTree(), []);
  const families = useMemo(() => sortedNameChildren(root), [root]);
  const [familyKey, setFamilyKey] = useState<string | null>(null);
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const familyNode = useMemo(() => families.find((f) => f.key === familyKey) ?? null, [families, familyKey]);
  const openingNode = useMemo(
    () => (familyNode ? sortedNameChildren(familyNode).find((o) => o.key === openingKey) ?? null : null),
    [familyNode, openingKey],
  );

  const filteredFamilies = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return families;
    return families.filter((f) => {
      const stack: NameNode[] = [f];
      while (stack.length) {
        const n = stack.pop()!;
        if (n.label.toLowerCase().includes(needle)) return true;
        if (n.openings.some((o) => o.name.toLowerCase().includes(needle) || o.eco.toLowerCase().includes(needle))) return true;
        for (const c of n.children.values()) stack.push(c);
      }
      return false;
    });
  }, [families, q]);

  return (
    <div className="space-y-2">
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search openings by name / ECO…"
        className="w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-1.5 text-sm text-white placeholder-ink-500 focus:border-brand-400 focus:outline-none" />
      <div className="grid grid-cols-3 gap-2">
        <Col title={`Family (${filteredFamilies.length})`}>
          {filteredFamilies.map((f) => {
            const on = f.key === familyKey;
            return (
              <button key={f.key} onClick={() => { setFamilyKey(f.key); setOpeningKey(null); if (f.openings[0]) onPick(f.openings[0]); }}
                className={`flex w-full items-center justify-between gap-1 rounded-md px-2 py-1 text-left text-[12px] ${
                  on ? "bg-brand-500/25 text-white" : "text-ink-200 hover:bg-ink-800"}`}>
                <span className="truncate">{f.label || "(unnamed)"}</span>
                <span className="shrink-0 text-[10px] text-ink-500">{subtreeOpeningCount(f)}</span>
              </button>
            );
          })}
        </Col>
        <Col title={familyNode ? `Opening (${sortedNameChildren(familyNode).length})` : "→"}>
          {familyNode ? (
            <>
              {familyNode.openings.length > 0 && (
                <button onClick={() => { setOpeningKey(""); onPick(familyNode.openings[0]!); }}
                  className={`flex w-full items-center justify-between gap-1 rounded-md px-2 py-1 text-left text-[12px] ${
                    openingKey === "" ? "bg-brand-500/25 text-white" : "text-ink-200 hover:bg-ink-800"}`}>
                  <span className="truncate italic text-ink-400">— main line —</span>
                </button>
              )}
              {sortedNameChildren(familyNode).map((o) => (
                <button key={o.key} onClick={() => { setOpeningKey(o.key); const s = o.openings[0] ?? sampleOpening(o); if (s) onPick(s); }}
                  className={`flex w-full items-center justify-between gap-1 rounded-md px-2 py-1 text-left text-[12px] ${
                    o.key === openingKey ? "bg-brand-500/25 text-white" : "text-ink-200 hover:bg-ink-800"}`}>
                  <span className="truncate">{o.label}</span>
                  <span className="shrink-0 text-[10px] text-ink-500">{subtreeOpeningCount(o)}</span>
                </button>
              ))}
            </>
          ) : <Empty>Pick a family.</Empty>}
        </Col>
        <Col title={openingNode ? "Variation" : openingKey === "" && familyNode ? "Main-line" : "→"}>
          {(() => {
            const scope: NameNode | null = openingNode ?? (openingKey === "" && familyNode ? familyNode : null);
            if (!scope) return <Empty>Pick an opening.</Empty>;
            const rows = flatOpeningsUnder(scope);
            return rows.map((row) => (
              <button key={row.opening.slug} onClick={() => onPick(row.opening)}
                className={`flex w-full items-start gap-1 rounded-md px-2 py-1 text-left text-[11px] ${
                  activeSlug === row.opening.slug ? "bg-brand-500/25 text-white" : "text-ink-200 hover:bg-ink-800"}`}>
                <span className="w-9 shrink-0 rounded bg-ink-800 px-1 text-center font-mono text-[9px] font-bold">{row.opening.eco}</span>
                <span className="min-w-0 flex-1 truncate">{row.subPath || row.opening.name}</span>
              </button>
            ));
          })()}
        </Col>
      </div>
    </div>
  );
}

function Col({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex max-h-[420px] flex-col rounded-lg border border-ink-800 bg-ink-900/60">
      <div className="border-b border-ink-800 px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-ink-500">{title}</div>
      <div className="flex-1 overflow-y-auto p-0.5">{children}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="p-2 text-[11px] text-ink-500">{children}</div>;
}

function flatOpeningsUnder(root: NameNode): Array<{ opening: Opening; subPath: string }> {
  const out: Array<{ opening: Opening; subPath: string }> = [];
  const walk = (n: NameNode, prefix: string[]) => {
    for (const o of n.openings) out.push({ opening: o, subPath: prefix.join(" / ") });
    for (const c of sortedNameChildren(n)) walk(c, [...prefix, c.label]);
  };
  for (const o of root.openings) out.push({ opening: o, subPath: "" });
  for (const c of sortedNameChildren(root)) walk(c, [c.label]);
  return out;
}

function sampleOpening(n: NameNode): Opening | null {
  if (n.openings[0]) return n.openings[0];
  for (const c of n.children.values()) { const s = sampleOpening(c); if (s) return s; }
  return null;
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

      {/* Integrated explorer: name drilldown + board + masters table. On desktop
          the drilldown gets a fixed 380px column so it stays readable next to
          the explorer's own 400px right rail; on smaller screens they stack. */}
      <section className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
        <NameDrilldown onPick={pickOpening} activeSlug={activeSlug} />
        <OpeningExplorer fp={fp} />
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
