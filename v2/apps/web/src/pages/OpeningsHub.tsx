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

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { STUDIES, type StudyDef } from "../lib/studies";
import { studyLevels, type StudyLevel } from "../lib/api";
import OpeningExplorer from "../components/OpeningExplorer";
import MyRepertoirePanel from "../components/MyRepertoirePanel";
import { useFreePlay } from "../hooks/useFreePlay";
import { OPENINGS, openingBySlug } from "../lib/openings";
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

/** One collapsible tree — Family → Opening → Variation → Sub-variation, all
 *  in a single indented list (owner ask 2026-08-19: "need tree like"). Rows
 *  with children show a ▸ chevron; every row is also clickable to load its
 *  representative opening on the board. Typing in the search auto-expands
 *  branches whose descendants match. */
function NameFinder({ onPick, activeSlug }: { onPick: (o: Opening) => void; activeSlug?: string }) {
  const root = useMemo(() => buildNameTree(), []);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);

  // While a search is active, collect the keys of every branch containing a
  // matching leaf so we can auto-expand them. Empty search: honour whatever
  // the user manually toggled.
  const autoExpand = useMemo<Set<string> | null>(() => {
    if (!needle) return null;
    const keys = new Set<string>();
    const walk = (n: NameNode, path: NameNode[]): boolean => {
      const selfMatch =
        n.label.toLowerCase().includes(needle) ||
        n.openings.some((o) => o.name.toLowerCase().includes(needle) || o.eco.toLowerCase().includes(needle));
      let childMatch = false;
      for (const c of n.children.values()) if (walk(c, [...path, n])) childMatch = true;
      if (selfMatch || childMatch) for (const p of path) keys.add(p.key);
      return selfMatch || childMatch;
    };
    for (const f of sortedNameChildren(root)) walk(f, [root]);
    return keys;
  }, [root, needle]);

  // Ancestor keys of the currently-active opening — auto-expanded so the
  // board→tree sync scrolls the highlighted row into view instead of hiding
  // it inside a collapsed branch. ALSO marks the matching node itself so its
  // own children (deeper variations) are revealed — e.g. playing 1.e4 c5
  // opens Sicilian Defense AND expands the family's variations underneath
  // (owner ask 2026-08-19).
  const activeAncestors = useMemo<Set<string>>(() => {
    const keys = new Set<string>();
    if (!activeSlug) return keys;
    const walk = (n: NameNode, path: NameNode[]): boolean => {
      const selfMatch = n.openings.some((o) => o.slug === activeSlug);
      let found = selfMatch;
      for (const c of n.children.values()) if (walk(c, [...path, n])) found = true;
      if (found) {
        for (const p of path) keys.add(p.key);
        keys.add(n.key);
      }
      return found;
    };
    for (const f of sortedNameChildren(root)) walk(f, [root]);
    return keys;
  }, [root, activeSlug]);

  const toggle = (key: string) => {
    setExpanded((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  };
  const isOpen = (key: string) => (
    (autoExpand ? autoExpand.has(key) : expanded.has(key)) || activeAncestors.has(key)
  );

  // Scroll the currently-active row into view whenever the active opening
  // changes (i.e. the board moved). Only scroll inside the finder's own
  // scroll container so the page itself doesn't jump.
  useEffect(() => {
    if (!activeSlug || !activeRef.current || !listRef.current) return;
    const row = activeRef.current;
    const box = listRef.current;
    const rowTop = row.offsetTop;
    const rowBottom = rowTop + row.offsetHeight;
    if (rowTop < box.scrollTop || rowBottom > box.scrollTop + box.clientHeight) {
      box.scrollTo({ top: rowTop - box.clientHeight / 2 + row.offsetHeight / 2, behavior: "smooth" });
    }
  }, [activeSlug, activeAncestors]);

  const matches = (n: NameNode): boolean => {
    if (!needle) return true;
    if (n.label.toLowerCase().includes(needle)) return true;
    if (n.openings.some((o) => o.name.toLowerCase().includes(needle) || o.eco.toLowerCase().includes(needle))) return true;
    for (const c of n.children.values()) if (matches(c)) return true;
    return false;
  };

  return (
    <div className="space-y-2">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search — Sicilian, B90, Najdorf…"
        className="w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white placeholder-ink-500 focus:border-brand-400 focus:outline-none"
      />
      <div ref={listRef} className="max-h-[220px] overflow-y-auto rounded-lg border border-ink-800 bg-ink-950 p-1">
        {sortedNameChildren(root).filter(matches).map((fam) => (
          <TreeRow key={fam.key} node={fam} depth={0}
            onPick={onPick} activeSlug={activeSlug} activeRef={activeRef}
            isOpen={isOpen} toggle={toggle} matches={matches} />
        ))}
      </div>
      <div className="text-[10px] text-ink-500">
        {needle ? "matching branches auto-expanded" : "▸ expand · click any name to load"}
      </div>
    </div>
  );
}

function TreeRow({
  node, depth, onPick, activeSlug, activeRef, isOpen, toggle, matches,
}: {
  node: NameNode; depth: number;
  onPick: (o: Opening) => void; activeSlug?: string;
  activeRef?: React.RefObject<HTMLDivElement | null>;
  isOpen: (key: string) => boolean; toggle: (key: string) => void;
  matches: (n: NameNode) => boolean;
}) {
  const children = sortedNameChildren(node).filter(matches);
  const hasChildren = children.length > 0;
  const open = hasChildren && isOpen(node.key);
  const leaf: Opening | null = node.openings[0] ?? null;
  const active = leaf && leaf.slug === activeSlug;

  return (
    <div>
      <div ref={active ? activeRef : undefined}
        className={`group flex items-center gap-1 rounded px-1 py-0.5 text-xs ${
        active ? "bg-brand-500/25 text-white" : "hover:bg-ink-800/70"}`}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}>
        {hasChildren ? (
          <button
            onClick={() => toggle(node.key)}
            className="h-4 w-4 shrink-0 text-ink-500 hover:text-white"
            aria-label={open ? "collapse" : "expand"}>
            {open ? "▾" : "▸"}
          </button>
        ) : (
          <span className="h-4 w-4 shrink-0" />
        )}
        <button
          onClick={() => leaf && onPick(leaf)}
          disabled={!leaf}
          className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-left disabled:cursor-default disabled:opacity-70">
          {leaf && (
            <span className="w-9 shrink-0 rounded bg-ink-800 px-1 text-center font-mono text-[9px] font-bold text-brand-300">
              {leaf.eco}
            </span>
          )}
          <span className={`truncate ${leaf ? "text-ink-100" : "text-ink-300"}`}>{node.label}</span>
          {hasChildren && (
            <span className="ml-auto shrink-0 text-[10px] text-ink-500">{subtreeOpeningCount(node)}</span>
          )}
        </button>
      </div>
      {open && children.map((c) => (
        <TreeRow key={c.key} node={c} depth={depth + 1}
          onPick={onPick} activeSlug={activeSlug} activeRef={activeRef}
          isOpen={isOpen} toggle={toggle} matches={matches} />
      ))}
    </div>
  );
}

