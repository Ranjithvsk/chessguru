// Memory Master 500 — daily FSRS review session.
//
// Route: /study/daily. Shows:
//   - Header stats: due now, new available, total cards, active openings.
//   - Empty state: prompt to add openings from the Openings browse page.
//   - Review loop: one card at a time (board or prompt) → reveal → 4 grade
//     buttons (Again/Hard/Good/Easy). Keyboard 1-4 grades, space reveals.
//
// State lives in localStorage via ./lib/cards. Everything is client-side.

import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import Board from "../components/Board";
import {
  activatedSlugs,
  dueCards,
  hydrateCard,
  queueSummary,
  renderNextMoveCard,
  saveCardState,
  type Card,
} from "../lib/cards";
import { openingBySlug, structureBySlug } from "../lib/openings";
import { grade as fsrsGrade, humanDue, GRADE_LABELS, type Grade } from "../lib/fsrs";

export default function DailyStudy() {
  // Force re-render after each grade + on mount.
  const [nonce, setNonce] = useState(0);

  const summary = useMemo(() => queueSummary(), [nonce]);
  const [activeCard, setActiveCard] = useState<Card | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [sessionCount, setSessionCount] = useState(0);

  // Pull next card whenever the queue may have changed.
  useEffect(() => {
    const queue = dueCards();
    setActiveCard(queue[0] ?? null);
    setRevealed(false);
  }, [nonce]);

  const onGrade = useCallback((g: Grade) => {
    if (!activeCard) return;
    const next = fsrsGrade(activeCard.fsrs, g);
    saveCardState(activeCard.id, next);
    setSessionCount((n) => n + 1);
    setNonce((n) => n + 1);
  }, [activeCard]);

  // Keyboard shortcuts: space = reveal, 1-4 = grade
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!activeCard) return;
      if (e.key === " " && !revealed) { e.preventDefault(); setRevealed(true); return; }
      if (revealed && ["1", "2", "3", "4"].includes(e.key)) {
        e.preventDefault();
        onGrade(Number(e.key) as Grade);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [activeCard, revealed, onGrade]);

  const hasActive = summary.activeOpenings > 0;

  return (
    <div className="mx-auto max-w-3xl p-4">
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Opening Trainer</h1>
          <p className="mt-1 text-sm text-ink-500">Spaced repetition · FSRS scheduling · your active repertoire first.</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Link to="/study/progress" className="rounded-full bg-purple-100 px-3 py-1 text-xs font-semibold text-purple-700 hover:bg-purple-200">
            📊 progress
          </Link>
          <Link to="/study/openings" className="rounded-full bg-ink-900 px-3 py-1 text-xs font-semibold hover:bg-ink-800">
            + add openings
          </Link>
        </div>
      </header>

      {/* Stats strip */}
      <div className="mb-4 grid grid-cols-4 gap-2 text-center">
        <Stat label="due now" value={summary.dueNow} accent={summary.dueNow > 0 ? "text-emerald-600" : "text-ink-600"} />
        <Stat label="new" value={summary.newAvailable} accent="text-indigo-600" />
        <Stat label="cards" value={summary.totalCards} />
        <Stat label="openings" value={summary.activeOpenings} />
      </div>

      {sessionCount > 0 && (
        <div className="mb-3 rounded-lg bg-emerald-50 px-3 py-1.5 text-center text-xs font-semibold text-emerald-700">
          ✓ {sessionCount} card{sessionCount === 1 ? "" : "s"} reviewed this session
        </div>
      )}

      {!hasActive ? (
        <EmptyState />
      ) : !activeCard ? (
        <AllCaughtUp sessionCount={sessionCount} />
      ) : (
        <CardView card={activeCard} revealed={revealed} onReveal={() => setRevealed(true)} onGrade={onGrade} />
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="rounded-lg border border-ink-900 bg-ink-900 p-2.5">
      <div className={`text-xl font-bold ${accent ?? "text-ink-100"}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-ink-500">{label}</div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-ink-800 bg-ink-900 p-8 text-center">
      <p className="text-2xl">📚</p>
      <h2 className="mt-2 text-lg font-bold">No openings in your study queue yet</h2>
      <p className="mx-auto mt-1 max-w-sm text-sm text-ink-500">
        Add one from the Openings browser — a "Start studying" button on any opening detail creates
        its cards and schedules them here.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Link to="/study/openings" className="rounded-full bg-ink-100 px-4 py-2 text-sm font-bold text-white hover:bg-ink-200">
          Browse 500 openings
        </Link>
        <Link to="/study/repertoire" className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700">
          Build my repertoire →
        </Link>
      </div>
    </div>
  );
}

function AllCaughtUp({ sessionCount }: { sessionCount: number }) {
  const active = activatedSlugs().size;
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-8 text-center">
      <p className="text-2xl">🎉</p>
      <h2 className="mt-2 text-lg font-bold text-emerald-900">
        {sessionCount > 0 ? "Done for now" : "All caught up"}
      </h2>
      <p className="mt-1 text-sm text-emerald-700">
        {sessionCount > 0 ? `Reviewed ${sessionCount} card${sessionCount === 1 ? "" : "s"}. ` : ""}
        Come back later — {active} opening{active === 1 ? "" : "s"} scheduled.
      </p>
      <Link to="/study/openings" className="mt-4 inline-block rounded-full bg-ink-900 px-4 py-2 text-sm font-bold text-emerald-700 hover:bg-emerald-100">
        + add more openings
      </Link>
    </div>
  );
}

function CardView({
  card,
  revealed,
  onReveal,
  onGrade,
}: {
  card: Card;
  revealed: boolean;
  onReveal: () => void;
  onGrade: (g: Grade) => void;
}) {
  const opening = openingBySlug.get(card.slug)!;
  return (
    <div className="rounded-xl border border-ink-900 bg-ink-900 p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between text-xs">
        <Link to={`/study/openings/${card.slug}`} className="font-semibold text-ink-300 hover:underline">
          {opening.name}
        </Link>
        <span className="text-ink-600">
          {card.fsrs.state} · {humanDue(card.fsrs)}
          {card.fsrs.reps > 0 && ` · ${card.fsrs.reps} reps`}
        </span>
      </div>

      {card.kind === "next-move" && <NextMoveCard card={card} revealed={revealed} />}
      {card.kind === "plan-white" && <PlansCard card={card} side="white" revealed={revealed} />}
      {card.kind === "plan-black" && <PlansCard card={card} side="black" revealed={revealed} />}
      {card.kind === "structure" && <StructureCard card={card} revealed={revealed} />}

      <div className="mt-5">
        {!revealed ? (
          <button
            onClick={onReveal}
            className="w-full rounded-xl bg-ink-100 py-3 text-sm font-bold text-white hover:bg-ink-200"
          >
            Show answer <span className="ml-2 text-xs opacity-60">(space)</span>
          </button>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {([1, 2, 3, 4] as Grade[]).map((g) => (
              <button
                key={g}
                onClick={() => onGrade(g)}
                className={`rounded-xl py-3 text-sm font-bold text-white ${GRADE_BG[g]}`}
                title={`${GRADE_LABELS[g].label} — key ${g}`}
              >
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

const GRADE_BG: Record<Grade, string> = {
  1: "bg-red-500 hover:bg-red-600",
  2: "bg-orange-500 hover:bg-orange-600",
  3: "bg-emerald-500 hover:bg-emerald-600",
  4: "bg-sky-500 hover:bg-sky-600",
};

function NextMoveCard({ card, revealed }: { card: Card; revealed: boolean }) {
  const rendered = renderNextMoveCard(card);
  if (!rendered) {
    return <div className="p-4 text-sm text-red-600">Card broken — mainline out of range. Grade "Again" to retry.</div>;
  }
  const { fen, san, sideToMove, moveNo } = rendered;
  return (
    <div>
      <div className="mb-2 text-center text-sm font-semibold">
        Move {moveNo}{sideToMove === "b" ? "…" : "."} — {sideToMove === "w" ? "White" : "Black"} to play
      </div>
      <div className="mx-auto max-w-md">
        <Board fen={fen} viewOnly coordinates orientation={sideToMove === "w" ? "white" : "black"} />
      </div>
      {revealed && (
        <div className="mt-3 rounded-lg bg-amber-50 py-3 text-center">
          <div className="text-[10px] font-bold uppercase tracking-wide text-amber-700">answer</div>
          <div className="mt-1 font-mono text-xl font-bold text-amber-900">{san}</div>
        </div>
      )}
    </div>
  );
}

function PlansCard({ card, side, revealed }: { card: Card; side: "white" | "black"; revealed: boolean }) {
  const opening = openingBySlug.get(card.slug)!;
  const plans = side === "white" ? opening.idea?.whitePlans : opening.idea?.blackPlans;
  return (
    <div>
      <div className="mb-3 rounded-lg bg-ink-950 p-4 text-center text-sm">
        <div className="text-[10px] font-bold uppercase tracking-wide text-ink-500">recall</div>
        <div className="mt-1 text-base font-semibold text-ink-200">
          What is {side}'s plan in the {opening.name}?
        </div>
      </div>
      {revealed && (
        <ul className={`rounded-lg p-3 text-sm ${side === "white" ? "bg-blue-50 text-blue-900" : "bg-ink-100 text-ink-900"}`}>
          {(plans ?? []).map((p, i) => (
            <li key={i} className="flex gap-1.5 py-0.5"><span>•</span><span>{p}</span></li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StructureCard({ card, revealed }: { card: Card; revealed: boolean }) {
  const opening = openingBySlug.get(card.slug)!;
  const struct = opening.structureSlug ? structureBySlug.get(opening.structureSlug) : null;
  return (
    <div>
      <div className="mb-3 rounded-lg bg-ink-950 p-4 text-center text-sm">
        <div className="text-[10px] font-bold uppercase tracking-wide text-ink-500">recall</div>
        <div className="mt-1 text-base font-semibold text-ink-200">
          What pawn structure does the {opening.name} reach?
        </div>
      </div>
      {revealed && struct && (
        <div className="rounded-lg bg-purple-50 p-3 text-sm text-purple-900">
          <div className="text-lg font-bold">{struct.glyph} {struct.name}</div>
          <p className="mt-1 text-xs">{struct.short}</p>
        </div>
      )}
      {revealed && !struct && (
        <div className="p-3 text-sm text-red-600">Structure removed from corpus.</div>
      )}
    </div>
  );
}
