// Memory Master 500 — pre-match prep-test.
// Route: /study/prep-test
//
// A focused rapid-fire drill BEFORE a game — filters your activated cards
// down to the specific side you're about to play (White, vs 1.e4, vs 1.d4)
// and shows only next-move cards (strategy/structure cards would waste time
// in the 5 minutes before a match). Grades still feed FSRS so a pre-match
// panic actually improves your future scheduling.

import { useMemo, useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import Board from "../components/Board";
import {
  activatedSlugs,
  loadAllStates,
  hydrateCard,
  renderNextMoveCard,
  saveCardState,
  type Card,
} from "../lib/cards";
import { openingBySlug } from "../lib/openings";
import { loadRepertoire, type Repertoire } from "../lib/repertoire";
import { grade as fsrsGrade, GRADE_LABELS, type Grade } from "../lib/fsrs";

type Side = "white" | "vs-e4" | "vs-d4" | "any";
const DECK_SIZE = 15;

export default function PrepTest() {
  const [side, setSide] = useState<Side | null>(null);
  const [deck, setDeck] = useState<Card[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [results, setResults] = useState<Array<{ card: Card; grade: Grade }>>([]);

  const repertoire = useMemo(() => loadRepertoire(), []);
  const active = useMemo(() => activatedSlugs(), []);

  const startDrill = (s: Side) => {
    setSide(s);
    const built = buildDeck(s, repertoire, active);
    setDeck(built);
    setIdx(0);
    setRevealed(false);
    setResults([]);
  };

  const onGrade = useCallback((g: Grade) => {
    if (!deck || !deck[idx]) return;
    const card = deck[idx];
    const next = fsrsGrade(card.fsrs, g);
    saveCardState(card.id, next);
    setResults((r) => [...r, { card, grade: g }]);
    setRevealed(false);
    setIdx((i) => i + 1);
  }, [deck, idx]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!deck || idx >= deck.length) return;
      if (e.key === " " && !revealed) { e.preventDefault(); setRevealed(true); return; }
      if (revealed && ["1", "2", "3", "4"].includes(e.key)) {
        e.preventDefault(); onGrade(Number(e.key) as Grade);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [deck, idx, revealed, onGrade]);

  // Landing screen -----------------------------------------------------------
  if (side === null) {
    return (
      <div className="mx-auto max-w-2xl p-4">
        <header className="mb-4">
          <h1 className="text-2xl font-bold">Prep-test</h1>
          <p className="mt-1 text-sm text-ink-500">
            You're playing soon. Pick which side — we'll drill the {DECK_SIZE} most-critical mainline moves from
            your activated openings on that side. 3-5 minutes.
          </p>
        </header>

        {active.size === 0 && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            You haven't activated any openings for study yet. <Link to="/study/openings" className="font-bold underline">Browse the 500</Link> and hit "Add to daily queue" on a few.
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <SideCard s="white"    active={active} rep={repertoire} onStart={startDrill} label="Playing White"     hint="Your White repertoire" />
          <SideCard s="vs-e4"    active={active} rep={repertoire} onStart={startDrill} label="Black vs 1.e4"     hint="Sicilian / French / Caro-Kann …" />
          <SideCard s="vs-d4"    active={active} rep={repertoire} onStart={startDrill} label="Black vs 1.d4"     hint="QGD / Slav / KID / Nimzo …" />
          <SideCard s="any"      active={active} rep={repertoire} onStart={startDrill} label="Any (mixed)"       hint="All activated openings" />
        </div>

        <p className="mt-4 text-[10px] text-ink-600">
          Grades still feed FSRS — a "Again" here schedules the card back for tomorrow.
        </p>
      </div>
    );
  }

  // Drill or empty ----------------------------------------------------------
  if (!deck || deck.length === 0) {
    return (
      <div className="mx-auto max-w-2xl p-6 text-center">
        <p className="text-2xl">🤔</p>
        <h2 className="mt-2 text-lg font-bold">No cards for this side</h2>
        <p className="mt-1 text-sm text-ink-500">
          Nothing in your activated queue matches "{sideLabel(side)}". Try a different side, or add openings on that side first.
        </p>
        <button onClick={() => setSide(null)}
          className="mt-4 rounded-full bg-ink-100 px-4 py-2 text-sm font-bold text-white hover:bg-ink-200">
          ← back
        </button>
      </div>
    );
  }

  const done = idx >= deck.length;
  if (done) return <ResultScreen results={results} side={side} onRedo={() => { setSide(null); }} />;

  const card = deck[idx]!;
  return (
    <div className="mx-auto max-w-3xl p-4">
      <header className="mb-3 flex items-baseline justify-between">
        <div>
          <span className="text-xs uppercase tracking-wide text-ink-600">{sideLabel(side)}</span>
          <h1 className="text-xl font-bold">Prep-test · {idx + 1}/{deck.length}</h1>
        </div>
        <button onClick={() => setSide(null)}
          className="text-xs text-ink-500 hover:underline">exit</button>
      </header>

      {/* Progress dots */}
      <div className="mb-4 flex gap-1">
        {deck.map((_, i) => (
          <span key={i} className={`h-1 flex-1 rounded-full ${i < idx ? "bg-emerald-500" : i === idx ? "bg-amber-400" : "bg-ink-800"}`} />
        ))}
      </div>

      <PrepCard card={card} revealed={revealed} onReveal={() => setRevealed(true)} onGrade={onGrade} />
    </div>
  );
}

function SideCard({ s, active, rep, label, hint, onStart }: {
  s: Side; active: Set<string>; rep: Repertoire | null;
  label: string; hint: string; onStart: (s: Side) => void;
}) {
  const count = countDeckSize(s, rep, active);
  const enabled = count > 0;
  return (
    <button onClick={() => enabled && onStart(s)} disabled={!enabled}
      className={`rounded-xl border p-4 text-left transition ${enabled ? "border-ink-800 bg-ink-900 hover:border-ink-100 hover:shadow-sm" : "border-ink-900 bg-ink-950 opacity-50"}`}>
      <div className="text-lg font-bold text-ink-100">{label}</div>
      <div className="text-xs text-ink-500">{hint}</div>
      <div className="mt-2 text-[11px] font-semibold text-emerald-700">
        {enabled ? `${Math.min(count, DECK_SIZE)}-card deck available` : "no cards on this side"}
      </div>
    </button>
  );
}

function PrepCard({ card, revealed, onReveal, onGrade }: {
  card: Card; revealed: boolean; onReveal: () => void; onGrade: (g: Grade) => void;
}) {
  const opening = openingBySlug.get(card.slug)!;
  const rendered = renderNextMoveCard(card);
  if (!rendered) {
    return <div className="rounded-xl bg-red-50 p-4 text-sm text-red-800">Card broken — skip.</div>;
  }
  const { fen, san, sideToMove, moveNo } = rendered;

  return (
    <div className="rounded-xl border border-ink-900 bg-ink-900 p-4 shadow-sm">
      <div className="mb-2 text-center text-xs text-ink-500">
        <Link to={`/study/openings/${card.slug}`} className="font-semibold hover:underline">{opening.name}</Link>
      </div>
      <div className="mb-2 text-center text-sm font-semibold">
        Move {moveNo}{sideToMove === "b" ? "…" : "."} — {sideToMove === "w" ? "White" : "Black"} to play
      </div>
      <div className="mx-auto max-w-md">
        <Board fen={fen} viewOnly coordinates orientation={sideToMove === "w" ? "white" : "black"} />
      </div>
      {revealed && (
        <div className="mt-3 rounded-lg bg-amber-50 py-3 text-center">
          <div className="text-[10px] font-bold uppercase tracking-wide text-amber-700">answer</div>
          <div className="mt-1 font-mono text-2xl font-bold text-amber-900">{san}</div>
        </div>
      )}

      <div className="mt-4">
        {!revealed ? (
          <button onClick={onReveal}
            className="w-full rounded-xl bg-ink-100 py-3 text-sm font-bold text-white hover:bg-ink-200">
            Show answer <span className="ml-2 text-xs opacity-60">(space)</span>
          </button>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {([1, 2, 3, 4] as Grade[]).map((g) => (
              <button key={g} onClick={() => onGrade(g)}
                className={`rounded-xl py-3 text-sm font-bold text-white ${GRADE_BG[g]}`}>
                {GRADE_LABELS[g].label}
                <div className="text-[10px] font-normal opacity-70">{g}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ResultScreen({ results, side, onRedo }: {
  results: Array<{ card: Card; grade: Grade }>; side: Side; onRedo: () => void;
}) {
  const total = results.length;
  const passed = results.filter((r) => r.grade >= 3).length;
  const failed = results.filter((r) => r.grade === 1);
  const perOpening = new Map<string, { total: number; passed: number }>();
  for (const r of results) {
    const p = perOpening.get(r.card.slug) ?? { total: 0, passed: 0 };
    p.total++;
    if (r.grade >= 3) p.passed++;
    perOpening.set(r.card.slug, p);
  }
  const weakest = [...perOpening.entries()]
    .map(([slug, p]) => ({ slug, ...p, pct: p.passed / p.total }))
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 3);

  return (
    <div className="mx-auto max-w-2xl p-4">
      <div className={`rounded-xl border p-6 text-center ${passed === total ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
        <p className="text-3xl">{passed === total ? "🎯" : passed / total >= 0.7 ? "👍" : "⚠️"}</p>
        <h2 className="mt-2 text-2xl font-bold">{passed}/{total} remembered</h2>
        <p className="mt-1 text-xs text-ink-400">{sideLabel(side)} · {failed.length} lapse{failed.length === 1 ? "" : "s"}</p>
      </div>

      {weakest.length > 0 && failed.length > 0 && (
        <div className="mt-4 rounded-xl border border-ink-900 bg-ink-900 p-4">
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-500">Weakest openings</div>
          <ul className="divide-y divide-ink-900">
            {weakest.map((w) => {
              const o = openingBySlug.get(w.slug);
              return (
                <li key={w.slug} className="flex items-center justify-between py-2 text-sm">
                  <Link to={`/study/openings/${w.slug}`} className="font-semibold text-ink-200 hover:underline">
                    {o?.name ?? w.slug}
                  </Link>
                  <span className={`text-xs font-bold ${w.pct < 0.5 ? "text-red-600" : "text-amber-600"}`}>
                    {w.passed}/{w.total}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <button onClick={onRedo}
          className="flex-1 rounded-xl bg-ink-100 py-3 text-sm font-bold text-white hover:bg-ink-200">
          Re-drill (new side)
        </button>
        <Link to="/study/daily"
          className="flex-1 rounded-xl bg-emerald-500 py-3 text-center text-sm font-bold text-white hover:bg-emerald-600">
          → Daily review
        </Link>
      </div>
    </div>
  );
}

/* ---------- deck construction ---------- */

function buildDeck(side: Side, rep: Repertoire | null, active: Set<string>): Card[] {
  const store = loadAllStates();
  const slugsForSide = slugFilter(side, rep, active);
  const cards: Card[] = [];
  for (const id of Object.keys(store)) {
    if (!id.includes(":nm:")) continue;
    const slug = id.split(":")[0]!;
    if (!active.has(slug) || !slugsForSide.has(slug)) continue;
    const c = hydrateCard(id, store[id]!);
    if (c) cards.push(c);
  }
  // Prioritise: openings with higher frequency first, then critical-move plies,
  // then cards with more lapses (drilling weak spots).
  cards.sort((a, b) => {
    const oa = openingBySlug.get(a.slug)!;
    const ob = openingBySlug.get(b.slug)!;
    const freqDiff = (ob.frequencyBps ?? 0) - (oa.frequencyBps ?? 0);
    if (freqDiff) return freqDiff;
    const critA = oa.criticalMoveNo != null && a.ply === oa.criticalMoveNo * 2 - 1 ? 0 : 1;
    const critB = ob.criticalMoveNo != null && b.ply === ob.criticalMoveNo * 2 - 1 ? 0 : 1;
    if (critA !== critB) return critA - critB;
    return b.fsrs.lapses - a.fsrs.lapses;
  });
  return cards.slice(0, DECK_SIZE);
}

function countDeckSize(side: Side, rep: Repertoire | null, active: Set<string>): number {
  const store = loadAllStates();
  const slugs = slugFilter(side, rep, active);
  let n = 0;
  for (const id of Object.keys(store)) {
    if (!id.includes(":nm:")) continue;
    const slug = id.split(":")[0]!;
    if (active.has(slug) && slugs.has(slug)) n++;
  }
  return n;
}

/** Which opening slugs count for this side. Uses repertoire when available;
 *  otherwise falls back to activated slugs whose ECO/pgnStart implies the side. */
function slugFilter(side: Side, rep: Repertoire | null, active: Set<string>): Set<string> {
  if (side === "any") return new Set(active);
  if (rep) {
    if (side === "white") return new Set(rep.whiteSlugs);
    if (side === "vs-e4") return new Set(rep.blackVsE4);
    if (side === "vs-d4") return new Set(rep.blackVsD4);
  }
  // Repertoire-less fallback: infer side from the opening's first move.
  const out = new Set<string>();
  for (const slug of active) {
    const o = openingBySlug.get(slug);
    if (!o) continue;
    const first = o.pgnStart[0];       // "e4" | "d4" | "c4" | "Nf3" | …
    const second = o.pgnStart[1];      // Black's reply — signals which defence
    if (side === "white") {
      // A White-repertoire pick is any opening where WE (as White) enter it
      // by choice — approximated as "opening whose first move we'd play as
      // White" (all of them). But we exclude Black-defence-only openings
      // where the second move IS the identifying move (Sicilian, French, …)
      // Practical heuristic: include everything for the "no repertoire" case.
      out.add(slug);
    } else if (side === "vs-e4" && first === "e4" && !!second) {
      out.add(slug);
    } else if (side === "vs-d4" && first === "d4" && !!second) {
      out.add(slug);
    }
  }
  return out;
}

function sideLabel(s: Side): string {
  return s === "white" ? "Playing White" : s === "vs-e4" ? "Black vs 1.e4" : s === "vs-d4" ? "Black vs 1.d4" : "Mixed";
}

const GRADE_BG: Record<Grade, string> = {
  1: "bg-red-500 hover:bg-red-600",
  2: "bg-orange-500 hover:bg-orange-600",
  3: "bg-emerald-500 hover:bg-emerald-600",
  4: "bg-sky-500 hover:bg-sky-600",
};