// Index openings by their canonical SAN move string so the reverse lookup
// (board history → best opening match) is O(1) per suffix — no linear scan
// of 3810 arrays on every move. Built once.
const OPENING_BY_MOVES = (() => {
  const m = new Map<string, Opening>();
  for (const o of OPENINGS) {
    const key = o.pgnStart.join(" ");
    // If two openings share the same move sequence, keep the LOWEST-tier one
    // (pillars > tier-2 > tier-3 > tier-4) so "1.e4 c5" points at Sicilian
    // Defense, not some obscure named sub-line.
    const prev = m.get(key);
    if (!prev || o.tier < prev.tier) m.set(key, o);
  }
  return m;
})();

/** Find the DEEPEST corpus opening whose move-list is a prefix of history. */
function findOpeningFromHistory(history: string[]): Opening | null {
  for (let i = history.length; i > 0; i--) {
    const key = history.slice(0, i).join(" ");
    const hit = OPENING_BY_MOVES.get(key);
    if (hit) return hit;
  }
  return null;
}

export default function OpeningsHub() {
  const [levels, setLevels] = useState<Record<string, StudyLevel>>({});
  useEffect(() => { studyLevels().then(setLevels).catch(() => { /* ratings optional */ }); }, []);

  // Shared freeplay drives BOTH the explorer's board+table AND the name
  // finder's picks. Picking a variation rewrites the board; playing a move
  // on the board keeps the same fp so history + memorize handoff stay
  // coherent.
  const fp = useFreePlay();
  const [activeSlug, setActiveSlug] = useState<string | undefined>(undefined);
  const pickOpening = (o: Opening) => {
    setActiveSlug(o.slug);
    fp.loadSans(o.pgnStart);
  };

  // Board → finder sync: every time the move history changes (user played /
  // undid a move on the board, or the explorer table was clicked), figure
  // out which corpus opening the current position matches and highlight it
  // in the tree. Owner ask 2026-08-19: "find an opening also changes when
  // the move in board changes".
  useEffect(() => {
    const hit = findOpeningFromHistory(fp.history);
    setActiveSlug(hit?.slug);
  }, [fp.history]);

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
          <>
          <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-4">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h2 className="font-display text-sm font-semibold text-white">🗂️ Find an opening</h2>
              <span className="text-[10px] text-ink-500">3810 total</span>
            </div>
            <NameFinder onPick={pickOpening} activeSlug={activeSlug} />
          </div>
          <MyRepertoirePanel
            history={fp.history}
            activeOpening={activeSlug ? (() => {
              const o = openingBySlug.get(activeSlug);
              return o ? { slug: o.slug, name: o.name, eco: o.eco } : null;
            })() : null}
            onLoad={(entry) => {
              if (entry.slug) {
                const o = openingBySlug.get(entry.slug);
                if (o) pickOpening(o);
              } else if (entry.sans) {
                fp.loadSans(entry.sans);
              }
            }}
          />
          </>
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
