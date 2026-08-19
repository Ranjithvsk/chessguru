// Opening drilldown by NAME — the complement to /study/tree (SAN move tree).
//
// Route: /study/openings-by-name
//
// Owner ask 2026-08-19: "option to select openings from openings names like
// tree". Layout is a 3-column drilldown (Family → Opening → Variation) with
// a live board of the currently-focused position on the right, so you can
// wander by name and always see where you are.
//
// The tree is built from every opening's ecoName (Lichess-canonical) — we
// split on ": " for family/rest and on ", " for variation-path segments. Deep
// sub-variations get an inline collapsible list at column 3 so we never need
// more than three columns of real estate.

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Chess } from "chess.js";
import Board from "../components/Board";
import { buildNameTree, sortedNameChildren, subtreeOpeningCount, type NameNode } from "../lib/openings/nameTree";
import type { Opening } from "../lib/openings/types";
import { loadRepertoire, repertoireRoleOf } from "../lib/repertoire";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function fenFromPgn(moves: string[] | undefined): string {
  if (!moves?.length) return START_FEN;
  const g = new Chess();
  for (const m of moves) { try { g.move(m); } catch { return g.fen(); } }
  return g.fen();
}

export default function OpeningNames() {
  const root = useMemo(() => buildNameTree(), []);
  const rep = useMemo(() => loadRepertoire(), []);
  const families = useMemo(() => sortedNameChildren(root), [root]);
  const [familyKey, setFamilyKey] = useState<string | null>(null);
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const [focusOpening, setFocusOpening] = useState<Opening | null>(null);
  const [q, setQ] = useState("");

  const familyNode: NameNode | null = useMemo(() => families.find((f) => f.key === familyKey) ?? null, [families, familyKey]);
  const openingNode: NameNode | null = useMemo(
    () => (familyNode ? sortedNameChildren(familyNode).find((o) => o.key === openingKey) ?? null : null),
    [familyNode, openingKey],
  );

  const filteredFamilies = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return families;
    return families.filter((f) => {
      if (f.label.toLowerCase().includes(needle)) return true;
      // Scan opening names + child labels for a match — a search for "najdorf"
      // should surface Sicilian even though "Sicilian" doesn't contain it.
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

  const focusFen = focusOpening ? fenFromPgn(focusOpening.pgnStart) : (
    openingNode?.openings[0] ? fenFromPgn(openingNode.openings[0]!.pgnStart) : START_FEN
  );

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-400">Openings</div>
          <h1 className="font-display text-2xl text-white">Browse by name</h1>
          <p className="text-sm text-ink-400">
            Family → Opening → Variation. Prefer the move tree instead?{" "}
            <Link to="/study/tree" className="text-brand-400 hover:underline">Switch to the SAN move-tree ›</Link>
          </p>
        </div>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search family or variation…"
          className="w-64 shrink-0 rounded-lg border border-ink-700 bg-ink-900 px-3 py-1.5 text-sm text-white placeholder-ink-500 focus:border-brand-400 focus:outline-none" />
      </header>

      <div className="grid gap-3 lg:grid-cols-[240px_260px_1fr_320px]">
        {/* Col 1 — Family */}
        <Column title={`Family (${filteredFamilies.length})`}>
          {filteredFamilies.map((f) => {
            const count = subtreeOpeningCount(f);
            const on = f.key === familyKey;
            return (
              <button key={f.key}
                onClick={() => { setFamilyKey(f.key); setOpeningKey(null); setFocusOpening(f.openings[0] ?? null); }}
                className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
                  on ? "bg-brand-500/25 text-white" : "text-ink-200 hover:bg-ink-800"}`}>
                <span className="truncate">{f.label || "(unnamed)"}</span>
                <span className="shrink-0 text-[10px] text-ink-500">{count}</span>
              </button>
            );
          })}
        </Column>

        {/* Col 2 — Opening (mid-level variation) */}
        <Column title={familyNode ? `Opening (${sortedNameChildren(familyNode).length})` : "Pick a family →"}>
          {familyNode ? (
            <>
              {/* "This family, no variation" bucket — Lichess sometimes has an
                  eco-name that IS just the family. Surface it as an implicit
                  first row so pillars aren't buried. */}
              {familyNode.openings.length > 0 && (
                <button
                  onClick={() => { setOpeningKey(""); setFocusOpening(familyNode.openings[0] ?? null); }}
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
                    openingKey === "" ? "bg-brand-500/25 text-white" : "text-ink-200 hover:bg-ink-800"}`}>
                  <span className="truncate italic text-ink-400">— main line —</span>
                  <span className="shrink-0 text-[10px] text-ink-500">{familyNode.openings.length}</span>
                </button>
              )}
              {sortedNameChildren(familyNode).map((o) => {
                const count = subtreeOpeningCount(o);
                const on = o.key === openingKey;
                return (
                  <button key={o.key}
                    onClick={() => { setOpeningKey(o.key); setFocusOpening(o.openings[0] ?? sampleOpening(o)); }}
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
                      on ? "bg-brand-500/25 text-white" : "text-ink-200 hover:bg-ink-800"}`}>
                    <span className="truncate">{o.label}</span>
                    <span className="shrink-0 text-[10px] text-ink-500">{count}</span>
                  </button>
                );
              })}
            </>
          ) : (
            <div className="p-3 text-xs text-ink-500">Choose a family on the left.</div>
          )}
        </Column>

        {/* Col 3 — Variation list (openings + any deeper sub-variations flattened) */}
        <Column title={
          openingNode ? `Variation (${flatOpeningsUnder(openingNode).length})`
          : (openingKey === "" && familyNode) ? `Variation (${familyNode.openings.length})`
          : "Pick an opening →"
        }>
          {(() => {
            const scope: NameNode | null = openingNode ?? (openingKey === "" && familyNode ? familyNode : null);
            if (!scope) return <div className="p-3 text-xs text-ink-500">Pick an opening in column two.</div>;
            const rows = flatOpeningsUnder(scope);
            if (!rows.length) return <div className="p-3 text-xs text-ink-500">No openings here.</div>;
            return rows.map((row) => {
              const on = focusOpening?.slug === row.opening.slug;
              const role = repertoireRoleOf(row.opening.slug, rep);
              return (
                <button key={row.opening.slug}
                  onClick={() => setFocusOpening(row.opening)}
                  className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs ${
                    on ? "bg-brand-500/25 text-white" : "text-ink-200 hover:bg-ink-800"}`}>
                  <span className="w-10 shrink-0 rounded bg-ink-800 px-1 py-0.5 text-center font-mono text-[10px] font-bold">{row.opening.eco}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{row.subPath || row.opening.name}</span>
                    {role && <span className="text-[9px] font-bold uppercase text-indigo-400">🎯 in your repertoire</span>}
                    {row.opening.tier === 1 && <span className="ml-1 text-[9px] font-bold uppercase text-amber-400">Pillar</span>}
                  </span>
                </button>
              );
            });
          })()}
        </Column>

        {/* Col 4 — Board + detail card */}
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <Board fen={focusFen} viewOnly coordinates />
          {focusOpening ? (
            <div className="mt-2 space-y-2 rounded-xl border border-ink-800 bg-ink-900 p-3 text-xs">
              <div className="flex items-baseline justify-between gap-2">
                <div className="font-mono text-sm font-bold text-ink-100">{focusOpening.eco}</div>
                {(focusOpening.frequencyBps ?? 0) > 0 && (
                  <div className="text-[10px] uppercase text-ink-500">
                    freq {Math.max(1, Math.round((focusOpening.frequencyBps ?? 0) / 100))}%
                  </div>
                )}
              </div>
              <div className="text-sm text-ink-100">{focusOpening.name}</div>
              <div className="rounded bg-ink-950 p-2 font-mono text-[11px] text-ink-300">
                {focusOpening.pgnStart.map((san, i) =>
                  <span key={i}>{i % 2 === 0 ? `${Math.floor(i/2)+1}. ` : " "}{san} </span>
                )}
              </div>
              {focusOpening.idea?.short && (
                <p className="text-ink-400">{focusOpening.idea.short}</p>
              )}
              <div className="flex gap-2 pt-1">
                <Link to={`/study/openings/${focusOpening.slug}`}
                  className="flex-1 rounded-md bg-brand-500 px-2 py-1.5 text-center text-[11px] font-semibold text-white hover:bg-brand-400">
                  Read theory →
                </Link>
                <Link to={`/study/opening-memory?slug=${encodeURIComponent(focusOpening.slug)}`}
                  className="flex-1 rounded-md bg-ink-800 px-2 py-1.5 text-center text-[11px] font-semibold text-ink-100 hover:bg-ink-700">
                  Memorise
                </Link>
              </div>
            </div>
          ) : (
            <div className="mt-2 rounded-xl border border-dashed border-ink-800 p-3 text-center text-xs text-ink-500">
              Pick a variation to preview.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex max-h-[70vh] flex-col rounded-xl border border-ink-800 bg-ink-900/60">
      <div className="border-b border-ink-800 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-ink-400">{title}</div>
      <div className="flex-1 overflow-y-auto p-1">{children}</div>
    </div>
  );
}

// Flatten every opening under a node, remembering the sub-path so column 3 can
// show e.g. "English Attack / 6.Be3 e5" for a deeper leaf under Najdorf.
function flatOpeningsUnder(root: NameNode): Array<{ opening: Opening; subPath: string }> {
  const out: Array<{ opening: Opening; subPath: string }> = [];
  const walk = (n: NameNode, prefix: string[]) => {
    for (const o of n.openings) out.push({ opening: o, subPath: prefix.join(" / ") });
    for (const c of sortedNameChildren(n)) walk(c, [...prefix, c.label]);
  };
  // Openings directly at root show WITHOUT a subPath.
  for (const o of root.openings) out.push({ opening: o, subPath: "" });
  for (const c of sortedNameChildren(root)) walk(c, [c.label]);
  return out;
}

function sampleOpening(n: NameNode): Opening | null {
  if (n.openings[0]) return n.openings[0];
  for (const c of n.children.values()) {
    const s = sampleOpening(c);
    if (s) return s;
  }
  return null;
}
